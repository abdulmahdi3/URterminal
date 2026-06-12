import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import { getLeaves } from '@renderer/lib/mosaicTree'
import type { DashboardState, PaneInfo } from '@shared/types'

/**
 * Pushes a workspace/pane snapshot to main whenever the layout, panes, or
 * workspace tabs change, so the web dashboard (#25) can render the app and the
 * control server can broadcast a `state` SSE event. A superset of the Telegram
 * pane registry — it also carries the workspace tabs + the focused pane.
 */
export function useDashboardSync(): void {
  useEffect(() => {
    const push = (): void => {
      const { panes, layout, activePaneId } = useWorkspace.getState()
      const leaves = getLeaves(layout)
      const paneInfos: PaneInfo[] = leaves.map((paneId, i) => {
        const p = panes[paneId]
        return {
          number: i + 1,
          id: paneId,
          type: p?.type ?? 'empty',
          title: p?.title ?? paneId,
          agentCommand: p?.agent?.command,
          shellName: p?.shell?.shell?.split(/[\\/]/).pop()?.replace(/\.exe$/i, ''),
          linkedChatId: p?.telegramChatId,
          cwd: p?.agent?.cwd ?? p?.shell?.cwd ?? p?.stream?.cwd
        }
      })
      const { list, activeId } = useWorkspaces.getState()
      const state: DashboardState = {
        workspaces: list.map((w) => ({ id: w.id, name: w.name, active: w.id === activeId })),
        panes: paneInfos,
        activePaneId
      }
      void window.api.dashboardSync(state)
    }

    push()
    const offPanes = useWorkspace.subscribe(push)
    const offWorkspaces = useWorkspaces.subscribe(push)
    return () => {
      offPanes()
      offWorkspaces()
    }
  }, [])
}
