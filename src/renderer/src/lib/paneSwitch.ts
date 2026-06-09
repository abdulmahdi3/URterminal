import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import { focusTerminal } from '@renderer/lib/terminalPool'

/** A pane flattened across every workspace, with enough context to jump + label it. */
export interface SwitchTarget {
  paneId: string
  workspaceId: string
  workspaceName: string
  /** index of the workspace in the tab list (1-based, for display) */
  workspaceIndex: number
  title: string
  type: Pane['type']
  /** agent command (ai panes) or shell binary (shell panes), for the subtitle */
  detail: string
  cwd?: string
  /** true if this pane lives in the currently active workspace */
  isActiveWorkspace: boolean
  /** true if this is the currently focused pane */
  isActivePane: boolean
}

/** One-line detail for a pane: the agent it runs, the shell, or an SSH target. */
function paneDetail(pane: Pane): string {
  if (pane.type === 'ai') return pane.agent?.command ?? 'agent'
  if (pane.type === 'shell') {
    if (pane.shell?.ssh) return `ssh · ${pane.shell.ssh.target}`
    return pane.shell?.shell || 'shell'
  }
  return 'empty'
}

/**
 * Every open pane across all workspaces, flattened for the quick-switcher.
 * The active workspace's panes are read live from `useWorkspace`; background
 * workspaces' panes come from their saved snapshots in `useWorkspaces.list`.
 * Active-workspace panes are listed first, then the others.
 */
export function collectSwitchTargets(): SwitchTarget[] {
  const wsState = useWorkspace.getState()
  const { list, activeId } = useWorkspaces.getState()
  const activePaneId = wsState.activePaneId
  const out: SwitchTarget[] = []

  list.forEach((w, i) => {
    const isActiveWs = w.id === activeId
    // Live panes for the active workspace; snapshot panes for the rest.
    const panes = isActiveWs ? wsState.panes : w.panes ?? {}
    for (const pane of Object.values(panes)) {
      out.push({
        paneId: pane.id,
        workspaceId: w.id,
        workspaceName: w.name,
        workspaceIndex: i + 1,
        title: pane.title || paneDetail(pane),
        type: pane.type,
        detail: paneDetail(pane),
        cwd: pane.type === 'ai' ? pane.agent?.cwd : pane.shell?.cwd,
        isActiveWorkspace: isActiveWs,
        isActivePane: isActiveWs && pane.id === activePaneId
      })
    }
  })

  // Active workspace first, then by workspace order; keeps "switch within this
  // workspace" hits at the top where they're most expected.
  return out.sort((a, b) => Number(b.isActiveWorkspace) - Number(a.isActiveWorkspace))
}

/**
 * Focus a pane, switching to its workspace first if it lives in a different one.
 * Mirrors what `movePaneTo` does on landing: switch, mark active, focus the term
 * (deferred a frame so the re-parented terminal has mounted before focus).
 */
export function jumpToPane(target: SwitchTarget): void {
  const wss = useWorkspaces.getState()
  if (!target.isActiveWorkspace) wss.switchTo(target.workspaceId)
  useWorkspace.getState().setActive(target.paneId)
  requestAnimationFrame(() => focusTerminal(target.paneId))
}
