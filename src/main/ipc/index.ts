import { ipcMain, BrowserWindow, dialog, clipboard, app, shell } from 'electron'
import { writeFile, readFile, unlink, mkdir } from 'fs/promises'
import { writeFileSync, mkdirSync } from 'fs'
import { tmpdir, userInfo } from 'os'
import { join } from 'path'
import type { ClipboardContent, SessionData, LastSessionPayload } from '@shared/types'
import { IPC } from '@shared/types'
import type {
  PtySpawnRequest,
  SshSpawnRequest,
  SettingsPatch,
  FileSaveRequest,
  FileSaveResult
} from '@shared/types'
import { createSshPty } from '../ssh/sshPty'
import { PtyManager } from '../pty/manager'
import { listWslDistros } from '../pty/wsl'
import { filterAvailable } from '../pty/which'
import { listSystemProcesses, killSystemProcess } from '../system/processes'
import { SettingsStore } from '../settings/store'
import { TelegramBridge } from '../telegram/bridge'
import { computeClaudeUsage } from '../usage/claudeUsage'

export interface IpcContext {
  getWindow: () => BrowserWindow | null
  pty: PtyManager
  settings: SettingsStore
  telegram: TelegramBridge
}

export function registerIpc(getWindow: () => BrowserWindow | null): IpcContext {
  const emit = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
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
    (createPane) => emit(IPC.telegramCreatePane, createPane)
  )

  // PTY data goes to the renderer only. Telegram forwarding for terminal panes
  // is driven from the renderer (useTelegramForwarding), which extracts the
  // submitted prompt and the agent's answer blocks from the rendered screen
  // instead of streaming raw escape-code redraws.
  const pty = new PtyManager((channel, payload) => {
    emit(channel, payload)
  })

  const publicSettings = (): ReturnType<SettingsStore['getPublic']> =>
    settings.getPublic(
      telegram.isRunning(),
      telegram.getStatus().botUsername,
      telegram.getStatus().error
    )

  // ---- app info ----
  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion() }))

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
  ipcMain.on(IPC.windowMinimize, () => getWindow()?.minimize())
  ipcMain.on(IPC.windowMaximizeToggle, () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, () => getWindow()?.close())
  ipcMain.handle(IPC.windowIsMaximized, () => getWindow()?.isMaximized() ?? false)
  // Recolor the native caption-button overlay so min/max/close match the theme.
  ipcMain.on(
    IPC.windowSetOverlay,
    (_e, { color, symbolColor }: { color: string; symbolColor: string }) => {
      const win = getWindow()
      if (!win || process.platform !== 'win32') return
      try {
        win.setTitleBarOverlay({ color, symbolColor, height: 40 })
      } catch {
        /* overlay API unavailable on this platform/version */
      }
    }
  )

  // ---- directory picker (choose folder to open an agent in) ----
  ipcMain.handle(IPC.dialogOpenDir, async (_e, defaultPath?: string): Promise<string | null> => {
    const win = getWindow()
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
  ipcMain.handle(IPC.fileSave, async (_e, req: FileSaveRequest): Promise<FileSaveResult> => {
    const win = getWindow()
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
    const trimmed = req.target.trim()
    const at = trimmed.indexOf('@')
    let username = at >= 0 ? trimmed.slice(0, at) : ''
    let rest = at >= 0 ? trimmed.slice(at + 1) : trimmed
    let port = 22
    const colon = rest.lastIndexOf(':')
    if (colon >= 0) {
      const p = parseInt(rest.slice(colon + 1), 10)
      if (!Number.isNaN(p)) {
        rest = rest.slice(0, colon)
        port = p
      }
    }
    const host = rest
    if (!username) username = userInfo().username
    // Use the freshly-typed password, else a previously saved one.
    const password = req.password ?? settings.getSshPassword(req.target) ?? ''
    if (req.savePassword && req.password) settings.setSshPassword(req.target, req.password)

    const proc = createSshPty({ host, port, username, password, cols: req.cols, rows: req.rows })
    return pty.adopt(proc, req.paneId, `ssh ${req.target}`)
  })

  // ---- shells ----
  ipcMain.handle(IPC.shellListWsl, () => listWslDistros())
  ipcMain.handle(IPC.commandsCheck, (_e, names: string[]) => filterAvailable(names))

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
    } catch {
      /* non-fatal */
    }
    e.returnValue = true // unblock sendSync
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
