import { app, ipcMain, BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import pkg from 'electron-updater'
import { IPC } from '@shared/types'
import type { UpdaterStatus, UpdaterCheckResult, UpdaterProgress } from '@shared/types'

// electron-updater ships as CommonJS; the named export isn't reliable under
// the ESM/bundler interop, so pull autoUpdater off the default export.
const { autoUpdater } = pkg

// Persist updater diagnostics to userData/logs/updater.log. The whole point of
// the auto-update path is that it runs unattended at quit/relaunch time, so when
// it fails there's no console to read — this file is the only trail. View it at
// %APPDATA%\URterminal\logs\updater.log on Windows.
function updaterLog(level: 'info' | 'warn' | 'error', msg: unknown): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    const text = msg instanceof Error ? (msg.stack ?? msg.message) : typeof msg === 'string' ? msg : JSON.stringify(msg)
    appendFileSync(join(dir, 'updater.log'), `[${new Date().toISOString()}] [${level}] ${text}\n`)
  } catch {
    /* logging must never throw into the update flow */
  }
}

/**
 * Wire up GitHub-based auto-update for the packaged NSIS install.
 *
 * Instead of an OS dialog, we push events to the renderer so it can show
 * an in-app update toast at the bottom of the window: "URterminal X.Y.Z is
 * ready — Restart". Clicking it sends `updater:install` back here which
 * triggers `quitAndInstall`. Falls back to no-op in dev / portable builds.
 */
export function initAutoUpdate(getWindow: () => BrowserWindow | null): void {
  // Always register the install IPC handler — the renderer can call it any
  // time and we want a clear path even if the check hasn't fired yet.
  ipcMain.handle(IPC.updaterInstall, () => {
    // isSilent=true: run the (assisted, oneClick:false) NSIS installer silently
    // in the background. With isSilent=false the updater spawns the full wizard
    // and, in update mode, frequently neither shows it nor relaunches — the app
    // just closes. Silent install + isForceRunAfter=true is the reliable path to
    // "apply update and reopen the new version".
    updaterLog('info', 'quitAndInstall requested (silent, force-run-after)')
    // Defer one tick so this IPC handler returns before the app starts quitting
    // (otherwise the renderer's installUpdate() invoke hangs through shutdown).
    try {
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(true, true)
        } catch (e) {
          updaterLog('error', e)
          console.error('[updater] quitAndInstall failed', e)
        }
      })
    } catch (e) {
      updaterLog('error', e)
      console.error('[updater] quitAndInstall failed', e)
    }
  })

  // Manual "Check for updates" from the renderer. Registered up here so it
  // always responds even in dev/portable. With autoDownload on, finding a
  // release here also kicks off the download → the existing update toast.
  ipcMain.handle(IPC.updaterCheck, async (): Promise<UpdaterCheckResult> => {
    if (!app.isPackaged) return { status: 'unsupported' }
    try {
      const result = await autoUpdater.checkForUpdates()
      // result is null only when updates are disabled for this build.
      if (!result) return { status: 'unsupported' }
      const version = result.updateInfo?.version ?? app.getVersion()
      return result.isUpdateAvailable
        ? { status: 'available', version }
        : { status: 'not-available', version }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[updater] manual check failed', message)
      return { status: 'error', message }
    }
  })

  // Auto-update only applies to an installed app. Skip dev runs entirely;
  // electron-updater also no-ops for the portable target (no install to patch).
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Route electron-updater's own chatter (download progress, install spawn, NSIS
  // exit codes) into our file log so a failed silent install leaves a trail.
  autoUpdater.logger = {
    info: (m: unknown) => updaterLog('info', m),
    warn: (m: unknown) => updaterLog('warn', m),
    error: (m: unknown) => updaterLog('error', m),
    debug: (m: unknown) => updaterLog('info', m)
  }

  const send = (channel: string, payload?: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  autoUpdater.on('error', (err) => {
    // A failed update check must never break the running app — just log it
    // and tell the renderer (lets the toast surface a "couldn't check" hint).
    const msg = err == null ? 'unknown error' : (err.stack ?? err).toString()
    updaterLog('error', msg)
    console.error('[updater]', msg)
    send(IPC.updaterError, msg)
  })

  let pendingVersion = ''
  autoUpdater.on('update-available', (info) => {
    updaterLog('info', `update-available ${info.version}`)
    pendingVersion = info.version
    const payload: UpdaterStatus = {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate
    }
    send(IPC.updaterAvailable, payload)
  })

  // Stream download progress so the renderer can show a real loading state
  // instead of an opaque wait before the "relaunch to update" action appears.
  autoUpdater.on('download-progress', (p) => {
    const payload: UpdaterProgress = {
      percent: Math.max(0, Math.min(100, p.percent)),
      version: pendingVersion || undefined
    }
    send(IPC.updaterProgress, payload)
  })

  autoUpdater.on('update-downloaded', (info) => {
    updaterLog('info', `update-downloaded ${info.version}`)
    const payload: UpdaterStatus = {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate
    }
    send(IPC.updaterDownloaded, payload)
  })

  // Fire-and-forget; the .catch keeps an offline launch from logging an
  // unhandled rejection.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] check failed', err)
  })
}
