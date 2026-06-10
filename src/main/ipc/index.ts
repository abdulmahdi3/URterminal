import { ipcMain, BrowserWindow, dialog, clipboard, app, shell } from 'electron'
import { writeFile, readFile, unlink, mkdir } from 'fs/promises'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir, userInfo, homedir } from 'os'
import { join } from 'path'
import type { ClipboardContent, SessionData, LastSessionPayload, NoteDoc } from '@shared/types'
import { IPC } from '@shared/types'
import type {
  PtySpawnRequest,
  SshSpawnRequest,
  SshAgentResult,
  SshfsStatus,
  SettingsPatch,
  FileSaveRequest,
  FileSaveResult,
  GoogleTask
} from '@shared/types'
import { spawn } from 'child_process'
import { createSshPty, parseSshTarget } from '../ssh/sshPty'
import { SshAgentBridge } from '../ssh/agentBridge'
import { buildAgentInstruction } from '../ssh/ursshHelpers'
import { SshfsManager, sshfsInstalled, SSHFS_INSTALL, SSHFS_BIN } from '../ssh/sshfs'
import { PtyManager } from '../pty/manager'
import { TranscriptStore } from '../pty/transcriptStore'
import { claudeSessionInfo } from '../claude/sessions'
import { listWslDistros } from '../pty/wsl'
import { filterAvailable } from '../pty/which'
import { discoverAgents } from '../agents/discover'
import { installAgent } from '../agents/install'
import { getGitStatus } from '../git/status'
import { getPrompts, appendPrompt } from '../prompts/store'
import { searchSessions, warmSessionIndex } from '../sessions/recall'
import { expandReference } from '../references/expand'
import { CaptureService } from '../learning/capture'
import { getLearningConfig, setLearningConfig, learningRoot } from '../learning/store'
import { forgetProject as forgetLearningProject, readAllMemories, readAllSkills } from '../learning/brain'
import { readProfileDoc, writeProfileDoc, type ProfileDoc } from '../learning/profile'
import { enhancePrompt } from '../learning/enhancer'
import { listSystemProcesses, killSystemProcess } from '../system/processes'
import { SettingsStore } from '../settings/store'
import { TelegramBridge } from '../telegram/bridge'
import { computeClaudeUsage } from '../usage/claudeUsage'
import { TickTickClient, TickTickError } from '../integrations/ticktick'
import { GoogleTasksClient } from '../integrations/googleTasks'
import { translateText } from '../translate'

export interface IpcContext {
  getWindow: () => BrowserWindow | null
  pty: PtyManager
  settings: SettingsStore
  telegram: TelegramBridge
}

/** Empty per-target scratch dir used as the agent's cwd when the remote folder
 *  isn't mounted (so it doesn't open in the user's personal home). */
function sshScratchDir(target: string): string {
  const dir = join(tmpdir(), 'urterminal-ssh', target.replace(/[^A-Za-z0-9._@-]/g, '_') || 'server')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* fall back below */
  }
  return existsSync(dir) ? dir : homedir()
}

export function registerIpc(getWindow: () => BrowserWindow | null): IpcContext {
  // Send to a single window guarding against the teardown race: a PTY can fire
  // onData/onExit while a window is being destroyed (closing a workspace, app
  // quit, reload), and touching `.webContents` on a destroyed window throws
  // "Object has been destroyed" and crashes the main process.
  const sendTo = (win: BrowserWindow | null, channel: string, payload: unknown): void => {
    if (!win || win.isDestroyed()) return
    const wc = win.webContents
    if (!wc || wc.isDestroyed()) return
    wc.send(channel, payload)
  }

  // Broadcast to every open window. PTY data is keyed by paneId and each
  // renderer ignores panes it doesn't own, so fanning out to all windows is
  // safe and is what lets a second window's terminals receive their output.
  const emit = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) sendTo(win, channel, payload)
  }

  // Target a single window (the focused one). Used for actions that must NOT be
  // duplicated across windows — e.g. Telegram's "create a pane" command.
  const emitFocused = (channel: string, payload: unknown): void => {
    sendTo(getWindow(), channel, payload)
  }

  const settings = new SettingsStore()

  const telegram = new TelegramBridge(
    settings,
    getWindow,
    (inbound) => emit(IPC.telegramInbound, inbound),
    () => {
      // surface running state by pushing a fresh public settings snapshot
      emit(IPC.settingsChanged, settings.getPublic(telegram.isRunning(), telegram.getStatus().botUsername))
      emit(IPC.telegramStatusChanged, telegram.getStatus())
    },
    (createPane) => emitFocused(IPC.telegramCreatePane, createPane)
  )

  // PTY data goes to the renderer only. Telegram forwarding for terminal panes
  // is driven from the renderer (useTelegramForwarding), which extracts the
  // submitted prompt and the agent's answer blocks from the rendered screen
  // instead of streaming raw escape-code redraws.
  const pty = new PtyManager((channel, payload) => {
    emit(channel, payload)
  })

  // Learning layer: tee every agent's output + clean user turns into a local,
  // scrubbed transcript store, then run the zero-token gate. Lives wholly in main
  // so it sees each pty exactly once (multi-window-safe), and is a no-op unless
  // the user opts in (default off). New gate candidates broadcast to all windows.
  const capture = new CaptureService((candidates) => emit(IPC.learningCandidates, candidates))
  capture.setWriter((ptyId, data) => pty.write(ptyId, data))
  pty.setCaptureSink(capture)

  // Complete per-pane terminal history for full session restore (kept in main so
  // it survives regardless of renderer scrollback / which workspace is on screen).
  const transcripts = new TranscriptStore()
  pty.setTranscriptSink(transcripts)
  app.on('before-quit', () => transcripts.persistAll())

  const publicSettings = (): ReturnType<SettingsStore['getPublic']> =>
    settings.getPublic(
      telegram.isRunning(),
      telegram.getStatus().botUsername,
      telegram.getStatus().error
    )

  // ---- app info ----
  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), homeDir: homedir() }))
  // Relaunch the whole app (so a freshly installed agent is picked up from PATH).
  ipcMain.handle(IPC.appRelaunch, () => {
    app.relaunch()
    app.exit(0)
  })

  // ---- settings ----
  ipcMain.handle(IPC.settingsGet, () => publicSettings())
  ipcMain.handle(IPC.settingsPatch, async (_e, patch: SettingsPatch) => {
    const tokenChanged = patch.telegramToken !== undefined
    settings.patch(patch)
    if (tokenChanged) await telegram.start()
    const next = publicSettings()
    emit(IPC.settingsChanged, next)
    return next
  })
  // ---- telegram ----
  ipcMain.handle(IPC.telegramStatus, () => telegram.getStatus())
  ipcMain.handle(IPC.telegramRestart, () => telegram.start())
  ipcMain.handle(IPC.telegramTest, () => telegram.sendTest())
  ipcMain.handle(
    IPC.telegramLinkPane,
    (_e, { paneId, chatId }: { paneId: string; chatId: string | null }) =>
      telegram.linkPane(paneId, chatId)
  )
  ipcMain.on(IPC.telegramForward, (_e, { paneId, text }: { paneId: string; text: string }) =>
    telegram.forward(paneId, text)
  )
  ipcMain.on(
    IPC.telegramStartTurn,
    (_e, { paneId, prompt }: { paneId: string; prompt: string | null }) =>
      void telegram.startTurn(paneId, prompt)
  )
  ipcMain.on(IPC.telegramFinishTurn, (_e, { paneId, result }: { paneId: string; result: string }) =>
    void telegram.finishTurn(paneId, result)
  )
  ipcMain.on(IPC.telegramNotifyDone, (_e, { paneId, label }: { paneId: string; label: string }) =>
    void telegram.notifyDone(paneId, label)
  )

  // ---- perf ----
  // CPU% is derived from the delta of process.cpuUsage between samples so the
  // title-bar/status-bar pill shows a live, meaningful number.
  let lastCpu = process.cpuUsage()
  let lastCpuAt = Date.now()
  ipcMain.handle(IPC.perfSample, () => {
    const mem = process.memoryUsage()
    const now = Date.now()
    const cpu = process.cpuUsage(lastCpu) // micros since last call
    const elapsedMs = Math.max(1, now - lastCpuAt)
    const cpuPercent = Math.min(
      100,
      Math.round((((cpu.user + cpu.system) / 1000 / elapsedMs) * 100) * 10) / 10
    )
    lastCpu = process.cpuUsage()
    lastCpuAt = now
    return {
      mainRssMB: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      cpuPercent,
      timestamp: now
    }
  })

  // ---- claude usage (live from Anthropic's /usage endpoint) ----
  ipcMain.handle(IPC.claudeUsage, () => computeClaudeUsage())

  // ---- window controls (frameless window) ----
  // Target the window the request came FROM (via e.sender), not a global one —
  // otherwise clicking close/minimize in one window would act on another.
  const senderWindow = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(e.sender)
  ipcMain.on(IPC.windowMinimize, (e) => senderWindow(e)?.minimize())
  ipcMain.on(IPC.windowMaximizeToggle, (e) => {
    const win = senderWindow(e)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, (e) => senderWindow(e)?.close())
  ipcMain.on(IPC.windowSetZoom, (e, factor: number) => {
    const wc = senderWindow(e)?.webContents
    if (wc && !wc.isDestroyed()) wc.setZoomFactor(Math.max(0.5, Math.min(2.5, factor || 1)))
  })
  ipcMain.handle(IPC.windowIsMaximized, (e) => senderWindow(e)?.isMaximized() ?? false)
  // Recolor the native caption-button overlay so min/max/close match the theme.
  ipcMain.on(
    IPC.windowSetOverlay,
    (e, { color, symbolColor }: { color: string; symbolColor: string }) => {
      const win = senderWindow(e)
      if (!win || process.platform !== 'win32') return
      try {
        win.setTitleBarOverlay({ color, symbolColor, height: 40 })
      } catch {
        /* overlay API unavailable on this platform/version */
      }
    }
  )

  // ---- directory picker (choose folder to open an agent in) ----
  ipcMain.handle(IPC.dialogOpenDir, async (e, defaultPath?: string): Promise<string | null> => {
    const win = senderWindow(e)
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Choose a folder to open the agent in',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })

  // ---- open a folder in the OS file manager ----
  ipcMain.handle(IPC.shellOpenPath, async (_e, path: string): Promise<void> => {
    if (path) await shell.openPath(path)
  })

  // ---- file save (transcript export, etc.) ----
  ipcMain.handle(IPC.fileSave, async (e, req: FileSaveRequest): Promise<FileSaveResult> => {
    const win = senderWindow(e)
    try {
      const res = await dialog.showSaveDialog(win ?? undefined!, {
        defaultPath: req.defaultName,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      await writeFile(res.filePath, req.contents, 'utf8')
      return { ok: true, path: res.filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ---- pty ----
  ipcMain.handle(IPC.ptySpawn, (_e, req: PtySpawnRequest) => pty.spawn(req))
  ipcMain.on(IPC.ptyWrite, (_e, { ptyId, data }: { ptyId: string; data: string }) =>
    pty.write(ptyId, data)
  )
  ipcMain.on(
    IPC.ptyResize,
    (_e, { ptyId, cols, rows }: { ptyId: string; cols: number; rows: number }) =>
      pty.resize(ptyId, cols, rows)
  )
  ipcMain.on(IPC.ptyKill, (_e, { ptyId }: { ptyId: string }) => pty.kill(ptyId))
  ipcMain.handle(IPC.ptyList, () => pty.list())

  // ---- ssh (connects via ssh2, then streams through the pty channels) ----
  ipcMain.handle(IPC.sshSpawn, (_e, req: SshSpawnRequest) => {
    // Parse "user@host[:port]" → username / host / port.
    const parsed = parseSshTarget(req.target)
    const host = parsed.host
    const port = parsed.port
    const username = parsed.username || userInfo().username
    // Use the freshly-typed password, else a previously saved one.
    const password = req.password ?? settings.getSshPassword(req.target) ?? ''
    if (req.savePassword && req.password) settings.setSshPassword(req.target, req.password)

    const proc = createSshPty({ host, port, username, password, cols: req.cols, rows: req.rows })
    return pty.adopt(proc, req.paneId, `ssh ${req.target}`)
  })

  // "Agent over SSH": let a LOCAL agent operate a remote server with nothing
  // installed on it. Two pieces:
  //  1. urssh exec bridge — run commands ON the server (one reused connection).
  //  2. SSHFS mount — mount the remote folder as a local drive so the agent edits
  //     files like a normal folder. Both reuse the saved password.
  const agentBridge = new SshAgentBridge()
  const sshfs = new SshfsManager()
  app.on('before-quit', () => {
    sshfs.unmountAll()
    agentBridge.dispose()
  })
  ipcMain.handle(IPC.sshOpenAgent, async (_e, target: string): Promise<SshAgentResult> => {
    try {
      // Guard against injection: the target is embedded into a generated helper
      // script + an HTTP routing header, so only allow connection-string chars.
      if (!/^[A-Za-z0-9@._:+\-]+$/.test(target)) {
        return { ok: false, error: 'Invalid SSH target' }
      }
      const p = parseSshTarget(target)
      const username = p.username || userInfo().username
      const password = settings.getSshPassword(target) ?? ''
      if (!password) {
        return {
          ok: false,
          error:
            'No saved SSH password for this server. Reconnect with "Save credentials" so the agent can reuse the connection.'
        }
      }
      // 1) exec bridge (always)
      const { helperPath } = await agentBridge.open({ target, host: p.host, port: p.port, username, password })

      // 2) SSHFS mount (when enabled + installed) — non-fatal if it fails
      let mountPath: string | undefined
      let drive: string | undefined
      let needsSshfs = false
      let mountError: string | undefined
      if (settings.getPrefs().sshAgentMount !== false) {
        if (!sshfs.installed()) {
          needsSshfs = true
        } else {
          try {
            const m = await sshfs.mount({ target, host: p.host, port: p.port, username, password })
            mountPath = m.mountPath
            drive = m.drive
          } catch (e) {
            mountError = (e as Error).message
            console.warn(`[sshfs] mount failed for ${target}:`, mountError)
          }
        }
      }

      // Run the agent from a local working dir holding a CLAUDE.md with the
      // instructions — Claude Code reads it automatically on startup, so delivery
      // is reliable (no fragile auto-typing). The mounted folder (when present)
      // is referenced from there; without a mount this stays an empty scratch dir
      // (NOT the user's home, which would dump personal files).
      const workDir = sshScratchDir(target)
      const instruction = buildAgentInstruction(target, helperPath, mountPath)
      try {
        writeFileSync(join(workDir, 'CLAUDE.md'), instruction, 'utf8')
      } catch {
        /* non-fatal */
      }
      return { ok: true, cwd: workDir, instruction, mounted: !!mountPath, drive, needsSshfs, mountError }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle(IPC.sshfsStatus, (): SshfsStatus => {
    const installed = sshfsInstalled()
    return {
      installed,
      sshfsPath: installed ? SSHFS_BIN : undefined,
      installCommand: SSHFS_INSTALL.installCommand,
      url: SSHFS_INSTALL.url
    }
  })
  ipcMain.handle(IPC.sshfsInstall, () => {
    // Open a console that runs the winget installs (WinFsp first); the MSI step
    // triggers a UAC prompt. URterminal should be restarted afterwards.
    try {
      spawn(
        'cmd.exe',
        ['/c', 'start', 'Install SSHFS-Win', 'cmd', '/k', `${SSHFS_INSTALL.installCommand} && echo. && echo Done - restart URterminal.`],
        { windowsHide: false, detached: true, stdio: 'ignore' }
      ).unref()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  // Release a target's resources when its agent pane closes: unmount the SSHFS
  // drive and close the reused exec connection.
  ipcMain.on(IPC.sshCloseAgent, (_e, target: string) => {
    sshfs.unmount(target)
    agentBridge.disposeConn(target)
  })

  // ---- shells ----
  ipcMain.handle(IPC.shellListWsl, () => listWslDistros())
  ipcMain.handle(IPC.commandsCheck, (_e, names: string[]) => filterAvailable(names))
  ipcMain.handle(IPC.agentsDiscover, () => discoverAgents())
  ipcMain.handle(IPC.agentsInstall, (_e, command: string) => installAgent(command))
  ipcMain.handle(IPC.gitStatus, (_e, cwd: string) => getGitStatus(cwd))
  ipcMain.handle(IPC.sessionsSearch, (_e, query: string) => searchSessions(query))
  ipcMain.handle(IPC.referenceExpand, (_e, ref: string, cwd: string) => expandReference(ref, cwd))
  warmSessionIndex() // start indexing past conversations in the background
  ipcMain.handle(IPC.promptsGet, (_e, sessionId: string) => getPrompts(sessionId))
  ipcMain.on(IPC.promptsAppend, (_e, sessionId: string, text: string) =>
    appendPrompt(sessionId, text)
  )

  // ---- learning layer (local recorder; opt-in, default off) ----
  ipcMain.on(
    IPC.learningTurnMarker,
    (_e, { paneId, text, ts }: { paneId: string; text: string; ts: number }) =>
      capture.onUserTurn(paneId, text, ts)
  )
  ipcMain.handle(IPC.learningGetConfig, () => getLearningConfig())
  ipcMain.handle(IPC.learningSetConfig, (_e, patch) => setLearningConfig(patch))
  ipcMain.handle(IPC.learningOpenStore, async () => {
    await shell.openPath(learningRoot())
  })
  ipcMain.handle(IPC.learningListCandidates, () => capture.listCandidates())
  ipcMain.handle(IPC.learningDistill, async (_e, projectHash?: string) => {
    try {
      const r = await capture.distill(projectHash)
      // Surface any newly-queued review ops + refreshed candidate list to all windows.
      emit(IPC.learningCandidates, capture.listCandidates())
      return { ok: true, applied: r.applied, queued: r.queued.length, ops: r.ops.length }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.learningListMemory, (_e, projectHash?: string | null) =>
    capture.brain(projectHash ?? null)
  )
  // Full brain content (with bodies) across every scope — for the "what URterminal
  // has learned about you" viewer.
  ipcMain.handle(IPC.learningBrainView, () => ({
    memories: readAllMemories()
      .map((m) => ({
        title: m.title,
        body: m.body,
        scope: m.scope,
        confidence: m.confidence,
        updated: m.updated
      }))
      .sort((a, b) => b.confidence - a.confidence),
    skills: readAllSkills().map((s) => ({ name: s.name, description: s.description, scope: s.scope }))
  }))
  ipcMain.handle(IPC.learningGetProfile, (_e, doc: ProfileDoc) => readProfileDoc(doc))
  ipcMain.handle(IPC.learningSetProfile, (_e, doc: ProfileDoc, text: string) => {
    writeProfileDoc(doc, text)
    return true
  })
  ipcMain.handle(IPC.learningListPendingOps, () => capture.listPendingOps())
  ipcMain.handle(IPC.learningApproveOp, (_e, id: string) => capture.approveOp(id))
  ipcMain.handle(IPC.learningRejectOp, (_e, id: string) => capture.rejectOp(id))
  ipcMain.handle(IPC.learningForgetProject, (_e, projectHash: string) => {
    forgetLearningProject(projectHash)
    return { ok: true }
  })
  ipcMain.handle(IPC.learningInject, (_e, { cwd, agentId }: { cwd: string; agentId: string }) =>
    capture.injectNow(cwd, agentId)
  )
  ipcMain.handle(IPC.learningEnhance, (_e, args: { text: string; cwd?: string }) =>
    enhancePrompt(args)
  )

  // ---- clipboard (right-click paste of text + images) ----
  // Reading via the main-process clipboard module avoids renderer permission
  // prompts and lets us turn an image on the clipboard into a temp PNG file
  // whose path can be pasted into the agent/shell.
  ipcMain.handle(IPC.clipboardRead, async (): Promise<ClipboardContent> => {
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      const path = join(tmpdir(), `urterminal-paste-${Date.now()}.png`)
      await writeFile(path, img.toPNG())
      return { imagePath: path }
    }
    return { text: clipboard.readText() }
  })

  // ---- system process monitor (task manager "System" tab) ----
  ipcMain.handle(IPC.systemProcList, () => listSystemProcesses())
  ipcMain.on(IPC.systemProcKill, (_e, { pid }: { pid: number }) => killSystemProcess(pid))

  // ---- saved sessions (named workspace snapshots, stored as a JSON file) ----
  const sessionsFile = (): string => join(app.getPath('userData'), 'sessions.json')
  ipcMain.handle(IPC.sessionsRead, async (): Promise<unknown[]> => {
    try {
      const parsed = JSON.parse(await readFile(sessionsFile(), 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return [] // missing/corrupt file → no sessions yet
    }
  })
  ipcMain.handle(IPC.sessionsWrite, async (_e, sessions: unknown[]): Promise<void> => {
    try {
      await writeFile(sessionsFile(), JSON.stringify(sessions), 'utf8')
    } catch {
      /* disk errors are non-fatal */
    }
  })

  // ---- per-session chat content (terminal transcripts), one file per session ----
  // Kept separate from the metadata list above so listing/saving sessions stays
  // cheap even when transcripts are large. Stored under <userData>/session-data/.
  const sessionDataDir = (): string => join(app.getPath('userData'), 'session-data')
  const sessionDataFile = (id: string): string =>
    // guard the id so it can't escape the directory
    join(sessionDataDir(), `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`)

  ipcMain.handle(IPC.sessionDataRead, async (_e, id: string): Promise<SessionData | null> => {
    try {
      return JSON.parse(await readFile(sessionDataFile(id), 'utf8')) as SessionData
    } catch {
      return null
    }
  })
  ipcMain.handle(IPC.sessionDataWrite, async (_e, id: string, data: SessionData): Promise<void> => {
    try {
      await mkdir(sessionDataDir(), { recursive: true })
      await writeFile(sessionDataFile(id), JSON.stringify(data), 'utf8')
    } catch {
      /* non-fatal */
    }
  })
  ipcMain.handle(IPC.sessionDataDelete, async (_e, id: string): Promise<void> => {
    try {
      await unlink(sessionDataFile(id))
    } catch {
      /* already gone */
    }
  })

  // ---- auto-saved "last session" (full snapshot for close/crash restore) ----
  const lastSessionFile = (): string => join(app.getPath('userData'), 'last-session.json')
  ipcMain.handle(IPC.lastSessionRead, async (): Promise<LastSessionPayload | null> => {
    try {
      return JSON.parse(await readFile(lastSessionFile(), 'utf8')) as LastSessionPayload
    } catch {
      return null
    }
  })
  ipcMain.handle(IPC.lastSessionWrite, async (_e, payload: LastSessionPayload): Promise<void> => {
    try {
      await writeFile(lastSessionFile(), JSON.stringify(payload), 'utf8')
    } catch {
      /* non-fatal */
    }
  })
  // Synchronous flush used from the renderer's `beforeunload`, where async IPC
  // would not complete before the window is torn down.
  ipcMain.on(IPC.lastSessionFlush, (e, payload: LastSessionPayload) => {
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(lastSessionFile(), JSON.stringify(payload), 'utf8')
      transcripts.persistAll() // ensure the latest chat history hits disk too
    } catch {
      /* non-fatal */
    }
    e.returnValue = true // unblock sendSync
  })

  // ---- complete per-pane terminal history (full-fidelity session restore) ----
  ipcMain.handle(IPC.transcriptRead, (_e, paneId: string): string => transcripts.read(paneId))
  ipcMain.handle(IPC.transcriptPrime, (_e, paneId: string, text: string): void =>
    transcripts.prime(paneId, text)
  )
  ipcMain.handle(IPC.transcriptRemove, (_e, paneId: string): void => transcripts.remove(paneId))
  ipcMain.handle(IPC.transcriptPrune, (_e, keep: string[]): void => transcripts.pruneExcept(keep))

  // ---- Claude's own conversation store (~/.claude/projects) ----
  // Existence (resume vs re-create on restore) + subject title for the chats list.
  ipcMain.handle(IPC.claudeSessionInfo, (_e, sessionId: string) => claudeSessionInfo(sessionId))

  // ---- resumable-chat registry surfaced in the sessions menu (chat-sessions.json) ----
  const chatsFile = (): string => join(app.getPath('userData'), 'chat-sessions.json')
  ipcMain.handle(IPC.chatsRead, async (): Promise<unknown[]> => {
    try {
      const parsed = JSON.parse(await readFile(chatsFile(), 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return [] // missing/corrupt → no chats yet
    }
  })
  ipcMain.handle(IPC.chatsWrite, async (_e, chats: unknown[]): Promise<void> => {
    try {
      await writeFile(chatsFile(), JSON.stringify(chats), 'utf8')
    } catch {
      /* disk errors are non-fatal */
    }
  })

  // ---- TickTick OAuth + Open API proxy (main-process bearer storage) ----
  const tickTick = new TickTickClient(settings)
  // Let the Telegram bridge reach TickTick for /tasks agenda + /task quick-add.
  telegram.setTickTick(tickTick)
  const ttHandle = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      const err = e as TickTickError
      throw new Error(err.message ?? String(e))
    }
  }
  ipcMain.handle(IPC.tickTickConnect, async () => {
    await ttHandle(() => tickTick.connect())
    // Push fresh settings so the renderer updates the "Connected" pill immediately.
    emit(IPC.settingsChanged, settings.getPublic(telegram.isRunning(), telegram.getStatus().botUsername))
    return { ok: true }
  })
  ipcMain.handle(IPC.tickTickDisconnect, () => {
    tickTick.disconnect()
    emit(IPC.settingsChanged, settings.getPublic(telegram.isRunning(), telegram.getStatus().botUsername))
    return { ok: true }
  })
  ipcMain.handle(IPC.tickTickListProjects, () => ttHandle(() => tickTick.listProjects()))
  ipcMain.handle(IPC.tickTickCreateProject, (_e, input) =>
    ttHandle(() => tickTick.createProject(input))
  )
  ipcMain.handle(IPC.tickTickDeleteProject, (_e, projectId: string) =>
    ttHandle(() => tickTick.deleteProject(projectId))
  )
  ipcMain.handle(IPC.tickTickProjectData, (_e, projectId: string) =>
    ttHandle(() => tickTick.getProjectData(projectId))
  )
  ipcMain.handle(IPC.tickTickCreateTask, (_e, input) =>
    ttHandle(() => tickTick.createTask(input))
  )
  ipcMain.handle(IPC.tickTickUpdateTask, (_e, input) =>
    ttHandle(() => tickTick.updateTask(input))
  )
  ipcMain.handle(IPC.tickTickCompleteTask, (_e, ids: { projectId: string; taskId: string }) =>
    ttHandle(() => tickTick.completeTask(ids.projectId, ids.taskId))
  )
  ipcMain.handle(IPC.tickTickDeleteTask, (_e, ids: { projectId: string; taskId: string }) =>
    ttHandle(() => tickTick.deleteTask(ids.projectId, ids.taskId))
  )

  // ---- Google Tasks (bearer-token REST proxy) ----
  const googleTasks = new GoogleTasksClient(settings)
  const gtHandle = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      throw new Error((e as Error).message ?? String(e))
    }
  }
  ipcMain.handle(IPC.googleTasksVerify, async () => {
    await gtHandle(() => googleTasks.verify())
    // Surface the now-valid connection in the renderer's status pill.
    emit(IPC.settingsChanged, settings.getPublic(telegram.isRunning(), telegram.getStatus().botUsername))
    return { ok: true }
  })
  ipcMain.handle(IPC.googleTasksListLists, () => gtHandle(() => googleTasks.listTaskLists()))
  ipcMain.handle(IPC.googleTasksListTasks, (_e, args: { listId?: string; showCompleted?: boolean }) =>
    gtHandle(() => googleTasks.listTasks(args?.listId ?? '@default', args?.showCompleted ?? false))
  )
  ipcMain.handle(
    IPC.googleTasksCreateTask,
    (_e, args: { listId?: string; title: string; notes?: string; due?: string }) =>
      gtHandle(() =>
        googleTasks.createTask(args.listId ?? '@default', {
          title: args.title,
          notes: args.notes,
          due: args.due
        })
      )
  )
  ipcMain.handle(
    IPC.googleTasksUpdateTask,
    (
      _e,
      args: {
        listId: string
        taskId: string
        title?: string
        notes?: string | null
        due?: string | null
        status?: GoogleTask['status']
      }
    ) =>
      gtHandle(() =>
        googleTasks.updateTask(args.listId, args.taskId, {
          title: args.title,
          notes: args.notes,
          due: args.due,
          status: args.status
        })
      )
  )
  ipcMain.handle(IPC.googleTasksCompleteTask, (_e, ids: { listId: string; taskId: string }) =>
    gtHandle(() => googleTasks.completeTask(ids.listId, ids.taskId))
  )
  ipcMain.handle(IPC.googleTasksDeleteTask, (_e, ids: { listId: string; taskId: string }) =>
    gtHandle(() => googleTasks.deleteTask(ids.listId, ids.taskId))
  )
  ipcMain.handle(IPC.googleTasksAgenda, () => gtHandle(() => googleTasks.agendaText()))

  // ---- selection translation (Google gtx endpoint) ----
  ipcMain.handle(IPC.translateText, (_e, args: { text: string; targetLang: string }) =>
    translateText(args.text, args.targetLang)
  )

  // ---- standalone notes (app-wide, separate from per-pane notes) ----
  const notesFile = (): string => join(app.getPath('userData'), 'notes.json')
  ipcMain.handle(IPC.notesRead, async (): Promise<NoteDoc[]> => {
    try {
      const raw = await readFile(notesFile(), 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as NoteDoc[]) : []
    } catch {
      return []
    }
  })
  ipcMain.handle(IPC.notesWrite, async (_e, notes: NoteDoc[]): Promise<void> => {
    try {
      await writeFile(notesFile(), JSON.stringify(notes), 'utf8')
    } catch {
      /* non-fatal */
    }
  })

  // ---- pane registry (renderer → main sync for Telegram /panes command) ----
  ipcMain.handle(IPC.panesUpdate, (_e, panes) => telegram.setPaneRegistry(panes))

  // ---- screenshots → Telegram ----
  ipcMain.handle(IPC.screenshotPane, (_e, paneId: string) => telegram.screenshotPane(paneId))
  ipcMain.handle(IPC.screenshotWindow, () => telegram.screenshotWindow())

  // start the bot if a token is already configured
  void telegram.start()

  return { getWindow, pty, settings, telegram }
}
