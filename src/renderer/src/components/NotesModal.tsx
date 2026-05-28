import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Plus, Search, NotebookPen, ListTodo, X, Check, FileText, RefreshCw, ListChecks,
  ChevronRight, ChevronDown, Calendar, Flag, Tag as TagIcon, Trash2, Save
} from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import { useSettings } from '@renderer/store/settings'
import { toast } from '@renderer/store/toasts'
import type { Pane, TodoItem, TickTickProject, TickTickTask } from '@shared/types'

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** TickTick priority codes per Open API docs. */
const TT_PRIORITIES = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 3, label: 'Medium' },
  { value: 5, label: 'High' }
]

/** Convert TickTick's "2019-11-13T03:00:00+0000" to "2019-11-13" for <input type="date">. */
function ttDateToInput(s: string | undefined): string {
  if (!s) return ''
  // Accept both "2019-11-13T03:00:00+0000" and "...+00:00"
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}
/** Convert "2024-05-28" from <input type="date"> back to TickTick's full timestamp. */
function inputToTtDate(s: string): string | undefined {
  if (!s) return undefined
  return `${s}T00:00:00+0000`
}

/**
 * Inline editor for one TickTick task. Expanded under the task row; saves
 * with a single round-trip through tickTickUpdateTask. Subtasks (`items`) are
 * managed here too since TickTick treats them as fields on the parent task.
 */
function TaskRowEditor({
  task,
  onSave,
  onDelete,
  onClose
}: {
  task: TickTickTask
  onSave: (patch: Partial<TickTickTask>) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [title, setTitle] = useState(task.title ?? '')
  const [content, setContent] = useState(task.content ?? '')
  const [desc, setDesc] = useState(task.desc ?? '')
  const [dueDate, setDueDate] = useState(ttDateToInput(task.dueDate))
  const [priority, setPriority] = useState<number>(task.priority ?? 0)
  const [tagsDraft, setTagsDraft] = useState((task.tags ?? []).join(', '))
  const [items, setItems] = useState(task.items ?? [])
  const [newItem, setNewItem] = useState('')
  const [busy, setBusy] = useState(false)

  const addItem = (): void => {
    const t = newItem.trim()
    if (!t) return
    setItems((cur) => [
      ...cur,
      { id: `new-${Date.now()}`, title: t, status: 0, sortOrder: cur.length }
    ])
    setNewItem('')
  }
  const toggleItem = (id: string): void => {
    setItems((cur) =>
      cur.map((it) =>
        it.id === id ? { ...it, status: it.status === 0 ? 1 : 0 } : it
      )
    )
  }
  const removeItem = (id: string): void => {
    setItems((cur) => cur.filter((it) => it.id !== id))
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const tags = tagsDraft
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      await onSave({
        title,
        content: content || undefined,
        desc: desc || undefined,
        dueDate: inputToTtDate(dueDate),
        priority,
        tags: tags.length ? tags : undefined,
        items: items.length ? items : undefined
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tt-task-edit">
      <input
        className="tt-edit-title"
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="tt-edit-content"
        placeholder="Content"
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <textarea
        className="tt-edit-content"
        placeholder="Description (used for checklist tasks)"
        rows={2}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
      />

      <div className="tt-edit-row">
        <label className="tt-edit-field">
          <Calendar size={11} /> Due date
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
        <label className="tt-edit-field">
          <Flag size={11} /> Priority
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {TT_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="tt-edit-field full">
        <TagIcon size={11} /> Tags (comma separated)
        <input
          type="text"
          value={tagsDraft}
          onChange={(e) => setTagsDraft(e.target.value)}
          placeholder="work, urgent"
        />
      </label>

      <div className="tt-subtasks">
        <div className="tt-subtasks-head">
          <ListTodo size={11} /> Subtasks
        </div>
        {items.length === 0 && <div className="tt-subtasks-empty">No subtasks.</div>}
        {items.map((it) => (
          <div key={it.id} className={clsx('tt-subtask', it.status !== 0 && 'done')}>
            <button
              className="notes-todo-check"
              onClick={() => toggleItem(it.id)}
              title={it.status !== 0 ? 'Mark not done' : 'Mark done'}
            >
              {it.status !== 0 ? <Check size={11} /> : null}
            </button>
            <span className="notes-todo-text">{it.title}</span>
            <button
              className="icon-btn notes-todo-del"
              title="Remove subtask"
              onClick={() => removeItem(it.id)}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <div className="notes-todo-add">
          <input
            className="notes-todo-input"
            placeholder="Add a subtask…"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addItem()
            }}
          />
          <button className="btn sm" onClick={addItem} disabled={!newItem.trim()}>
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      <div className="tt-edit-actions">
        <button className="btn primary sm" onClick={() => void save()} disabled={busy}>
          <Save size={12} /> Save
        </button>
        <button className="btn sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <span className="tt-edit-spacer" />
        <button className="btn danger sm" onClick={() => void onDelete()} disabled={busy}>
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  )
}

/**
 * Editor panel for a TickTick project. Header shows tag + due filters; each
 * task is an expandable row (click chevron to edit title/content/due/priority/
 * tags/subtasks). Completed section collapsible.
 */
function TickTickEditor({
  project,
  tasks,
  draft,
  setDraft,
  onAdd,
  onUpdate,
  onComplete,
  onDelete
}: {
  project: TickTickProject
  tasks: TickTickTask[]
  draft: string
  setDraft: (s: string) => void
  onAdd: (title: string) => Promise<void>
  onUpdate: (taskId: string, patch: Partial<TickTickTask>) => Promise<void>
  onComplete: (taskId: string) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
}): JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filterTag, setFilterTag] = useState<string>('')
  const [filterFrom, setFilterFrom] = useState<string>('')
  const [filterTo, setFilterTo] = useState<string>('')
  const [showCompleted, setShowCompleted] = useState(false)

  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const t of tasks) for (const tg of t.tags ?? []) s.add(tg)
    return [...s].sort()
  }, [tasks])

  const matchesFilters = (t: TickTickTask): boolean => {
    if (filterTag && !(t.tags ?? []).includes(filterTag)) return false
    if (filterFrom || filterTo) {
      const due = ttDateToInput(t.dueDate)
      if (!due) return false
      if (filterFrom && due < filterFrom) return false
      if (filterTo && due > filterTo) return false
    }
    return true
  }
  const open = tasks.filter((t) => (t.status ?? 0) === 0 && matchesFilters(t))
  const completed = tasks.filter((t) => (t.status ?? 0) !== 0 && matchesFilters(t))

  const priorityColor = (p: number): string | undefined => {
    if (p === 5) return '#ef4444'
    if (p === 3) return '#f59e0b'
    if (p === 1) return '#3b82f6'
    return undefined
  }

  const renderTaskRow = (t: TickTickTask, isDone: boolean): JSX.Element => {
    const isOpen = expanded === t.id
    const sub = t.items ?? []
    const subOpen = sub.filter((it) => (it.status ?? 0) === 0).length
    return (
      <div key={t.id} className={clsx('tt-task', isDone && 'done')}>
        <div className="tt-task-row">
          <button
            className="notes-todo-check"
            title={isDone ? 'Already completed' : 'Mark complete'}
            disabled={isDone}
            onClick={() => void onComplete(t.id)}
          >
            {isDone ? <Check size={11} /> : null}
          </button>
          <button
            className="tt-task-expand"
            title={isOpen ? 'Collapse' : 'Expand to edit'}
            onClick={() => setExpanded(isOpen ? null : t.id)}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <span className="notes-todo-text">
            {(t.priority ?? 0) > 0 && (
              <Flag
                size={10}
                style={{ color: priorityColor(t.priority ?? 0), marginRight: 4 }}
              />
            )}
            {t.title}
          </span>
          {t.dueDate && (
            <span className="tt-task-meta" title={`Due ${t.dueDate}`}>
              <Calendar size={10} /> {ttDateToInput(t.dueDate)}
            </span>
          )}
          {sub.length > 0 && (
            <span className="tt-task-meta" title="Subtasks">
              {subOpen}/{sub.length}
            </span>
          )}
          {(t.tags ?? []).slice(0, 3).map((tg) => (
            <span key={tg} className="tt-task-tag">
              {tg}
            </span>
          ))}
          <button
            className="icon-btn notes-todo-del"
            title="Delete"
            onClick={() => void onDelete(t.id)}
          >
            <X size={11} />
          </button>
        </div>
        {isOpen && (
          <TaskRowEditor
            task={t}
            onSave={(patch) => onUpdate(t.id, patch)}
            onDelete={() => onDelete(t.id)}
            onClose={() => setExpanded(null)}
          />
        )}
      </div>
    )
  }

  return (
    <>
      <div className="notes-editor-head">
        <div className="notes-editor-title">
          <ListChecks size={14} style={{ color: project.color ?? undefined }} />
          <span className="notes-editor-pane">{project.name}</span>
          <span className="notes-editor-ws">TickTick</span>
        </div>
      </div>

      <div className="tt-filters">
        <label className="tt-filter">
          <TagIcon size={11} /> Tag
          <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
            <option value="">All</option>
            {allTags.map((tg) => (
              <option key={tg} value={tg}>
                {tg}
              </option>
            ))}
          </select>
        </label>
        <label className="tt-filter">
          <Calendar size={11} /> Due from
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
        </label>
        <label className="tt-filter">
          to
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
        </label>
        {(filterTag || filterFrom || filterTo) && (
          <button
            className="btn sm"
            onClick={() => {
              setFilterTag('')
              setFilterFrom('')
              setFilterTo('')
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="notes-todos-section ticktick">
        <div className="notes-todos-head">
          <ListTodo size={13} />
          <span>Tasks · {open.length} open</span>
        </div>
        {open.length === 0 && completed.length === 0 && (
          <div className="notes-todos-empty">No tasks match.</div>
        )}
        {open.map((t) => renderTaskRow(t, false))}
        {completed.length > 0 && (
          <div className="notes-todos-completed">
            <button
              className="notes-todos-completed-head as-button"
              onClick={() => setShowCompleted((v) => !v)}
            >
              {showCompleted ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Completed · {completed.length}
            </button>
            {showCompleted && completed.map((t) => renderTaskRow(t, true))}
          </div>
        )}
        <div className="notes-todo-add">
          <input
            className="notes-todo-input"
            placeholder="Add a task to this project…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                void onAdd(draft.trim())
                setDraft('')
              }
            }}
          />
          <button
            className="btn sm"
            disabled={!draft.trim()}
            onClick={() => {
              if (!draft.trim()) return
              void onAdd(draft.trim())
              setDraft('')
            }}
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>
    </>
  )
}

interface PaneEntry {
  workspaceId: string
  workspaceName: string
  paneId: string
  pane: Pane
  isActive: boolean
}

/**
 * Global notes panel: walks every pane in every workspace (the active set
 * from useWorkspace plus the saved snapshots in useWorkspaces.list) and lets
 * the user read / write the per-pane notes and to-dos in one place. Edits
 * route back to useWorkspace for the active workspace and to the workspaces
 * snapshot for background ones (see patchPaneIn).
 */
export default function NotesModal(): JSX.Element {
  const show = useUi((s) => s.showNotes)
  const setShow = useUi((s) => s.setShowNotes)

  const activePanes = useWorkspace((s) => s.panes)
  const list = useWorkspaces((s) => s.list)
  const activeId = useWorkspaces((s) => s.activeId)
  const patchPaneIn = useWorkspaces((s) => s.patchPaneIn)

  const tickTickConnected = useSettings(
    (s) => s.settings?.integrations?.ticktick?.connected ?? false
  )

  type Selection =
    | { kind: 'pane'; wsId: string; paneId: string }
    | { kind: 'ticktick'; projectId: string }
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Selection | null>(null)
  const [todoDraft, setTodoDraft] = useState('')

  // ---- TickTick state (loaded lazily once the user is connected) ----
  const [ttProjects, setTtProjects] = useState<TickTickProject[]>([])
  const [ttTasksByProject, setTtTasksByProject] = useState<Record<string, TickTickTask[]>>({})
  const [ttLoading, setTtLoading] = useState(false)
  const [ttTaskDraft, setTtTaskDraft] = useState('')

  const refreshTickTick = async (): Promise<void> => {
    if (!tickTickConnected) return
    setTtLoading(true)
    try {
      const projects = await window.api.tickTickListProjects()
      setTtProjects(projects)
      const byId: Record<string, TickTickTask[]> = {}
      for (const p of projects) {
        try {
          const data = await window.api.tickTickProjectData(p.id)
          byId[p.id] = data.tasks ?? []
        } catch {
          byId[p.id] = []
        }
      }
      setTtTasksByProject(byId)
    } catch (e) {
      toast(`TickTick load failed: ${(e as Error).message}`, 'error')
    } finally {
      setTtLoading(false)
    }
  }
  // Refresh whenever the panel becomes visible AND the user is connected.
  useEffect(() => {
    if (show && tickTickConnected) void refreshTickTick()
  }, [show, tickTickConnected])

  // Auto-refresh every 60s while the panel is open + connected, so tasks added
  // on the phone or web show up without manual refresh.
  useEffect(() => {
    if (!show || !tickTickConnected) return
    const handle = window.setInterval(() => {
      void refreshTickTick()
    }, 60_000)
    return () => window.clearInterval(handle)
  }, [show, tickTickConnected])

  // Build the flat list of "every pane in every workspace". The active
  // workspace's panes live in useWorkspace; the rest are in the saved
  // snapshots on each WorkspaceEntry.panes.
  const entries: PaneEntry[] = useMemo(() => {
    const out: PaneEntry[] = []
    for (const w of list) {
      const isActive = w.id === activeId
      const source = isActive ? activePanes : (w.panes ?? {})
      for (const paneId of Object.keys(source)) {
        out.push({
          workspaceId: w.id,
          workspaceName: w.name,
          paneId,
          pane: source[paneId],
          isActive
        })
      }
    }
    return out
  }, [list, activeId, activePanes])

  // Filter by search, then group by workspace for the sidebar.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => {
      const p = e.pane
      if (p.title?.toLowerCase().includes(q)) return true
      if (e.workspaceName.toLowerCase().includes(q)) return true
      if (p.notes?.toLowerCase().includes(q)) return true
      if ((p.todos ?? []).some((t) => t.text.toLowerCase().includes(q))) return true
      return false
    })
  }, [entries, query])

  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; items: PaneEntry[] }>()
    for (const e of filtered) {
      const g = groups.get(e.workspaceId) ?? { name: e.workspaceName, items: [] }
      g.items.push(e)
      groups.set(e.workspaceId, g)
    }
    return [...groups.entries()]
  }, [filtered])

  // Resolve the currently selected pane against the live list (so updates flow).
  const sel = useMemo(() => {
    if (selected?.kind !== 'pane') return null
    return entries.find((e) => e.workspaceId === selected.wsId && e.paneId === selected.paneId) ?? null
  }, [selected, entries])

  const ttSel = useMemo(() => {
    if (selected?.kind !== 'ticktick') return null
    return ttProjects.find((p) => p.id === selected.projectId) ?? null
  }, [selected, ttProjects])

  // Auto-select the first entry on first open so the editor is never blank.
  if (show && !sel && !ttSel && entries.length > 0) {
    const first = entries[0]
    setSelected({ kind: 'pane', wsId: first.workspaceId, paneId: first.paneId })
  }

  const totalTodos = (p: Pane): { open: number; total: number } => {
    const todos = p.todos ?? []
    return { open: todos.filter((t) => !t.done).length, total: todos.length }
  }

  const updateSel = (patch: Partial<Pane>): void => {
    if (!sel) return
    patchPaneIn(sel.workspaceId, sel.paneId, patch)
  }
  const addTodo = (): void => {
    const text = todoDraft.trim()
    if (!text || !sel) return
    const item: TodoItem = { id: uid(), text, done: false }
    updateSel({ todos: [...(sel.pane.todos ?? []), item] })
    setTodoDraft('')
  }
  const toggleTodo = (todoId: string): void => {
    if (!sel) return
    updateSel({
      todos: (sel.pane.todos ?? []).map((t) =>
        t.id === todoId ? { ...t, done: !t.done } : t
      )
    })
  }
  const removeTodo = (todoId: string): void => {
    if (!sel) return
    const next = (sel.pane.todos ?? []).filter((t) => t.id !== todoId)
    updateSel({ todos: next.length ? next : undefined })
  }

  if (!show) return <></>

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal notes-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <NotebookPen size={15} /> Pane notes
          </h2>
          <button className="icon-btn" title="Close" onClick={() => setShow(false)}>
            <X size={14} />
          </button>
        </div>

        <div className="notes-layout">
          <aside className="notes-sidebar">
            <div className="notes-sidebar-head">
              <div className="notes-search">
                <Search size={13} />
                <input
                  className="notes-search-input"
                  placeholder="Search notes & to-dos…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="notes-summary">
                {entries.length} pane{entries.length === 1 ? '' : 's'} · {entries.reduce((n, e) => n + (e.pane.todos?.length ?? 0), 0)} to-dos
              </div>
            </div>

            <div className="notes-list">
              {entries.length === 0 && (
                <div className="notes-empty-list">
                  No panes yet — open a pane to start taking notes.
                </div>
              )}
              {entries.length > 0 && filtered.length === 0 && (
                <div className="notes-empty-list">No notes match.</div>
              )}
              {tickTickConnected && (
                <div className="notes-group">
                  <div className="notes-group-head notes-group-tt">
                    <span>TickTick</span>
                    <button
                      className="notes-group-refresh"
                      title="Refresh TickTick"
                      disabled={ttLoading}
                      onClick={() => void refreshTickTick()}
                    >
                      <RefreshCw size={11} />
                    </button>
                  </div>
                  {ttProjects.length === 0 && !ttLoading && (
                    <div className="notes-empty-list">No projects.</div>
                  )}
                  {ttProjects.map((p) => {
                    const tasks = ttTasksByProject[p.id] ?? []
                    const open = tasks.filter((t) => (t.status ?? 0) === 0).length
                    const isSel = ttSel?.id === p.id
                    return (
                      <button
                        key={p.id}
                        className={clsx('notes-list-item', isSel && 'active')}
                        onClick={() => setSelected({ kind: 'ticktick', projectId: p.id })}
                      >
                        <div className="notes-list-title-row">
                          <ListChecks size={11} className="notes-list-icon" style={{ color: p.color ?? undefined }} />
                          <span className="notes-list-title">{p.name}</span>
                          {open > 0 && (
                            <span className="notes-list-badge" title={`${open} open`}>
                              {open}
                            </span>
                          )}
                        </div>
                        <div className="notes-list-snippet">
                          {tasks.length === 0 ? '— no tasks —' : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
              {grouped.map(([wsId, group]) => (
                <div className="notes-group" key={wsId}>
                  <div className="notes-group-head">{group.name}{wsId === activeId && <span className="notes-group-active"> · current</span>}</div>
                  {group.items.map((e) => {
                    const { open, total } = totalTodos(e.pane)
                    const isSel = sel && sel.workspaceId === e.workspaceId && sel.paneId === e.paneId
                    const snippet = e.pane.notes?.trim() || (total ? `${total} to-do item${total === 1 ? '' : 's'}` : '— empty —')
                    return (
                      <button
                        key={`${e.workspaceId}:${e.paneId}`}
                        className={clsx('notes-list-item', isSel && 'active')}
                        onClick={() => setSelected({ kind: 'pane', wsId: e.workspaceId, paneId: e.paneId })}
                      >
                        <div className="notes-list-title-row">
                          <FileText size={11} className="notes-list-icon" />
                          <span className="notes-list-title">{e.pane.title || e.paneId}</span>
                          {open > 0 && (
                            <span className="notes-list-badge" title={`${open} open to-do`}>
                              {open}
                            </span>
                          )}
                        </div>
                        <div className="notes-list-snippet">{snippet}</div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </aside>

          <div className="notes-content">
            {ttSel ? (
              <TickTickEditor
                project={ttSel}
                tasks={ttTasksByProject[ttSel.id] ?? []}
                draft={ttTaskDraft}
                setDraft={setTtTaskDraft}
                onAdd={async (title) => {
                  try {
                    const t = await window.api.tickTickCreateTask({ projectId: ttSel.id, title })
                    setTtTasksByProject((m) => ({ ...m, [ttSel.id]: [t, ...(m[ttSel.id] ?? [])] }))
                  } catch (e) {
                    toast(`Create failed: ${(e as Error).message}`, 'error')
                  }
                }}
                onUpdate={async (taskId, patch) => {
                  try {
                    // Strip local-only ids from new subtasks before sending.
                    const items = patch.items?.map((it) =>
                      it.id?.startsWith('new-') ? { ...it, id: undefined as unknown as string } : it
                    )
                    const updated = await window.api.tickTickUpdateTask({
                      id: taskId,
                      projectId: ttSel.id,
                      ...patch,
                      ...(items ? { items } : {})
                    })
                    setTtTasksByProject((m) => ({
                      ...m,
                      [ttSel.id]: (m[ttSel.id] ?? []).map((t) =>
                        t.id === taskId ? { ...t, ...updated } : t
                      )
                    }))
                    toast('Task updated', 'ok')
                  } catch (e) {
                    toast(`Update failed: ${(e as Error).message}`, 'error')
                  }
                }}
                onComplete={async (taskId) => {
                  try {
                    await window.api.tickTickCompleteTask(ttSel.id, taskId)
                    setTtTasksByProject((m) => ({
                      ...m,
                      [ttSel.id]: (m[ttSel.id] ?? []).map((t) =>
                        t.id === taskId ? { ...t, status: 2 } : t
                      )
                    }))
                  } catch (e) {
                    toast(`Complete failed: ${(e as Error).message}`, 'error')
                  }
                }}
                onDelete={async (taskId) => {
                  try {
                    await window.api.tickTickDeleteTask(ttSel.id, taskId)
                    setTtTasksByProject((m) => ({
                      ...m,
                      [ttSel.id]: (m[ttSel.id] ?? []).filter((t) => t.id !== taskId)
                    }))
                  } catch (e) {
                    toast(`Delete failed: ${(e as Error).message}`, 'error')
                  }
                }}
              />
            ) : !sel ? (
              <div className="notes-empty-state">
                <NotebookPen size={32} strokeWidth={1.2} />
                <div>Open a pane and add a note to see it here.</div>
              </div>
            ) : (
              <>
                <div className="notes-editor-head">
                  <div className="notes-editor-title">
                    <FileText size={14} />
                    <span className="notes-editor-pane">{sel.pane.title || sel.paneId}</span>
                    <span className="notes-editor-ws">{sel.workspaceName}</span>
                  </div>
                </div>

                <label className="notes-section-label">
                  <NotebookPen size={12} /> Notes
                </label>
                <textarea
                  className="notes-body"
                  placeholder="Notes for this pane…"
                  value={sel.pane.notes ?? ''}
                  onChange={(e) => updateSel({ notes: e.target.value || undefined })}
                />

                <div className="notes-todos-section">
                  <div className="notes-todos-head">
                    <ListTodo size={13} />
                    <span>To-do list</span>
                  </div>
                  {(sel.pane.todos ?? []).length === 0 && (
                    <div className="notes-todos-empty">No to-do items yet.</div>
                  )}
                  {(sel.pane.todos ?? []).map((t) => (
                    <div key={t.id} className={clsx('notes-todo', t.done && 'done')}>
                      <button
                        className="notes-todo-check"
                        onClick={() => toggleTodo(t.id)}
                        title={t.done ? 'Mark not done' : 'Mark done'}
                      >
                        {t.done ? <Check size={11} /> : null}
                      </button>
                      <span className="notes-todo-text">{t.text}</span>
                      <button
                        className="icon-btn notes-todo-del"
                        title="Remove"
                        onClick={() => removeTodo(t.id)}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  <div className="notes-todo-add">
                    <input
                      className="notes-todo-input"
                      placeholder="Add a to-do…"
                      value={todoDraft}
                      onChange={(e) => setTodoDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addTodo()
                      }}
                    />
                    <button className="btn sm" onClick={addTodo}>
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
