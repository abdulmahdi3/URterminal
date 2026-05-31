import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/types'
import { registerIpc, type IpcContext } from './ipc'
import { initAutoUpdate } from './updater'
import appIcon from '../../resources/icon.png?asset'
import newWindowIcon from '../../resources/new-window.ico?asset'

// The first window opened is the "primary" — it owns session restore + the
// auto-saved workspace. Every additional window is a fresh, independent
// workspace (see `secondary` query flag below).
let mainWindow: BrowserWindow | null = null
let ipc: IpcContext | null = null

/** The window IPC/dialogs/updater should target: the focused one, else any. */
function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

function createWindow(opts: { secondary?: boolean } = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    show: false,
    icon: appIcon,
    // Frameless custom title bar, but keep the NATIVE Windows caption buttons
    // (minimize / maximize / close) in the top-right via the overlay API.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#12151c',   // must match --bg-elev in global.css
      symbolColor: '#8b94a6',
      height: 40
    },
    backgroundColor: '#0b0d12',
    title: 'URterminal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // The primary window is the one that drives session restore/auto-save.
  if (!opts.secondary && (!mainWindow || mainWindow.isDestroyed())) mainWindow = win

  // Reveal the window reliably: prefer 'ready-to-show', but fall back to
  // 'did-finish-load' and a timeout so the window never stays stuck hidden.
  let shown = false
  const reveal = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
    win.focus()
  }
  win.once('ready-to-show', reveal)
  win.webContents.once('did-finish-load', reveal)
  setTimeout(reveal, 3000)

  // Tell the renderer when the OS maximize state flips so the title-bar
  // maximize/restore button can stay in sync.
  const sendMaxState = (): void => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized-changed', win.isMaximized())
  }
  win.on('maximize', sendMaxState)
  win.on('unmaximize', sendMaxState)

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return
    if (process.env.URTERMINAL_SMOKE) {
      void import('./smoke').then((m) => m.runSmoke(win))
    } else if (process.env.URTERMINAL_SMOKE_SETTINGS) {
      void import('./smoke').then((m) => m.runSettingsSmoke(win))
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Secondary windows carry `?secondary=1` so the renderer starts an empty
  // workspace and skips session restore / auto-save (which would otherwise
  // clobber the primary window's persisted session and duplicate its panes).
  const query = opts.secondary ? { secondary: '1' } : undefined
  // electron-vite injects ELECTRON_RENDERER_URL in dev.
  if (process.env['ELECTRON_RENDERER_URL']) {
    const base = process.env['ELECTRON_RENDERER_URL']
    win.loadURL(opts.secondary ? `${base}${base.includes('?') ? '&' : '?'}secondary=1` : base)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined)
  }

  return win
}

/**
 * Register the Windows jump list (right-click the taskbar/Start icon). The
 * "New Window" task relaunches the exe with `--new-window`; the single-instance
 * `second-instance` handler turns that into a fresh window on the CURRENT
 * virtual desktop instead of switching to an existing window elsewhere.
 *
 * Packaged only: in dev, `process.execPath` is the bare electron.exe and the
 * single-instance lock is disabled, so the task would launch Electron's default
 * welcome window instead of the app. We clear any task left over from a dev run.
 */
function setupJumpList(): void {
  if (process.platform !== 'win32') return
  try {
    if (!app.isPackaged) {
      app.setUserTasks([]) // remove a stale task from a previous dev session
      return
    }
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: '--new-window',
        iconPath: newWindowIcon,
        iconIndex: 0,
        title: 'New Window',
        description: 'Open a new URterminal window'
      }
    ])
  } catch {
    /* jump list unavailable — non-fatal */
  }
}

// Use a stable app name so the userData dir (settings + persisted workspace)
// is consistent across dev (`npm run dev`) and the packaged build, and never
// shares the generic "Electron" data dir with other unpackaged Electron apps.
app.setName('URterminal')

// Single-instance lock — only in the packaged app. Launching the .exe again
// focuses the existing window instead of opening a duplicate. Skipped in dev
// because electron-vite spawns a fresh Electron on every hot-restart.
const hasInstanceLock = !app.isPackaged || app.requestSingleInstanceLock()
if (!hasInstanceLock) {
  app.quit()
} else {
  // Relaunching the app (desktop/Start shortcut, or the "New Window" jump-list
  // task) fires here in the already-running instance. Open a NEW window — it
  // lands on the user's CURRENT virtual desktop — instead of focusing the
  // existing window, which would yank the user across desktops.
  app.on('second-instance', () => {
    createWindow({ secondary: true })
  })
}

app.whenReady().then(() => {
  if (!hasInstanceLock) return
  app.setAppUserModelId('com.urterminal.app')
  setupJumpList()
  ipc = registerIpc(getFocusedWindow)
  // In-app "New Window" (command palette / Ctrl+Shift+N). Unlike the jump list
  // this works in dev too, since it never relaunches the exe.
  ipcMain.on(IPC.windowOpenNew, () => createWindow({ secondary: true }))
  createWindow()
  initAutoUpdate(getFocusedWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  ipc?.pty.killAll()
  void ipc?.telegram.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  return getFocusedWindow()
}
