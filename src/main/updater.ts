import { app, ipcMain, BrowserWindow } from 'electron'
import pkg from 'electron-updater'
import { IPC } from '@shared/types'
import type { UpdaterStatus } from '@shared/types'

// electron-updater ships as CommonJS; the named export isn't reliable under
// the ESM/bundler interop, so pull autoUpdater off the default export.
const { autoUpdater } = pkg

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
    // isSilent=false shows the NSIS progress; isForceRunAfter relaunches.
    try { autoUpdater.quitAndInstall(false, true) } catch (e) {
      console.error('[updater] quitAndInstall failed', e)
    }
  })

  // Auto-update only applies to an installed app. Skip dev runs entirely;
  // electron-updater also no-ops for the portable target (no install to patch).
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (channel: string, payload?: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  autoUpdater.on('error', (err) => {
    // A failed update check must never break the running app — just log it
    // and tell the renderer (lets the toast surface a "couldn't check" hint).
    const msg = err == null ? 'unknown error' : (err.stack ?? err).toString()
    console.error('[updater]', msg)
    send(IPC.updaterError, msg)
  })

  autoUpdater.on('update-available', (info) => {
    const payload: UpdaterStatus = {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate
    }
    send(IPC.updaterAvailable, payload)
  })

  autoUpdater.on('update-downloaded', (info) => {
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
