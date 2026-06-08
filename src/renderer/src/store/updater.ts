import { create } from 'zustand'

/**
 * Single source of truth for the self-update lifecycle, shared by the Settings
 * "Version" control and the bottom <UpdateToast>. The main-process auto-updater
 * pushes events (available → progress → downloaded / error); a manual check from
 * Settings flows through the same phases. The UI reads `phase` to decide whether
 * to offer "Check for updates", show a download bar, or switch to "Relaunch to
 * update" — no NSIS wizard, the install is silent (see main/updater.ts).
 */
export type UpdatePhase =
  | 'idle' // nothing pending
  | 'checking' // a manual check is in flight
  | 'downloading' // a newer release is downloading (see `percent`)
  | 'ready' // downloaded and staged; awaiting relaunch
  | 'installing' // user accepted; app is quitting to apply silently
  | 'uptodate' // last check found nothing newer (transient, auto-clears)
  | 'error' // last check/download failed (see `error`)

interface UpdaterState {
  phase: UpdatePhase
  version: string
  percent: number
  error: string
  /** Trigger a manual check; resolves once the immediate verdict is known. */
  check: () => Promise<void>
  /** Apply a staged update: quit + silent install + relaunch. */
  install: () => void
}

export const useUpdater = create<UpdaterState>((set, get) => ({
  phase: 'idle',
  version: '',
  percent: 0,
  error: '',
  check: async () => {
    const p = get().phase
    if (p === 'checking' || p === 'downloading' || p === 'installing') return
    set({ phase: 'checking', error: '' })
    try {
      const res = await window.api.checkForUpdates()
      if (res.status === 'available') set({ phase: 'downloading', version: res.version, percent: 0 })
      else if (res.status === 'not-available') {
        set({ phase: 'uptodate', version: res.version })
        // Revert to the plain "Check for updates" affordance after a beat.
        window.setTimeout(() => {
          if (useUpdater.getState().phase === 'uptodate') set({ phase: 'idle' })
        }, 4000)
      } else if (res.status === 'unsupported') set({ phase: 'idle' })
      else set({ phase: 'error', error: res.message })
    } catch (e) {
      set({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
  install: () => {
    if (get().phase !== 'ready') return
    set({ phase: 'installing' })
    void window.api.installUpdate()
  }
}))

let wired = false
/**
 * Bind the main-process updater events to the store exactly once. Called from
 * the app root so background-detected updates (the startup check) and manual
 * checks share one state machine.
 */
export function wireUpdater(): void {
  if (wired) return
  wired = true
  window.api.onUpdateAvailable((s) =>
    useUpdater.setState({ phase: 'downloading', version: s.version, percent: 0, error: '' })
  )
  window.api.onUpdateProgress((p) =>
    useUpdater.setState((st) =>
      st.phase === 'downloading' || st.phase === 'checking'
        ? { phase: 'downloading', percent: Math.round(p.percent), version: p.version || st.version }
        : st
    )
  )
  window.api.onUpdateDownloaded((s) =>
    useUpdater.setState({ phase: 'ready', version: s.version, percent: 100 })
  )
  window.api.onUpdateError((msg) =>
    useUpdater.setState((st) => (st.phase === 'installing' ? st : { phase: 'error', error: msg }))
  )
}
