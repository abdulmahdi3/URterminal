import type { Pane } from '@shared/types'
import { useSettings } from '@renderer/store/settings'
import { isTerminalStarted } from '@renderer/lib/terminalPool'
import { usePaneStatus } from '@renderer/store/paneStatus'
import { useWorkspace } from '@renderer/store/workspace'

/**
 * True if the pane runs an AI agent that's mid-turn — either streaming output
 * ('working') or waiting for the agent to start replying ('awaiting'). Closing
 * such a pane stops the agent, so callers warn the user first.
 */
export function isAgentBusy(pane: Pane | undefined): boolean {
  if (pane?.type !== 'ai') return false
  const status = usePaneStatus.getState().status[pane.id]
  return status === 'working' || status === 'awaiting'
}

/** Number of panes in a set with an agent currently working. */
export function busyAgentCount(panes: Record<string, Pane>): number {
  return Object.values(panes).filter(isAgentBusy).length
}

/**
 * Returns true if the pane may be closed. A working agent always prompts (its
 * turn would be lost). Otherwise, when "confirm before close" is on and the
 * pane's process has started, ask before closing a live process. Used by both
 * the header close button and the close command.
 */
export function confirmPaneClose(paneId: string): boolean {
  const pane = useWorkspace.getState().panes[paneId]
  if (isAgentBusy(pane)) {
    return window.confirm('An agent is still working in this pane. Close it and stop the agent?')
  }
  const prefs = useSettings.getState().settings?.prefs
  if (!prefs?.confirmClose) return true
  if (!isTerminalStarted(paneId)) return true
  return window.confirm('This pane has a running process. Close it anyway?')
}
