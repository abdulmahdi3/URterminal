import { create } from 'zustand'
import type { MosaicNode } from 'react-mosaic-component'
import type { Pane } from '@shared/types'
import { getLeaves, removeLeaf } from '@renderer/lib/mosaicTree'
import { buildAutoLayout } from '@renderer/lib/layoutPresets'
import { repaintTerminal } from '@renderer/lib/terminalPool'
import { busyAgentCount } from '@renderer/lib/paneClose'
import { confirm } from '@renderer/store/confirm'
import { useWorkspace } from './workspace'

const uid = (): string => Math.random().toString(36).slice(2, 10)

export interface WorkspaceEntry {
  id: string
  name: string
  panes?: Record<string, Pane>
  layout?: MosaicNode<string> | null
}

interface WorkspacesState {
  list: WorkspaceEntry[]
  activeId: string
  _counter: number
  /** unread "agent/terminal finished" counts per background workspace */
  badges: Record<string, number>
  /** increment the done-badge for a workspace (ignored for the active one) */
  bumpBadge: (id: string) => void
  rename: (id: string, name: string) => void
  add: () => void
  switchTo: (id: string) => void
  remove: (id: string) => void
  /** move a pane out of the active workspace into another one, then open it there */
  movePaneTo: (paneId: string, targetId: string) => void
  /** move several panes into an existing workspace, then open it there */
  movePanesTo: (paneIds: string[], targetId: string) => void
  /** move several panes into a brand-new workspace, then open it */
  movePanesToNew: (paneIds: string[]) => void
  /** patch a pane in any workspace (active or background-snapshot) by id */
  patchPaneIn: (workspaceId: string, paneId: string, patch: Partial<Pane>) => void
  /** replace the whole workspace list + active id (session restore on launch) */
  hydrateAll: (list: WorkspaceEntry[], activeId: string) => void
}

const firstId = uid()

/**
 * Strip `ids` out of every workspace snapshot in `list` (both its `panes` map and
 * its `layout` tree), skipping `exceptId` (the active workspace, whose live state
 * is handled separately). A pane must live in exactly ONE workspace — if a stale
 * copy lingers in another workspace's snapshot, moving it again can splice the
 * same leaf into a layout twice, which crashes react-mosaic. Purging here makes
 * the move idempotent regardless of how the snapshots got out of sync.
 */
function purgeFromSnapshots(
  list: WorkspaceEntry[],
  ids: string[],
  exceptId?: string
): WorkspaceEntry[] {
  return list.map((w) => {
    if (w.id === exceptId || !w.panes) return w
    if (!ids.some((id) => w.panes![id])) return w
    const panes = { ...w.panes }
    let layout = w.layout ?? null
    for (const id of ids) {
      delete panes[id]
      layout = removeLeaf(layout, id)
    }
    return { ...w, panes, layout }
  })
}

export const useWorkspaces = create<WorkspacesState>((set, get) => ({
  list: [{ id: firstId, name: 'Workspace' }],
  activeId: firstId,
  _counter: 0,
  badges: {},

  bumpBadge: (id) =>
    set((s) => {
      if (id === s.activeId) return s
      return { badges: { ...s.badges, [id]: (s.badges[id] ?? 0) + 1 } }
    }),

  rename: (id, name) =>
    set((s) => ({ list: s.list.map((w) => (w.id === id ? { ...w, name } : w)) })),

  add: () => {
    const ws = useWorkspace.getState()
    const { list, activeId, _counter } = get()
    const savedList = list.map((w) =>
      w.id === activeId ? { ...w, panes: { ...ws.panes }, layout: ws.layout } : w
    )
    const newId = uid()
    const next = _counter + 1
    ws.hydrate({}, null)
    set({ list: [...savedList, { id: newId, name: `Workspace ${next}` }], activeId: newId, _counter: next })
  },

  switchTo: (id) => {
    const { list, activeId } = get()
    if (id === activeId) return
    const ws = useWorkspace.getState()
    const savedList = list.map((w) =>
      w.id === activeId ? { ...w, panes: { ...ws.panes }, layout: ws.layout } : w
    )
    const target = savedList.find((w) => w.id === id)
    ws.hydrate(target?.panes ?? {}, target?.layout ?? null)
    set((s) => ({ list: savedList, activeId: id, badges: { ...s.badges, [id]: 0 } }))
    // The target's terminals get re-parented into freshly mounted containers;
    // xterm renders blank after a re-parent, so repaint each across a couple of
    // frames (otherwise switching into a background workspace looks empty).
    for (const pid of getLeaves(target?.layout ?? null)) repaintTerminal(pid)
  },

  remove: (id) => {
    // Actually drop the workspace (re-reads state, since a confirm dialog may
    // have let other changes land first).
    const doRemove = (): void => {
      const { list, activeId } = get()
      // Last workspace: clear its content but keep the tab
      if (list.length <= 1) {
        if (id === activeId) useWorkspace.getState().hydrate({}, null)
        return
      }
      const remaining = list.filter((w) => w.id !== id)
      if (id === activeId) {
        const ws = useWorkspace.getState()
        const idx = list.findIndex((w) => w.id === id)
        const next = remaining[Math.max(0, idx - 1)]
        ws.hydrate(next?.panes ?? {}, next?.layout ?? null)
        set({ list: remaining, activeId: next.id })
        for (const pid of getLeaves(next?.layout ?? null)) repaintTerminal(pid)
      } else {
        set({ list: remaining })
      }
    }

    // Warn only if an agent in this workspace is mid-turn (closing stops it).
    // The active workspace's panes are live; a background one's are in its
    // snapshot. Respects the "confirm before closing a running pane" preference.
    const { list, activeId } = get()
    const panes =
      id === activeId ? useWorkspace.getState().panes : list.find((w) => w.id === id)?.panes ?? {}
    const busy = busyAgentCount(panes)
    if (busy > 0) {
      void confirm({
        title: busy === 1 ? 'Stop the running agent?' : 'Stop the running agents?',
        message:
          busy === 1
            ? 'An agent is still working in this workspace. Closing it will stop the agent and discard its turn.'
            : `${busy} agents are still working in this workspace. Closing it will stop them and discard their turns.`,
        confirmLabel: 'Close & stop',
        tone: 'danger'
      }).then((ok) => {
        if (ok) doRemove()
      })
      return
    }
    doRemove()
  },

  movePaneTo: (paneId, targetId) => {
    const { activeId, list } = get()
    if (targetId === activeId) return
    const ws = useWorkspace.getState()
    const pane = ws.panes[paneId]
    if (!pane) return
    // Detach from the active workspace WITHOUT disposing the terminal, so the
    // running CLI + scrollback survive the move (the pool is keyed by pane id).
    ws.detachPane(paneId)
    // Append into the target workspace's saved snapshot, rebuilding a balanced
    // layout (same as adding a pane) so the moved pane gets a sane size. Purge
    // the pane from any other snapshot first, and drop it from the target's
    // existing leaves, so it can never end up in the layout twice.
    const nextList = purgeFromSnapshots(list, [paneId], activeId).map((w) => {
      if (w.id !== targetId) return w
      const ids = [...getLeaves(w.layout ?? null).filter((id) => id !== paneId), paneId]
      return { ...w, panes: { ...(w.panes ?? {}), [paneId]: pane }, layout: buildAutoLayout(ids) }
    })
    set({ list: nextList })
    // Open the target workspace and focus the moved pane.
    get().switchTo(targetId)
    useWorkspace.getState().setActive(paneId)
    // The moved terminal was re-parented into a new container — repaint it.
    repaintTerminal(paneId)
  },

  movePanesTo: (paneIds, targetId) => {
    const { activeId, list } = get()
    if (targetId === activeId) return
    const ws = useWorkspace.getState()
    const moving = [...new Set(paneIds)].filter((id) => ws.panes[id])
    if (!moving.length) return
    const moved: Record<string, Pane> = {}
    for (const id of moving) moved[id] = ws.panes[id]
    // Detach all from the active workspace WITHOUT disposing their terminals.
    for (const id of moving) ws.detachPane(id)
    const movingSet = new Set(moving)
    const nextList = purgeFromSnapshots(list, moving, activeId).map((w) => {
      if (w.id !== targetId) return w
      const ids = [...getLeaves(w.layout ?? null).filter((id) => !movingSet.has(id)), ...moving]
      return { ...w, panes: { ...(w.panes ?? {}), ...moved }, layout: buildAutoLayout(ids) }
    })
    set({ list: nextList })
    get().switchTo(targetId)
    const after = useWorkspace.getState()
    after.setActive(moving[moving.length - 1])
    after.clearPaneSelection()
    for (const id of moving) repaintTerminal(id)
  },

  patchPaneIn: (workspaceId, paneId, patch) => {
    const { activeId, list } = get()
    // Active workspace's panes live in useWorkspace (not the saved snapshot),
    // so patch them through that store so the open UI re-renders.
    if (workspaceId === activeId) {
      useWorkspace.getState().updatePane(paneId, patch)
      return
    }
    set({
      list: list.map((w) => {
        if (w.id !== workspaceId) return w
        const cur = w.panes?.[paneId]
        if (!cur) return w
        return { ...w, panes: { ...w.panes, [paneId]: { ...cur, ...patch } } }
      })
    })
  },

  movePanesToNew: (paneIds) => {
    const ws = useWorkspace.getState()
    const moving = [...new Set(paneIds)].filter((id) => ws.panes[id])
    if (!moving.length) return
    const moved: Record<string, Pane> = {}
    for (const id of moving) moved[id] = ws.panes[id]
    // Detach first, then `add()` snapshots the (now-smaller) source workspace
    // correctly and switches us to a fresh empty one.
    for (const id of moving) ws.detachPane(id)
    get().add()
    const layout = buildAutoLayout(moving)
    useWorkspace.getState().hydrate(moved, layout)
    const { activeId, list } = get()
    // Purge the moved panes from every other snapshot so the new workspace is
    // their only home (guards against a stale duplicate elsewhere).
    const cleaned = purgeFromSnapshots(list, moving, activeId)
    set({ list: cleaned.map((w) => (w.id === activeId ? { ...w, panes: moved, layout } : w)) })
    const after = useWorkspace.getState()
    after.setActive(moving[moving.length - 1])
    after.clearPaneSelection()
    for (const id of moving) repaintTerminal(id)
  },

  hydrateAll: (list, activeId) => {
    const safe = list.length ? list : [{ id: uid(), name: 'Workspace' }]
    const active = safe.some((w) => w.id === activeId) ? activeId : safe[0].id
    set({ list: safe, activeId: active, badges: {} })
  }
}))
