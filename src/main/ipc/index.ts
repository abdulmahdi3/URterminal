import { ipcMain, BrowserWindow, dialog, clipboard, app, shell, Notification } from 'electron'
import { writeFile, readFile, unlink, mkdir, rename } from 'fs/promises'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir, userInfo, homedir, platform } from 'os'
import { join, resolve, isAbsolute, dirname, sep } from 'path'
import type { ClipboardContent, SessionData, LastSessionPayload, NoteDoc, OrSendRequest } from '@shared/types'
import { IPC } from '@shared/types'
import type {
  PtySpawnRequest,
  SshSpawnRequest,
  SshAgentResult,
  SshfsStatus,
  SettingsPatch,
  FileSaveRequest,
  FileSaveResult,
  DiffApplyRequest,
  DiffApplyResult,
  DashboardState,
  PtyDataEvent,
  GoogleTask,
  ProviderId,
  SshKeyInfo,
  SshConfigHost,
  SshCredential
} from '@shared/types'
import { applyPatch } from '@shared/diff'
import { runCommand } from '../uregant/exec'
import { urStart, urApprove, urDeny, urStop, urResync, urToolResult } from '../uregant/controller'
import type { UrExecRequest, UrStartRequest, UrToolResultMsg } from '@shared/uregant'
import { stripAnsi } from '../learning/ansi'
import { spawn } from 'child_process'
import { createSshPty, parseSshTarget, tcpPing } from '../ssh/sshPty'
import { listIdentityKeys, parseSshConfig } from '../ssh/sshConfig'
import { SshAgentBridge } from '../ssh/agentBridge'
import { buildAgentInstruction } from '../ssh/ursshHelpers'
import { SshfsManager } from '../ssh/sshfs'
import { PtyManager } from '../pty/manager'
import { TranscriptStore } from '../pty/transcriptStore'
import { claudeSessionInfo } from '../claude/sessions'
import { ensureClaudeConfigHealthy, prepareClaudeSpawn } from '../claude/configGuard'
import { ControlServer } from '../control/server'
import { listWslDistros } from '../pty/wsl'
import { filterAvailable } from '../pty/which'
import { discoverAgents } from '../agents/discover'
import { detectAgentStatuses } from '../agents/status'
import { installAgent } from '../agents/install'
import { streamOpenRouter, stopOpenRouter, type ChatEmit } from '../openrouter/chat'
import { fetchOpenRouterModels, fetchOpenRouterCredits } from '../openrouter/models'
import { listDirs } from '../fs/listDirs'
import { discoverModels } from '../providers/discoverModels'
import { getGitStatus } from '../git/status'
import { getPrompts, appendPrompt } from '../prompts/store'
import { searchSessions, warmSessionIndex } from '../sessions/recall'
import { expandReference } from '../references/expand'
import { readMcp, writeMcp, type McpServer } from '../mcp/config'
import { postWebhook } from '../webhook/post'
import { CaptureService } from '../learning/capture'
import { getLearningConfig, setLearningConfig, learningRoot } from '../learning/store'
import {
  forgetProject as forgetLearningProject,
  readAllMemories,
  readAllSkills,
  deleteSkillEntry,
  deleteMemoryEntry
} from '../learning/brain'
import { readProfileDoc, writeProfileDoc, type ProfileDoc } from '../learning/profile'
import { getSkillFlags, setSkillFlags, clearSkillFlags } from '../learning/skillState'
import { installSkillFromUrl } from '../learning/skillInstall'
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
  // Latest workspace/pane snapshot the renderer pushes, served to the dashboard.
  let dashState: DashboardState = { workspaces: [], panes: [], activePaneId: null }

  const pty = new PtyManager((channel, payload) => {
    emit(channel, payload)
    // Tap pane output for the web dashboard's live feed (ANSI stripped for HTML).
    if (channel === 'pty:data') {
      const p = payload as PtyDataEvent
      control.pushOutput(p.paneId, stripAnsi(p.data))
    }
  })

  // A prior run may have left ~/.claude.json corrupt (concurrent `claude` writes
  // race and truncate it). Restore it from Claude's own backup now, before any
  // pane spawns, so even a manually-typed `claude` starts clean. See configGuard.
  ensureClaudeConfigHealthy()

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

  // Local control server (#17): list/open panes + send prompts from scripts over
  // 127.0.0.1, token-gated. Input is written straight to the pane's pty; opening
  // a pane is delegated to the focused renderer (it owns the layout).
  const control = new ControlServer({
    version: () => app.getVersion(),
    listPanes: () => pty.list(),
    sendInput: (ptyId, data) => {
      if (!pty.list().some((p) => p.ptyId === ptyId)) return false
      pty.write(ptyId, data)
      return true
    },
    openPane: (spec) => emitFocused(IPC.controlOpenPane, spec),
    // ---- dashboard (#25) ----
    closePane: (paneId) => emitFocused(IPC.controlClosePane, paneId),
    switchWorkspace: (id) => emitFocused(IPC.controlSwitchWorkspace, id),
    dashboardState: () => dashState,
    paneOutput: (paneId) => {
      const text = stripAnsi(transcripts.read(paneId))
      return text.length > 40000 ? text.slice(-40000) : text
    },
    ptyIdForPane: (paneId) => pty.list().find((p) => p.paneId === paneId)?.ptyId
  })
  const startControl = (): Promise<unknown> => {
    const p = settings.getPrefs()
    return control.start({
      enabled: p.controlServerEnabled,
      port: p.controlServerPort,
      token: p.controlServerToken
    })
  }
  app.on('before-quit', () => void control.stop())

  const publicSettings = (): ReturnType<SettingsStore['getPublic']> =>
    settings.getPublic(
      telegram.isRunning(),
      telegram.getStatus().botUsername,
      telegram.getStatus().error
    )

  // ---- app info ----
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    homeDir: homedir(),
    platform: platform()
  }))
  // Relaunch the whole app (so a freshly installed agent is picked up from PATH).
  ipcMain.handle(IPC.appRelaunch, () => {
    app.relaunch()
    app.exit(0)
  })

  // ---- settings ----
  ipcMain.handle(IPC.settingsGet, () => publicSettings())
  ipcMain.handle(IPC.settingsPatch, async (_e, patch: SettingsPatch) => {
    const tokenChanged = patch.telegramToken !== undefined
    const controlChanged =
      !!patch.prefs &&
      ('controlServerEnabled' in patch.prefs ||
        'controlServerPort' in patch.prefs ||
        'controlServerToken' in patch.prefs)
    settings.patch(patch)
    if (tokenChanged) await telegram.start()
    if (controlChanged) await startControl()
    const next = publicSettings()
    emit(IPC.settingsChanged, next)
    return next
  })
  // ---- local control server ----
  ipcMain.handle(IPC.controlStatus, () => control.getStatus())
  // ---- providers (live model discovery for local servers) ----
  ipcMain.handle(
    IPC.providersDiscoverModels,
    (_e, provider: ProviderId, baseUrl?: string): Promise<string[]> =>
      // Fall back to the user's configured base URL when the caller doesn't pass one.
      discoverModels(provider, baseUrl ?? settings.getLocalBaseUrl(provider))
  )
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

  // ---- diff review: apply an approved file patch to disk ----
  ipcMain.handle(IPC.diffApply, async (_e, req: DiffApplyRequest): Promise<DiffApplyResult> => {
    try {
      if (!req.cwd || !isAbsolute(req.cwd)) {
        return { ok: false, error: 'This pane has no working folder, so the change has nowhere to apply.' }
      }
      const root = resolve(req.cwd)
      const rel = req.file.replace(/^[ab]\//, '')
      const abs = isAbsolute(rel) ? resolve(rel) : resolve(root, rel)
      // Safety: only ever write inside the pane's working folder, so an apply
      // click can never let agent output clobber an arbitrary path on disk.
      if (abs !== root && !abs.startsWith(root + sep)) {
        return { ok: false, error: `Refusing to write outside the working folder: ${req.file}` }
      }

      if (req.isDelete) {
        if (existsSync(abs)) await unlink(abs)
        return { ok: true, path: abs }
      }

      let content: string
      if (req.isNew) {
        // Build the new file straight from the additions (ignore on-disk state).
        const adds = req.hunks.flatMap((h) => h.lines.filter((l) => l[0] === '+').map((l) => l.slice(1)))
        content = adds.join('\n') + (adds.length ? '\n' : '')
      } else {
        const original = existsSync(abs) ? await readFile(abs, 'utf8') : ''
        const applied = applyPatch(original, req.hunks)
        if (!applied.ok || applied.result === undefined) {
          return { ok: false, error: applied.error ?? 'Could not apply the change.' }
        }
        content = applied.result
      }

      // Atomic write: temp file + rename, so a crash mid-write can't truncate.
      await mkdir(dirname(abs), { recursive: true })
      const tmp = `${abs}.urtmp-${process.pid}`
      await writeFile(tmp, content, 'utf8')
      await rename(tmp, abs)
      return { ok: true, path: abs }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ---- pty ----
  ipcMain.handle(IPC.ptySpawn, async (_e, req: PtySpawnRequest) => {
    // Heal ~/.claude.json if a prior race corrupted it, and stagger concurrent
    // `claude` starts so they don't corrupt it again. No-op for non-claude panes.
    await prepareClaudeSpawn(req.command)
    return pty.spawn(req)
  })
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
    // Key auth: hand the configured identity file to ssh2 (it still falls back to
    // password / agent if the key is rejected).
    const identityFile = req.authMethod === 'key' ? req.identityFile : undefined

    const proc = createSshPty({ host, port, username, password, identityFile, cols: req.cols, rows: req.rows })
    return pty.adopt(proc, req.paneId, `ssh ${req.target}`)
  })

  // Connections manager: reachability + latency for the online dots / "14ms".
  ipcMain.handle(IPC.sshPing, async (_e, target: string): Promise<number | null> => {
    const { host, port } = parseSshTarget(target)
    if (!host) return null
    return tcpPing(host, port)
  })

  // Connections manager: private keys in ~/.ssh for the identity-file picker.
  ipcMain.handle(IPC.sshListKeys, (): SshKeyInfo[] => listIdentityKeys())

  // Connections manager: parse ~/.ssh/config into importable hosts.
  ipcMain.handle(IPC.sshImportConfig, (): SshConfigHost[] => parseSshConfig())

  // Credentials vault: every saved secret (passwords today; keys are file-based).
  ipcMain.handle(IPC.sshListCredentials, (): SshCredential[] =>
    settings.getSshPasswordTargets().map((target) => ({ target, type: 'password' as const }))
  )

  // Credentials vault: forget a saved password.
  ipcMain.handle(IPC.sshDeleteCredential, (_e, target: string): void => {
    settings.setSshPassword(target, null)
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
    const s = sshfs.status()
    return {
      installed: s.installed,
      sshfsPath: s.binPath,
      installCommand: s.installCommand,
      url: s.url
    }
  })
  ipcMain.handle(IPC.sshfsInstall, () => {
    const s = sshfs.status()
    // Windows: pop a console that runs the winget installs (WinFsp first); the MSI
    // step triggers a UAC prompt. URterminal should be restarted afterwards.
    if (process.platform === 'win32') {
      try {
        spawn(
          'cmd.exe',
          ['/c', 'start', 'Install SSHFS-Win', 'cmd', '/k', `${s.installCommand} && echo. && echo Done - restart URterminal.`],
          { windowsHide: false, detached: true, stdio: 'ignore' }
        ).unref()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
    // macOS/Linux: installing FUSE + sshfs needs sudo/brew in an interactive
    // terminal, so we can't run it unattended. Surface the command for the user.
    return { ok: false, error: `Run this in a terminal, then restart URterminal:\n${s.installCommand}` }
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
  ipcMain.handle(IPC.agentsDiscover, () => discoverAgents(settings.getOllamaBaseUrl()))
  ipcMain.handle(IPC.agentsInstall, (_e, command: string) => installAgent(command))
  ipcMain.handle(IPC.agentsStatus, (_e, commands: string[]) => detectAgentStatuses(commands))
  ipcMain.handle(IPC.fsListDirs, (_e, input: string) => listDirs(input))
  ipcMain.handle(IPC.appNotify, (_e, title: string, body: string) => {
    try {
      if (Notification.isSupported()) new Notification({ title, body, silent: false }).show()
    } catch {
      /* notifications unavailable — the in-app toast already covered it */
    }
  })
  const orEmit: ChatEmit = {
    delta: (paneId, delta) => emit(IPC.openrouterDelta, { paneId, delta }),
    done: (paneId, usage, finishReason) => emit(IPC.openrouterDone, { paneId, usage, finishReason }),
    error: (paneId, message) => emit(IPC.openrouterError, { paneId, message })
  }
  ipcMain.handle(IPC.openrouterSend, (_e, req: OrSendRequest) => {
    const key = settings.getApiKey('openrouter')?.trim()
    if (!key) {
      orEmit.error(
        req.paneId,
        'Your OpenRouter API key is missing or empty — open the OpenRouter panel and paste it again.'
      )
      return
    }
    void streamOpenRouter(key, req, orEmit)
  })
  ipcMain.on(IPC.openrouterStop, (_e, paneId: string) => stopOpenRouter(paneId))

  // uregant: local AI orchestrator — loop controller lives in main (uregant/controller.ts).
  ipcMain.on(IPC.uregantStart, (_e, req: UrStartRequest) =>
    urStart(req.paneId, req.model, settings.getOllamaBaseUrl(), req.text, req.autonomy, emit)
  )
  ipcMain.on(IPC.uregantApprove, (_e, paneId: string) => urApprove(paneId, emit))
  ipcMain.on(IPC.uregantDeny, (_e, paneId: string) => urDeny(paneId, emit))
  ipcMain.on(IPC.uregantStop, (_e, paneId: string) => urStop(paneId, emit))
  ipcMain.on(IPC.uregantResync, (_e, paneId: string) => urResync(paneId, emit))
  ipcMain.on(IPC.uregantToolResult, (_e, msg: UrToolResultMsg) => urToolResult(msg.callId, msg.result))
  ipcMain.handle(IPC.uregantExec, (_e, req: UrExecRequest) => runCommand(req))
  ipcMain.handle(IPC.openrouterModels, () =>
    fetchOpenRouterModels(settings.getApiKey('openrouter')?.trim() || undefined)
  )
  ipcMain.handle(IPC.openrouterCredits, () => {
    const key = settings.getApiKey('openrouter')?.trim()
    return key ? fetchOpenRouterCredits(key) : null
  })
  ipcMain.handle(IPC.gitStatus, (_e, cwd: string) => getGitStatus(cwd))
  ipcMain.handle(IPC.sessionsSearch, (_e, query: string) => searchSessions(query))
  ipcMain.handle(IPC.referenceExpand, (_e, ref: string, cwd: string) => expandReference(ref, cwd))
  ipcMain.handle(IPC.mcpRead, (_e, cwd: string) => readMcp(cwd))
  ipcMain.handle(IPC.mcpWrite, (_e, cwd: string, servers: McpServer[]) => writeMcp(cwd, servers))

  ipcMain.on(IPC.webhookPost, (_e, url: string, text: string) => void postWebhook(url, text))
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
  ipcMain.handle(IPC.learningBrainView, () => {
    const scopeKey = (e: { scope: string; project: string }): string =>
      e.scope === 'global' ? 'global' : e.project
    return {
      memories: readAllMemories()
        .map((m) => ({
          title: m.title,
          body: m.body,
          scope: m.scope,
          slug: m.slug,
          scopeKey: scopeKey(m),
          confidence: m.confidence,
          updated: m.updated
        }))
        .sort((a, b) => b.confidence - a.confidence),
      skills: readAllSkills().map((s) => {
        const sk = scopeKey(s)
        const flags = getSkillFlags(sk, s.slug)
        return {
          name: s.name,
          description: s.description,
          scope: s.scope,
          slug: s.slug,
          scopeKey: sk,
          pinned: !!flags.pinned,
          archived: !!flags.archived
        }
      })
    }
  })
  ipcMain.handle(
    IPC.learningSkillAction,
    (_e, action: 'pin' | 'unpin' | 'archive' | 'unarchive' | 'delete', scopeKey: string, slug: string) => {
      const ph = scopeKey === 'global' ? null : scopeKey
      if (action === 'delete') {
        deleteSkillEntry(ph, slug)
        clearSkillFlags(scopeKey, slug)
      } else if (action === 'pin') setSkillFlags(scopeKey, slug, { pinned: true })
      else if (action === 'unpin') setSkillFlags(scopeKey, slug, { pinned: false })
      else if (action === 'archive') setSkillFlags(scopeKey, slug, { archived: true })
      else if (action === 'unarchive') setSkillFlags(scopeKey, slug, { archived: false })
      return true
    }
  )
  ipcMain.handle(IPC.learningMemoryDelete, (_e, scopeKey: string, slug: string) => {
    deleteMemoryEntry(scopeKey === 'global' ? null : scopeKey, slug)
    return true
  })
  ipcMain.handle(IPC.learningInstallSkill, (_e, url: string) => installSkillFromUrl(url))
  ipcMain.handle(IPC.learningTidySkills, () => {
    const daysSince = (d: string): number => {
      const t = Date.parse(d)
      return Number.isNaN(t) ? 0 : (Date.now() - t) / 86_400_000
    }
    let archived = 0
    for (const s of readAllSkills()) {
      const sk = s.scope === 'global' ? 'global' : s.project
      const flags = getSkillFlags(sk, s.slug)
      if (flags.pinned || flags.archived) continue
      if (s.confidence < 0.5 && s.hits <= 1 && daysSince(s.updated || s.created) > 45) {
        setSkillFlags(sk, s.slug, { archived: true })
        archived++
      }
    }
    return { archived }
  })
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

  // ---- dashboard state (renderer → main sync for the web dashboard) ----
  ipcMain.handle(IPC.controlDashboardSync, (_e, state: DashboardState) => {
    dashState = state
    control.notifyState()
  })

  // ---- screenshots → Telegram ----
  ipcMain.handle(IPC.screenshotPane, (_e, paneId: string) => telegram.screenshotPane(paneId))
  ipcMain.handle(IPC.screenshotWindow, () => telegram.screenshotWindow())

  // start the bot if a token is already configured
  void telegram.start()
  // start the local control server if the user enabled it
  void startControl()

  return { getWindow, pty, settings, telegram }
}
