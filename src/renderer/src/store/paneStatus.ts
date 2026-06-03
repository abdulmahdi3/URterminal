import { create } from 'zustand'

/**
 * Lifecycle of an AI pane within a turn:
 *  - awaiting: a prompt was submitted, waiting for the agent to start responding
 *  - working:  output is streaming
 *  - idle:     the agent finished a turn (went quiet) or is freshly waiting
 */
export type PaneStatus = 'awaiting' | 'working' | 'idle'

interface PaneStatusState {
  status: Record<string, PaneStatus>
  /**
   * Panes that finished a turn and haven't been looked at yet — drives the
   * "done" glow. A pane is marked done when its turn completes and cleared once
   * the user focuses it (PaneView) or it starts working again (set, below).
   */
  done: Record<string, boolean>
  set: (id: string, s: PaneStatus) => void
  markDone: (id: string) => void
  clearDone: (id: string) => void
  remove: (id: string) => void
}

export const usePaneStatus = create<PaneStatusState>((set) => ({
  status: {},
  done: {},
  set: (id, s) =>
    set((st) => {
      if (st.status[id] === s) return st
      // Starting a new turn (working/awaiting) clears any stale "done" glow.
      const clearGlow = (s === 'working' || s === 'awaiting') && st.done[id]
      const next: Partial<PaneStatusState> = { status: { ...st.status, [id]: s } }
      if (clearGlow) {
        const done = { ...st.done }
        delete done[id]
        next.done = done
      }
      return next
    }),
  markDone: (id) =>
    set((st) => (st.done[id] ? st : { done: { ...st.done, [id]: true } })),
  clearDone: (id) =>
    set((st) => {
      if (!st.done[id]) return st
      const done = { ...st.done }
      delete done[id]
      return { done }
    }),
  remove: (id) =>
    set((st) => {
      const hasStatus = id in st.status
      const hasDone = id in st.done
      if (!hasStatus && !hasDone) return st
      const status = { ...st.status }
      const done = { ...st.done }
      delete status[id]
      delete done[id]
      return { status, done }
    })
}))

// ---- turn-complete event (working -> idle) ----
// Features like desktop / Telegram "agent done" notifications subscribe here so
// the idle detection lives in exactly one place.
type TurnListener = (paneId: string) => void
const turnListeners = new Set<TurnListener>()

export function onPaneTurnComplete(cb: TurnListener): () => void {
  turnListeners.add(cb)
  return () => turnListeners.delete(cb)
}

export function emitPaneTurnComplete(paneId: string): void {
  turnListeners.forEach((cb) => cb(paneId))
}
