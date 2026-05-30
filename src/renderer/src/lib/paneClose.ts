import type { Pane } from '@shared/types'
import { usePaneStatus } from '@renderer/store/paneStatus'
import { useWorkspace } from '@renderer/store/workspace'
import { confirm } from '@renderer/store/confirm'

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

/**
 * True if the pane runs a shell with a command actively producing output
 * (tracked by usePaneActivity). An idle shell sitting at a prompt is NOT busy.
 */
export function isShellBusy(pane: Pane | undefined): boolean {
  if (pane?.type !== 'shell') return false
  return usePaneStatus.getState().status[pane.id] === 'working'
}

/** Number of panes in a set with an agent currently working. */
export function busyAgentCount(panes: Record<string, Pane>): number {
  return Object.values(panes).filter(isAgentBusy).length
}

/**
 * Resolves true if the pane may be closed. We only prompt when something is
 * actually running in the pane — a busy agent (its turn would be lost) or a
 * shell with a command still producing output. An idle pane (nothing running)
 * closes immediately with no confirmation.
 */
export async function confirmPaneClose(paneId: string): Promise<boolean> {
  const pane = useWorkspace.getState().panes[paneId]
  const agentBusy = isAgentBusy(pane)
  const shellBusy = isShellBusy(pane)
  if (!agentBusy && !shellBusy) return true // nothing running → just close

  if (agentBusy) {
    return confirm({
      title: 'Stop the running agent?',
      message:
        'An agent is still working in this pane. Closing it now will stop the agent and discard the current turn.',
      confirmLabel: 'Close & stop',
      tone: 'danger'
    })
  }
  return confirm({
    title: 'Close running terminal?',
    message: 'A command is still running in this terminal. Closing the pane will end it.',
    confirmLabel: 'Close anyway',
    tone: 'danger'
  })
}
