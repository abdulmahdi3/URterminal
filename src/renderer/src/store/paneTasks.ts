import { create } from 'zustand'

/**
 * Shared agenda store for the pane title-bar note button when its source is set
 * to TickTick or Google Tasks (see `paneNotesSource`). Every pane header reads
 * from this one store, so the open-task list + badge are fetched once and shared
 * instead of each pane hitting the API. The fetch is throttled and de-duped so a
 * dozen panes (and a 60 s poller) collapse into a single network round-trip.
 */

/** A trimmed open task, normalized across both providers. */
export interface AgendaItem {
  id: string
  title: string
  /** due date stamp — TickTick's full timestamp or Google's RFC-3339; the
   *  leading "yyyy-mm-dd" is all the header needs to sort/label it. */
  due?: string
  /** TickTick projectId or Google listId — needed to complete/route the task */
  containerId: string
}

/** External provider this store proxies (the two task-based note sources). */
export type TaskSource = 'ticktick' | 'google'

interface PaneTasksState {
  /** open tasks per source (already filtered to incomplete) */
  items: Record<TaskSource, AgendaItem[]>
  /** first project/list — the target new quick-add tasks are created in */
  target: Record<TaskSource, { id: string; name: string } | null>
  loading: Record<TaskSource, boolean>
  /** epoch ms of the last successful load (throttles re-fetches) */
  loadedAt: Record<TaskSource, number>
  error: Record<TaskSource, string | null>
  /** Fetch open tasks for a source (throttled to once / 5 s unless `force`). */
  load: (source: TaskSource, force?: boolean) => Promise<void>
  /** Complete a task and drop it from the local list optimistically. */
  complete: (source: TaskSource, item: AgendaItem) => Promise<void>
  /** Create a task in the source's first project/list, then refresh. */
  add: (source: TaskSource, title: string) => Promise<void>
}

const THROTTLE_MS = 5000

async function fetchTickTick(): Promise<{ items: AgendaItem[]; target: { id: string; name: string } | null }> {
  const projects = await window.api.tickTickListProjects()
  const items: AgendaItem[] = []
  for (const p of projects) {
    try {
      const data = await window.api.tickTickProjectData(p.id)
      for (const t of data.tasks ?? []) {
        if ((t.status ?? 0) === 0) items.push({ id: t.id, title: t.title, due: t.dueDate, containerId: p.id })
      }
    } catch {
      /* skip a project that fails to load */
    }
  }
  return { items, target: projects[0] ? { id: projects[0].id, name: projects[0].name } : null }
}

async function fetchGoogle(): Promise<{ items: AgendaItem[]; target: { id: string; name: string } | null }> {
  const lists = await window.api.googleTasksListLists()
  const items: AgendaItem[] = []
  for (const l of lists) {
    try {
      const tasks = await window.api.googleTasksListTasks(l.id, false)
      for (const t of tasks) {
        if (t.status !== 'completed') items.push({ id: t.id, title: t.title, due: t.due, containerId: l.id })
      }
    } catch {
      /* skip a list that fails to load */
    }
  }
  return { items, target: lists[0] ? { id: lists[0].id, name: lists[0].title } : null }
}

export const usePaneTasks = create<PaneTasksState>((set, get) => ({
  items: { ticktick: [], google: [] },
  target: { ticktick: null, google: null },
  loading: { ticktick: false, google: false },
  loadedAt: { ticktick: 0, google: 0 },
  error: { ticktick: null, google: null },

  load: async (source, force = false) => {
    const s = get()
    if (s.loading[source]) return
    if (!force && Date.now() - s.loadedAt[source] < THROTTLE_MS) return
    set((st) => ({ loading: { ...st.loading, [source]: true } }))
    try {
      const { items, target } = source === 'ticktick' ? await fetchTickTick() : await fetchGoogle()
      set((st) => ({
        items: { ...st.items, [source]: items },
        target: { ...st.target, [source]: target },
        loadedAt: { ...st.loadedAt, [source]: Date.now() },
        error: { ...st.error, [source]: null }
      }))
    } catch (e) {
      set((st) => ({ error: { ...st.error, [source]: (e as Error).message } }))
    } finally {
      set((st) => ({ loading: { ...st.loading, [source]: false } }))
    }
  },

  complete: async (source, item) => {
    // Optimistically remove so the row disappears immediately.
    set((st) => ({
      items: { ...st.items, [source]: st.items[source].filter((t) => t.id !== item.id) }
    }))
    try {
      if (source === 'ticktick') await window.api.tickTickCompleteTask(item.containerId, item.id)
      else await window.api.googleTasksCompleteTask(item.containerId, item.id)
    } catch {
      // Re-sync from the server if the completion failed.
      await get().load(source, true)
    }
  },

  add: async (source, title) => {
    const target = get().target[source]
    if (!target) return
    if (source === 'ticktick') await window.api.tickTickCreateTask({ projectId: target.id, title })
    else await window.api.googleTasksCreateTask(target.id, { title })
    await get().load(source, true)
  }
}))
