import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { usePaneStatus, emitPaneTurnComplete } from '@renderer/store/paneStatus'
import { onTerminalInput } from '@renderer/lib/terminalPool'

// Quiet period after the last output before a turn / command counts as finished.
const IDLE_MS = 1500
// Output this soon after a keystroke, and this short, is treated as the shell
// echoing what you typed — not a running command — so an idle shell where you
// just typed doesn't look "busy".
const ECHO_WINDOW_MS = 150
const ECHO_MAX_LEN = 8

/**
 * Tracks each pane's Working / Idle status from PTY output (and Awaiting from
 * submitted input on AI panes). AI panes additionally emit a turn-complete
 * event when they go quiet (consumed by the desktop + Telegram "done"
 * notifications). Shell panes get Working / Idle only — used to decide whether
 * closing the pane needs a confirmation (a command is actively running).
 */
export function usePaneActivity(): void {
  useEffect(() => {
    const timers = new Map<string, number>()
    const working = new Set<string>()
    // The first working->idle transition per AI pane is its boot/banner
    // finishing, not a real answer — skip emitting it so "done" notifications
    // don't fire on launch.
    const completedOnce = new Set<string>()
    // Last keystroke time per shell pane, for echo filtering.
    const lastInputAt = new Map<string, number>()
    const paneType = (id: string): string | undefined =>
      useWorkspace.getState().panes[id]?.type

    const markWorking = (paneId: string, isAi: boolean): void => {
      working.add(paneId)
      usePaneStatus.getState().set(paneId, 'working')
      const prev = timers.get(paneId)
      if (prev) window.clearTimeout(prev)
      timers.set(
        paneId,
        window.setTimeout(() => {
          timers.delete(paneId)
          if (working.delete(paneId)) {
            usePaneStatus.getState().set(paneId, 'idle')
            if (isAi) {
              if (completedOnce.has(paneId)) emitPaneTurnComplete(paneId)
              else completedOnce.add(paneId)
            }
          }
        }, IDLE_MS)
      )
    }

    const offData = window.api.onPtyData((e) => {
      const type = paneType(e.paneId)
      if (type === 'ai') {
        markWorking(e.paneId, true)
      } else if (type === 'shell') {
        // Ignore keystroke echoes so a freshly-typed but not-yet-run command
        // line doesn't register as a running process.
        const sinceInput = Date.now() - (lastInputAt.get(e.paneId) ?? 0)
        if (sinceInput < ECHO_WINDOW_MS && e.data.length <= ECHO_MAX_LEN) return
        markWorking(e.paneId, false)
      }
    })

    const offInput = onTerminalInput((paneId, data) => {
      const type = paneType(paneId)
      if (type === 'shell') {
        lastInputAt.set(paneId, Date.now())
        return
      }
      if (type !== 'ai') return
      // A submitted line (Enter) before any output means the agent is about to work.
      if (/[\r\n]/.test(data) && !working.has(paneId)) {
        usePaneStatus.getState().set(paneId, 'awaiting')
      }
    })

    return () => {
      offData()
      offInput()
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [])
}
