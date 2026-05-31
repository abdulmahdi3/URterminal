import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { usePaneStatus, onPaneTurnComplete } from '@renderer/store/paneStatus'

/**
 * Marks an AI pane as "done" (a transient glow) when its agent finishes a turn,
 * so a pane you're not watching signals it's ready. Driven by the shared
 * turn-complete event (already skips the boot/banner turn).
 *
 * The glow is suppressed for the pane you're already focused on — you can see it
 * finish — and cleared as soon as you focus the pane (handled in PaneView) or it
 * starts another turn (handled in the status store). One concern, one place.
 */
export function useDoneGlow(): void {
  useEffect(
    () =>
      onPaneTurnComplete((paneId) => {
        const ws = useWorkspace.getState()
        const pane = ws.panes[paneId]
        if (!pane || pane.type !== 'ai') return
        // No need to glow the pane the user is actively looking at.
        if (ws.activePaneId === paneId) return
        usePaneStatus.getState().markDone(paneId)
      }),
    []
  )
}
