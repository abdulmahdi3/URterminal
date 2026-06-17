import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Plus, RefreshCw, Check, ListTodo, Settings as SettingsIcon, Pencil, Flag } from 'lucide-react'
import { usePaneTasks, type TaskSource, type AgendaItem } from '@renderer/store/paneTasks'
import { useUi } from '@renderer/store/ui'
import { toast } from '@renderer/store/toasts'

const SOURCE_LABEL: Record<TaskSource, string> = {
  ticktick: 'TickTick',
  google: 'Google Tasks'
}

/** TickTick priority (0/1/3/5) → a label + color class, or null for "None". */
function priorityInfo(p: number | undefined): { label: string; cls: string } | null {
  if (!p) return null
  if (p >= 5) return { label: 'High', cls: 'high' }
  if (p >= 3) return { label: 'Medium', cls: 'med' }
  return { label: 'Low', cls: 'low' }
}

/** Leading "yyyy-mm-dd" of a TickTick/Google due stamp ('' when undated). */
function dueDay(due: string | undefined): string {
  if (!due) return ''
  const m = due.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}
function localToday(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}
/** overdue / today / soon (≤2d) — drives the due chip color. */
function dueClass(due: string | undefined): string {
  const d = dueDay(due)
  if (!d) return ''
  const today = localToday()
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  if (d <= addDays(today, 2)) return 'soon'
  return ''
}
function dueLabel(due: string | undefined): string {
  const d = dueDay(due)
  if (!d) return ''
  const today = localToday()
  if (d === today) return 'Today'
  if (d === addDays(today, 1)) return 'Tomorrow'
  if (d === addDays(today, -1)) return 'Yesterday'
  return d.slice(5) // "mm-dd"
}
/** Sort open tasks: dated ascending (overdue first), undated last. */
function sortAgenda(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => {
    const da = dueDay(a.due)
    const db = dueDay(b.due)
    if (da !== db) {
      if (!da) return 1
      if (!db) return -1
      return da < db ? -1 : 1
    }
    return (a.title ?? '').localeCompare(b.title ?? '')
  })
}

/**
 * Open-task agenda shown in the pane title-bar note popover when its source is
 * TickTick or Google Tasks. Lists your open tasks (sorted by due date) with
 * check-to-complete and a quick-add to the first project/list. Reads the shared
 * `usePaneTasks` store so every pane shares one fetch.
 */
export default function PaneTaskAgenda({
  source,
  connected
}: {
  source: TaskSource
  connected: boolean
}): JSX.Element {
  const items = usePaneTasks((s) => s.items[source])
  const target = usePaneTasks((s) => s.target[source])
  const loading = usePaneTasks((s) => s.loading[source])
  const load = usePaneTasks((s) => s.load)
  const complete = usePaneTasks((s) => s.complete)
  const update = usePaneTasks((s) => s.update)
  const add = usePaneTasks((s) => s.add)
  const openSettings = useUi((s) => s.openSettings)
  const [draft, setDraft] = useState('')
  // Inline title editing: which task is open + its working text.
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const cancelEdit = useRef(false)

  // Refresh when the popover opens (throttled inside the store).
  useEffect(() => {
    if (connected) void load(source)
  }, [connected, source, load])

  const sorted = useMemo(() => sortAgenda(items), [items])

  if (!connected) {
    return (
      <div className="pane-agenda not-connected">
        <ListTodo size={16} className="pane-agenda-empty-icon" />
        <div className="pane-agenda-cta">Connect {SOURCE_LABEL[source]} to show your tasks here.</div>
        <button className="btn sm" onClick={() => openSettings('integrations')}>
          <SettingsIcon size={12} /> Open Integrations
        </button>
      </div>
    )
  }

  const submit = (): void => {
    const title = draft.trim()
    if (!title) return
    if (!target) {
      toast(`Create a list in ${SOURCE_LABEL[source]} first`, 'info')
      return
    }
    setDraft('')
    void add(source, title).catch((e) => toast(`Add failed: ${(e as Error).message}`, 'error'))
  }

  const startEdit = (t: AgendaItem): void => {
    setEditId(t.id)
    setEditText(t.title)
  }
  // Saved on blur (Enter blurs to save; Escape sets the cancel flag, then blurs).
  const finishEdit = (t: AgendaItem): void => {
    setEditId(null)
    if (cancelEdit.current) {
      cancelEdit.current = false
      return
    }
    const title = editText.trim()
    if (title && title !== t.title)
      void update(source, t, { title }).catch((e) => toast(`Edit failed: ${(e as Error).message}`, 'error'))
  }

  return (
    <div className="pane-agenda">
      <div className="pane-agenda-head">
        <span className="pane-agenda-title">
          <ListTodo size={12} /> {SOURCE_LABEL[source]} · {sorted.length}
        </span>
        <button
          className={clsx('icon-btn', loading && 'spinning')}
          title="Refresh"
          onClick={() => void load(source, true)}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="pane-agenda-list">
        {sorted.length === 0 && (
          <div className="pane-agenda-empty">{loading ? 'Loading…' : 'No open tasks 🎉'}</div>
        )}
        {sorted.map((t) => {
          const editing = editId === t.id
          const prio = priorityInfo(t.priority)
          const hasMeta = !!(t.projectName || prio || t.tags?.length)
          return (
            <div className="pane-agenda-row" key={`${t.containerId}:${t.id}`}>
              <button
                className="pane-agenda-check"
                title="Mark complete"
                onClick={() => void complete(source, t)}
              >
                <Check size={11} className="pane-agenda-check-ico" />
              </button>
              <div className="pane-agenda-main">
                {editing ? (
                  <input
                    className="pane-agenda-edit-input"
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => finishEdit(t)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      else if (e.key === 'Escape') {
                        cancelEdit.current = true
                        e.currentTarget.blur()
                      }
                    }}
                  />
                ) : (
                  <div className="pane-agenda-titlerow">
                    <span
                      className="pane-agenda-text"
                      title="Double-click to edit"
                      onDoubleClick={() => startEdit(t)}
                    >
                      {t.title}
                    </span>
                    {t.due && (
                      <span className={clsx('pane-agenda-due', dueClass(t.due))}>{dueLabel(t.due)}</span>
                    )}
                  </div>
                )}
                {!editing && hasMeta && (
                  <div className="pane-agenda-meta">
                    {t.projectName && <span className="pane-agenda-proj">{t.projectName}</span>}
                    {prio && (
                      <span className={clsx('pane-agenda-prio', prio.cls)}>
                        <Flag size={9} /> {prio.label}
                      </span>
                    )}
                    {t.tags?.map((tag) => (
                      <span key={tag} className="pane-agenda-tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                {!editing && t.content && <div className="pane-agenda-content">{t.content}</div>}
              </div>
              {!editing && (
                <button className="icon-btn pane-agenda-edit-btn" title="Edit task" onClick={() => startEdit(t)}>
                  <Pencil size={11} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="pane-agenda-add">
        <input
          className="pane-agenda-input"
          placeholder={target ? `Add to ${target.name}…` : 'Add a task…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button className="icon-btn" title="Add task" onClick={submit} disabled={!draft.trim()}>
          <Plus size={12} />
        </button>
      </div>
    </div>
  )
}
