import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Plus, Search, NotebookPen, ListTodo, X, Check, FileText, RefreshCw, ListChecks,
  ChevronRight, ChevronDown, Calendar, Flag, Tag as TagIcon, Trash2, Save,
  Sun, CalendarDays, AlarmClock, Inbox, Clock, Bell, Repeat
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

/** Local "yyyy-mm-dd" for today (matches ttDateToInput's date-only format). */
function localToday(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
/** Add n days to a "yyyy-mm-dd" string, returning the same format. */
function addDaysStr(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${dt.getFullYear()}-${mm}-${dd}`
}

/** The browser/OS IANA timezone, e.g. "Asia/Baghdad" (falls back to UTC). */
function localTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
/** Current UTC offset as a "+0300" / "-0500" string for timed ISO stamps. */
function localOffset(): string {
  const mins = -new Date().getTimezoneOffset()
  const sign = mins >= 0 ? '+' : '-'
  const abs = Math.abs(mins)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`
}
/**
 * Split a TickTick timestamp into <input>-friendly date + time. All-day tasks
 * use the raw date portion (never local-converted — that would shift the day
 * across the UTC boundary); timed tasks are converted to local wall-clock.
 */
function ttDatePart(s: string | undefined, allDay: boolean): { date: string; time: string } {
  if (!s) return { date: '', time: '' }
  if (allDay) return { date: ttDateToInput(s), time: '' }
  const d = new Date(s)
  if (isNaN(d.getTime())) return { date: ttDateToInput(s), time: '' }
  const p = (n: number): string => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`
  }
}
/** Build a TickTick timestamp from date + optional time (all-day → midnight UTC). */
function composeTt(date: string, time: string, allDay: boolean): string | undefined {
  if (!date) return undefined
  if (allDay || !time) return `${date}T00:00:00+0000`
  return `${date}T${time}:00${localOffset()}`
}

const REMINDER_OPTS: Array<{ value: string; label: string; trigger: string }> = [
  { value: 'none', label: 'No reminder', trigger: '' },
  { value: 'ontime', label: 'At time of task', trigger: 'TRIGGER:PT0S' },
  { value: '5m', label: '5 minutes before', trigger: 'TRIGGER:-PT5M' },
  { value: '30m', label: '30 minutes before', trigger: 'TRIGGER:-PT30M' },
  { value: '1h', label: '1 hour before', trigger: 'TRIGGER:-PT1H' },
  { value: '1d', label: '1 day before', trigger: 'TRIGGER:-P1D' }
]
const REPEAT_OPTS: Array<{ value: string; label: string; rrule: string }> = [
  { value: 'none', label: "Doesn't repeat", rrule: '' },
  { value: 'daily', label: 'Daily', rrule: 'RRULE:FREQ=DAILY;INTERVAL=1' },
  { value: 'weekly', label: 'Weekly', rrule: 'RRULE:FREQ=WEEKLY;INTERVAL=1' },
  { value: 'monthly', label: 'Monthly', rrule: 'RRULE:FREQ=MONTHLY;INTERVAL=1' },
  { value: 'yearly', label: 'Yearly', rrule: 'RRULE:FREQ=YEARLY;INTERVAL=1' }
]
/** Map a stored reminder trigger back to one of our presets ('none' if unknown). */
function deriveReminder(task: TickTickTask): string {
  const first = (task.reminders ?? [])[0]
  if (!first) return 'none'
  return REMINDER_OPTS.find((o) => o.trigger && o.trigger === first)?.value ?? 'ontime'
}
/** Map a stored repeatFlag (RRULE) back to a preset by its FREQ. */
function deriveRepeat(task: TickTickTask): string {
  const flag = task.repeatFlag
  if (!flag) return 'none'
  const freq = flag.match(/FREQ=([A-Z]+)/)?.[1]
  const byFreq: Record<string, string> = {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    YEARLY: 'yearly'
  }
  return freq ? byFreq[freq] ?? 'none' : 'none'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** CSS modifier class for a task's priority (drives the left accent bar). */
function priorityClass(p?: number): string {
  if ((p ?? 0) >= 5) return 'pri-high'
  if ((p ?? 0) >= 3) return 'pri-med'
  if ((p ?? 0) >= 1) return 'pri-low'
  return ''
}
/** CSS modifier for a due date relative to today: overdue / today / soon. */
function dueClass(due?: string): string {
  const d = ttDateToInput(due)
  if (!d) return ''
  const today = localToday()
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  if (d <= addDaysStr(today, 2)) return 'soon'
  return ''
}
/** Human-readable due label: Today / Tomorrow / Yesterday / "May 30" / "May 30, 2027". */
function dueLabel(due?: string): string {
  const d = ttDateToInput(due)
  if (!d) return ''
  const today = localToday()
  if (d === today) return 'Today'
  if (d === addDaysStr(today, 1)) return 'Tomorrow'
  if (d === addDaysStr(today, -1)) return 'Yesterday'
  const [y, m, day] = d.split('-').map(Number)
  const base = `${MONTHS[m - 1]} ${day}`
  return String(y) === today.slice(0, 4) ? base : `${base}, ${y}`
}

export type SmartView = 'today' | 'next7' | 'overdue' | 'all'

const SMART_VIEWS: Array<{ id: SmartView; label: string; icon: typeof Sun }> = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'next7', label: 'Next 7 days', icon: CalendarDays },
  { id: 'overdue', label: 'Overdue', icon: AlarmClock },
  { id: 'all', label: 'All tasks', icon: Inbox }
]

/** Sort by due date ascending (undated last), then by priority descending. */
function sortTasks(tasks: TickTickTask[]): TickTickTask[] {
  return [...tasks].sort((a, b) => {
    const da = ttDateToInput(a.dueDate)
    const db = ttDateToInput(b.dueDate)
    if (da !== db) {
      if (!da) return 1
      if (!db) return -1
      return da < db ? -1 : 1
    }
    return (b.priority ?? 0) - (a.priority ?? 0)
  })
}

/** Parsed quick-add fields. */
export interface QuickAdd {
  title: string
  priority?: number
  tags?: string[]
  dueDate?: string
}

/**
 * Parse a quick-add string into TickTick fields:
 *   #tag            → tag (repeatable)
 *   ! / !! / !!!    → priority low / medium / high
 *   today/tomorrow  → due date
 *   +Nd             → due in N days
 * Everything left over (collapsed whitespace) becomes the title.
 */
function parseQuickAdd(raw: string): QuickAdd {
  let text = ` ${raw} `
  const tags: string[] = []
  text = text.replace(/\s#([^\s#]+)/g, (_m, tag: string) => {
    tags.push(tag)
    return ' '
  })
  let priority: number | undefined
  const prio = text.match(/\s(!{1,3})(?=\s)/)
  if (prio) {
    priority = prio[1].length === 3 ? 5 : prio[1].length === 2 ? 3 : 1
    text = text.replace(prio[0], ' ')
  }
  const today = localToday()
  let due: string | undefined
  if (/\btomorrow\b/i.test(text)) {
    due = addDaysStr(today, 1)
    text = text.replace(/\btomorrow\b/i, ' ')
  } else if (/\btoday\b/i.test(text)) {
    due = today
    text = text.replace(/\btoday\b/i, ' ')
  }
  const nd = text.match(/\s\+(\d+)d\b/i)
  if (nd) {
    due = addDaysStr(today, parseInt(nd[1], 10))
    text = text.replace(nd[0], ' ')
  }
  return {
    title: text.replace(/\s+/g, ' ').trim(),
    priority,
    tags: tags.length ? tags : undefined,
    dueDate: due ? inputToTtDate(due) : undefined
  }
}

/** Quick-add bar shown above every TickTick view; parses tokens on submit. */
function TtQuickAdd({
  targetName,
  onAdd
}: {
  targetName: string
  onAdd: (parsed: QuickAdd) => Promise<void>
}): JSX.Element {
  const [val, setVal] = useState('')
  const submit = (): void => {
    const parsed = parseQuickAdd(val)
    if (!parsed.title) return
    void onAdd(parsed)
    setVal('')
  }
  return (
    <div className="tt-quickadd">
      <Plus size={14} className="tt-quickadd-icon" />
      <input
        className="tt-quickadd-input"
        placeholder={`Add to ${targetName}…  e.g.  Email Sam #work !! tomorrow`}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <button className="btn sm primary" disabled={!val.trim()} onClick={submit}>
        Add
      </button>
    </div>
  )
}

/** True if a task matches a lower-cased search query (title/content/desc/tags). */
function taskMatchesQuery(t: TickTickTask, q: string): boolean {
  if (t.title?.toLowerCase().includes(q)) return true
  if (t.content?.toLowerCase().includes(q)) return true
  if (t.desc?.toLowerCase().includes(q)) return true
  if ((t.tags ?? []).some((tg) => tg.toLowerCase().includes(q))) return true
  return false
}

/** Filter the full open-task set down to one smart view, sorted for display. */
function filterSmart(tasks: TickTickTask[], view: SmartView): TickTickTask[] {
  const open = tasks.filter((t) => (t.status ?? 0) === 0)
  if (view === 'all') return sortTasks(open)
  const today = localToday()
  if (view === 'overdue') {
    return sortTasks(open.filter((t) => {
      const d = ttDateToInput(t.dueDate)
      return !!d && d < today
    }))
  }
  if (view === 'today') {
    return sortTasks(open.filter((t) => ttDateToInput(t.dueDate) === today))
  }
  // next7: due today through today+7 inclusive
  const end = addDaysStr(today, 7)
  return sortTasks(open.filter((t) => {
    const d = ttDateToInput(t.dueDate)
    return !!d && d >= today && d <= end
  }))
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
  const allDayInit = task.isAllDay ?? true
  const dueInit = ttDatePart(task.dueDate, allDayInit)
  const startInit = ttDatePart(task.startDate, allDayInit)
  const [allDay, setAllDay] = useState(allDayInit)
  const [dueDate, setDueDate] = useState(dueInit.date)
  const [dueTime, setDueTime] = useState(dueInit.time)
  const [startDate, setStartDate] = useState(startInit.date)
  const [startTime, setStartTime] = useState(startInit.time)
  const [reminder, setReminder] = useState(deriveReminder(task))
  const [repeat, setRepeat] = useState(deriveRepeat(task))
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
      const reminderTrigger = REMINDER_OPTS.find((o) => o.value === reminder)?.trigger ?? ''
      const repeatRrule = REPEAT_OPTS.find((o) => o.value === repeat)?.rrule ?? ''
      await onSave({
        title,
        content: content || undefined,
        desc: desc || undefined,
        isAllDay: allDay,
        dueDate: composeTt(dueDate, dueTime, allDay),
        startDate: composeTt(startDate, startTime, allDay),
        timeZone: dueDate || startDate ? localTz() : undefined,
        reminders: dueDate || startDate ? (reminderTrigger ? [reminderTrigger] : []) : undefined,
        repeatFlag: dueDate ? repeatRrule : undefined,
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

      <div className="tt-sched">
        <label className="tt-sched-allday">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          All-day
        </label>

        <div className="tt-edit-row">
          <label className="tt-edit-field">
            <Calendar size={11} /> Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          {!allDay && (
            <label className="tt-edit-field">
              <Clock size={11} /> Start time
              <input
                type="time"
                value={startTime}
                disabled={!startDate}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="tt-edit-row">
          <label className="tt-edit-field">
            <Calendar size={11} /> Due date
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          {!allDay && (
            <label className="tt-edit-field">
              <Clock size={11} /> Due time
              <input
                type="time"
                value={dueTime}
                disabled={!dueDate}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="tt-edit-row">
          <label className="tt-edit-field">
            <Bell size={11} /> Reminder
            <select
              value={reminder}
              disabled={!dueDate && !startDate}
              onChange={(e) => setReminder(e.target.value)}
            >
              {REMINDER_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tt-edit-field">
            <Repeat size={11} /> Repeat
            <select
              value={repeat}
              disabled={!dueDate}
              onChange={(e) => setRepeat(e.target.value)}
            >
              {REPEAT_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="tt-edit-row">
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
 * One task row, shared by the per-project editor and the smart views. Shows
 * the completion checkbox, an expand chevron (opens the inline TaskRowEditor),
 * title + priority flag, optional project label (smart views span projects),
 * due date, subtask count, and tags.
 */
function TtTaskRow({
  task,
  isDone,
  isOpen,
  onToggleExpand,
  onComplete,
  onUpdate,
  onDelete,
  projectLabel
}: {
  task: TickTickTask
  isDone: boolean
  isOpen: boolean
  onToggleExpand: () => void
  onComplete: () => Promise<void>
  onUpdate: (patch: Partial<TickTickTask>) => Promise<void>
  onDelete: () => Promise<void>
  projectLabel?: { name: string; color?: string }
}): JSX.Element {
  const sub = task.items ?? []
  const subOpen = sub.filter((it) => (it.status ?? 0) === 0).length
  return (
    <div className={clsx('tt-task', isDone && 'done', !isDone && priorityClass(task.priority))}>
      <div className="tt-task-row">
        <button
          className={clsx('notes-todo-check', 'tt-check', isDone && 'checked')}
          title={isDone ? 'Already completed' : 'Mark complete'}
          disabled={isDone}
          onClick={() => void onComplete()}
        >
          {isDone ? <Check size={12} /> : null}
        </button>
        <button
          className="tt-task-expand"
          title={isOpen ? 'Collapse' : 'Expand to edit'}
          onClick={onToggleExpand}
        >
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="tt-task-title">{task.title}</span>
        <div className="tt-task-meta-group">
          {projectLabel && (
            <span className="tt-task-project" title={projectLabel.name}>
              <span
                className="tt-project-dot"
                style={{ background: projectLabel.color ?? 'var(--text-faint)' }}
              />
              {projectLabel.name}
            </span>
          )}
          {sub.length > 0 && (
            <span className="tt-task-meta" title="Subtasks">
              <ListChecks size={11} /> {subOpen}/{sub.length}
            </span>
          )}
          {(task.tags ?? []).slice(0, 3).map((tg) => (
            <span key={tg} className="tt-task-tag">
              #{tg}
            </span>
          ))}
          {task.dueDate && (
            <span
              className={clsx('tt-due', dueClass(task.dueDate))}
              title={`Due ${ttDateToInput(task.dueDate)}`}
            >
              <Calendar size={11} /> {dueLabel(task.dueDate)}
            </span>
          )}
        </div>
        <button className="icon-btn notes-todo-del tt-task-del" title="Delete" onClick={() => void onDelete()}>
          <X size={12} />
        </button>
      </div>
      {isOpen && (
        <TaskRowEditor
          task={task}
          onSave={onUpdate}
          onDelete={onDelete}
          onClose={onToggleExpand}
        />
      )}
    </div>
  )
}

/**
 * Aggregated read/edit list across every project (used by smart views and
 * search results). Tasks carry their own projectId so the mutation handlers
 * are project-scoped per row, and each row shows a project label.
 */
function TickTickTaskList({
  title,
  icon: Icon,
  tasks,
  projectsById,
  emptyText,
  onUpdate,
  onComplete,
  onDelete
}: {
  title: string
  icon: typeof Sun
  tasks: TickTickTask[]
  projectsById: Record<string, TickTickProject>
  emptyText: string
  onUpdate: (projectId: string, taskId: string, patch: Partial<TickTickTask>) => Promise<void>
  onComplete: (projectId: string, taskId: string) => Promise<void>
  onDelete: (projectId: string, taskId: string) => Promise<void>
}): JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <>
      <div className="notes-editor-head">
        <div className="notes-editor-title">
          <Icon size={14} />
          <span className="notes-editor-pane">{title}</span>
          <span className="notes-editor-ws">TickTick</span>
        </div>
      </div>

      <div className="notes-todos-section ticktick">
        <div className="notes-todos-head">
          <ListTodo size={13} />
          <span>{title} · {tasks.length}</span>
        </div>
        {tasks.length === 0 && <div className="notes-todos-empty">{emptyText}</div>}
        {tasks.map((t) => (
          <TtTaskRow
            key={t.id}
            task={t}
            isDone={(t.status ?? 0) !== 0}
            isOpen={expanded === t.id}
            onToggleExpand={() => setExpanded(expanded === t.id ? null : t.id)}
            onComplete={() => onComplete(t.projectId, t.id)}
            onUpdate={(patch) => onUpdate(t.projectId, t.id, patch)}
            onDelete={() => onDelete(t.projectId, t.id)}
            projectLabel={{
              name: projectsById[t.projectId]?.name ?? 'Inbox',
              color: projectsById[t.projectId]?.color
            }}
          />
        ))}
      </div>
    </>
  )
}

/** Smart filter view (Today / Next 7 days / Overdue / All tasks). */
function TickTickSmartView({
  view,
  tasks,
  projectsById,
  onUpdate,
  onComplete,
  onDelete
}: {
  view: SmartView
  tasks: TickTickTask[]
  projectsById: Record<string, TickTickProject>
  onUpdate: (projectId: string, taskId: string, patch: Partial<TickTickTask>) => Promise<void>
  onComplete: (projectId: string, taskId: string) => Promise<void>
  onDelete: (projectId: string, taskId: string) => Promise<void>
}): JSX.Element {
  const meta = SMART_VIEWS.find((v) => v.id === view)!
  return (
    <TickTickTaskList
      title={meta.label}
      icon={meta.icon}
      tasks={tasks}
      projectsById={projectsById}
      emptyText={view === 'overdue' ? 'Nothing overdue 🎉' : 'No tasks here.'}
      onUpdate={onUpdate}
      onComplete={onComplete}
      onDelete={onDelete}
    />
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
  onDelete,
  onDeleteProject
}: {
  project: TickTickProject
  tasks: TickTickTask[]
  draft: string
  setDraft: (s: string) => void
  onAdd: (title: string) => Promise<void>
  onUpdate: (taskId: string, patch: Partial<TickTickTask>) => Promise<void>
  onComplete: (taskId: string) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onDeleteProject: () => Promise<void>
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

  const renderTaskRow = (t: TickTickTask, isDone: boolean): JSX.Element => (
    <TtTaskRow
      key={t.id}
      task={t}
      isDone={isDone}
      isOpen={expanded === t.id}
      onToggleExpand={() => setExpanded(expanded === t.id ? null : t.id)}
      onComplete={() => onComplete(t.id)}
      onUpdate={(patch) => onUpdate(t.id, patch)}
      onDelete={() => onDelete(t.id)}
    />
  )

  return (
    <>
      <div className="notes-editor-head">
        <div className="notes-editor-title">
          <ListChecks size={14} style={{ color: project.color ?? undefined }} />
          <span className="notes-editor-pane">{project.name}</span>
          <span className="notes-editor-ws">TickTick</span>
        </div>
        <button
          className="icon-btn"
          title="Delete this list"
          onClick={() => void onDeleteProject()}
        >
          <Trash2 size={13} />
        </button>
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
    | { kind: 'tt-smart'; view: SmartView }
    | { kind: 'tt-search' }
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Selection | null>(null)
  const [todoDraft, setTodoDraft] = useState('')

  // Which source the panel is showing: local pane notes, TickTick, or the
  // (not-yet-built) Google Tasks integration.
  type NotesTab = 'notes' | 'ticktick' | 'google'
  const [notesTab, setNotesTab] = useState<NotesTab>('notes')
  const isTtSelection = (s: Selection | null): boolean =>
    s?.kind === 'ticktick' || s?.kind === 'tt-smart' || s?.kind === 'tt-search'

  // ---- TickTick state (loaded lazily once the user is connected) ----
  const [ttProjects, setTtProjects] = useState<TickTickProject[]>([])
  const [ttTasksByProject, setTtTasksByProject] = useState<Record<string, TickTickTask[]>>({})
  const [ttLoading, setTtLoading] = useState(false)
  const [ttTaskDraft, setTtTaskDraft] = useState('')
  const [ttNewProject, setTtNewProject] = useState('')
  const [ttAddingProject, setTtAddingProject] = useState(false)

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

  const ttSmart = selected?.kind === 'tt-smart' ? selected.view : null
  const ttSearch = selected?.kind === 'tt-search'

  // Flat task set + project lookup for the cross-project smart views.
  const projectsById = useMemo(
    () => Object.fromEntries(ttProjects.map((p) => [p.id, p])) as Record<string, TickTickProject>,
    [ttProjects]
  )
  const allTtTasks = useMemo(
    () => Object.values(ttTasksByProject).flat(),
    [ttTasksByProject]
  )
  const smartCounts = useMemo(() => {
    const c: Record<SmartView, number> = { today: 0, next7: 0, overdue: 0, all: 0 }
    for (const v of SMART_VIEWS) c[v.id] = filterSmart(allTtTasks, v.id).length
    return c
  }, [allTtTasks])
  const smartTasks = useMemo(
    () => (ttSmart ? filterSmart(allTtTasks, ttSmart) : []),
    [ttSmart, allTtTasks]
  )

  // TickTick task matches for the global search box (shared `query`).
  const ttSearchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return sortTasks(allTtTasks.filter((t) => taskMatchesQuery(t, q)))
  }, [query, allTtTasks])

  // Auto-select the first pane on first open (Notes tab) so it's never blank.
  if (show && notesTab === 'notes' && !sel && entries.length > 0) {
    const first = entries[0]
    setSelected({ kind: 'pane', wsId: first.workspaceId, paneId: first.paneId })
  }

  // Switch source tabs, seeding a sensible default selection for the new tab.
  const switchTab = (tab: NotesTab): void => {
    if (tab === 'google' || tab === notesTab) return
    setNotesTab(tab)
    setQuery('')
    if (tab === 'ticktick') {
      if (!isTtSelection(selected)) setSelected({ kind: 'tt-smart', view: 'today' })
    } else if (entries.length > 0) {
      if (selected?.kind !== 'pane') {
        const first = entries[0]
        setSelected({ kind: 'pane', wsId: first.workspaceId, paneId: first.paneId })
      }
    } else {
      setSelected(null)
    }
  }

  // ---- Project-scoped TickTick mutations (shared by editor + smart views) ----
  const ttCreate = async (projectId: string, title: string): Promise<void> => {
    try {
      const t = await window.api.tickTickCreateTask({ projectId, title })
      setTtTasksByProject((m) => ({ ...m, [projectId]: [t, ...(m[projectId] ?? [])] }))
    } catch (e) {
      toast(`Create failed: ${(e as Error).message}`, 'error')
    }
  }
  const ttQuickAdd = async (projectId: string, parsed: QuickAdd): Promise<void> => {
    try {
      const t = await window.api.tickTickCreateTask({ projectId, ...parsed })
      setTtTasksByProject((m) => ({ ...m, [projectId]: [t, ...(m[projectId] ?? [])] }))
      toast('Task added', 'ok')
    } catch (e) {
      toast(`Create failed: ${(e as Error).message}`, 'error')
    }
  }
  const ttUpdate = async (
    projectId: string,
    taskId: string,
    patch: Partial<TickTickTask>
  ): Promise<void> => {
    try {
      // Strip local-only ids from new subtasks before sending.
      const items = patch.items?.map((it) =>
        it.id?.startsWith('new-') ? { ...it, id: undefined as unknown as string } : it
      )
      const updated = await window.api.tickTickUpdateTask({
        id: taskId,
        projectId,
        ...patch,
        ...(items ? { items } : {})
      })
      setTtTasksByProject((m) => ({
        ...m,
        [projectId]: (m[projectId] ?? []).map((t) => (t.id === taskId ? { ...t, ...updated } : t))
      }))
      toast('Task updated', 'ok')
    } catch (e) {
      toast(`Update failed: ${(e as Error).message}`, 'error')
    }
  }
  const ttComplete = async (projectId: string, taskId: string): Promise<void> => {
    try {
      await window.api.tickTickCompleteTask(projectId, taskId)
      setTtTasksByProject((m) => ({
        ...m,
        [projectId]: (m[projectId] ?? []).map((t) => (t.id === taskId ? { ...t, status: 2 } : t))
      }))
    } catch (e) {
      toast(`Complete failed: ${(e as Error).message}`, 'error')
    }
  }
  const ttDelete = async (projectId: string, taskId: string): Promise<void> => {
    try {
      await window.api.tickTickDeleteTask(projectId, taskId)
      setTtTasksByProject((m) => ({
        ...m,
        [projectId]: (m[projectId] ?? []).filter((t) => t.id !== taskId)
      }))
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, 'error')
    }
  }

  const ttCreateProject = async (name: string): Promise<void> => {
    const n = name.trim()
    if (!n) return
    try {
      const p = await window.api.tickTickCreateProject({ name: n })
      setTtProjects((cur) => [...cur, p])
      setTtTasksByProject((m) => ({ ...m, [p.id]: [] }))
      setTtNewProject('')
      setTtAddingProject(false)
      setSelected({ kind: 'ticktick', projectId: p.id })
      toast(`List "${p.name}" created`, 'ok')
    } catch (e) {
      toast(`Create list failed: ${(e as Error).message}`, 'error')
    }
  }
  const ttDeleteProject = async (projectId: string): Promise<void> => {
    if (
      !window.confirm('Delete this list and all its tasks on TickTick? This cannot be undone.')
    )
      return
    try {
      await window.api.tickTickDeleteProject(projectId)
      setTtProjects((cur) => cur.filter((p) => p.id !== projectId))
      setTtTasksByProject((m) => {
        const next = { ...m }
        delete next[projectId]
        return next
      })
      setSelected(null)
      toast('List deleted', 'ok')
    } catch (e) {
      toast(`Delete list failed: ${(e as Error).message}`, 'error')
    }
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

        <div className="notes-tabs" role="tablist">
          <button
            role="tab"
            className={clsx('notes-tab', notesTab === 'notes' && 'active')}
            onClick={() => switchTab('notes')}
          >
            <NotebookPen size={13} /> Notes
          </button>
          <button
            role="tab"
            className={clsx('notes-tab', notesTab === 'ticktick' && 'active')}
            onClick={() => switchTab('ticktick')}
          >
            <ListChecks size={13} /> TickTick
            {tickTickConnected && smartCounts.today > 0 && (
              <span className="notes-tab-badge">{smartCounts.today}</span>
            )}
          </button>
          <button
            role="tab"
            className="notes-tab disabled"
            disabled
            title="Google Tasks — coming soon"
          >
            <ListChecks size={13} /> Google Tasks
            <span className="notes-tab-soon">soon</span>
          </button>
        </div>

        <div className="notes-layout">
          <aside className="notes-sidebar">
            <div className="notes-sidebar-head">
              <div className="notes-search">
                <Search size={13} />
                <input
                  className="notes-search-input"
                  placeholder={
                    notesTab === 'ticktick' ? 'Search TickTick tasks…' : 'Search notes & to-dos…'
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="notes-summary">
                {notesTab === 'ticktick'
                  ? `${ttProjects.length} list${ttProjects.length === 1 ? '' : 's'} · ${allTtTasks.filter((t) => (t.status ?? 0) === 0).length} open`
                  : `${entries.length} pane${entries.length === 1 ? '' : 's'} · ${entries.reduce((n, e) => n + (e.pane.todos?.length ?? 0), 0)} to-dos`}
              </div>
            </div>

            <div className="notes-list">
              {notesTab === 'notes' && entries.length === 0 && (
                <div className="notes-empty-list">
                  No panes yet — open a pane to start taking notes.
                </div>
              )}
              {notesTab === 'notes' && entries.length > 0 && filtered.length === 0 && (
                <div className="notes-empty-list">No notes match.</div>
              )}
              {notesTab === 'ticktick' && !tickTickConnected && (
                <div className="notes-empty-list">
                  TickTick isn’t connected. Connect it in Settings → Integrations.
                </div>
              )}
              {notesTab === 'ticktick' && tickTickConnected && (
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
                  {query.trim() && (
                    <button
                      className={clsx('notes-smart-view', ttSearch && 'active')}
                      onClick={() => setSelected({ kind: 'tt-search' })}
                    >
                      <Search size={12} className="notes-smart-icon" />
                      <span className="notes-smart-label">Search results</span>
                      {ttSearchResults.length > 0 && (
                        <span className="notes-list-badge">{ttSearchResults.length}</span>
                      )}
                    </button>
                  )}
                  <div className="notes-smart-views">
                    {SMART_VIEWS.map((v) => {
                      const Icon = v.icon
                      const count = smartCounts[v.id]
                      const isSel = ttSmart === v.id
                      return (
                        <button
                          key={v.id}
                          className={clsx('notes-smart-view', isSel && 'active')}
                          onClick={() => setSelected({ kind: 'tt-smart', view: v.id })}
                        >
                          <Icon size={12} className="notes-smart-icon" />
                          <span className="notes-smart-label">{v.label}</span>
                          {count > 0 && (
                            <span
                              className={clsx('notes-list-badge', v.id === 'overdue' && 'danger')}
                              title={`${count} task${count === 1 ? '' : 's'}`}
                            >
                              {count}
                            </span>
                          )}
                        </button>
                      )
                    })}
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
                  {ttAddingProject ? (
                    <div className="notes-newlist">
                      <input
                        className="notes-todo-input"
                        autoFocus
                        placeholder="New list name…"
                        value={ttNewProject}
                        onChange={(e) => setTtNewProject(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void ttCreateProject(ttNewProject)
                          if (e.key === 'Escape') {
                            setTtAddingProject(false)
                            setTtNewProject('')
                          }
                        }}
                      />
                      <button
                        className="btn sm"
                        disabled={!ttNewProject.trim()}
                        onClick={() => void ttCreateProject(ttNewProject)}
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <button
                      className="notes-newlist-trigger"
                      onClick={() => setTtAddingProject(true)}
                    >
                      <Plus size={12} /> New list
                    </button>
                  )}
                </div>
              )}
              {notesTab === 'notes' && grouped.map(([wsId, group]) => (
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
            {notesTab === 'ticktick' ? (
              !tickTickConnected ? (
                <div className="notes-empty-state">
                  <ListChecks size={32} strokeWidth={1.2} />
                  <div>Connect TickTick in Settings → Integrations to see your tasks here.</div>
                </div>
              ) : (
                <>
                  {(() => {
                    const target = ttSel ?? ttProjects[0]
                    return target ? (
                      <TtQuickAdd
                        targetName={target.name}
                        onAdd={(parsed) => ttQuickAdd(target.id, parsed)}
                      />
                    ) : null
                  })()}
                  {ttSearch ? (
                    <TickTickTaskList
                      title={query.trim() ? `Search · "${query.trim()}"` : 'Search'}
                      icon={Search}
                      tasks={ttSearchResults}
                      projectsById={projectsById}
                      emptyText={
                        query.trim() ? 'No tasks match your search.' : 'Type in the search box above.'
                      }
                      onUpdate={ttUpdate}
                      onComplete={ttComplete}
                      onDelete={ttDelete}
                    />
                  ) : ttSmart ? (
                    <TickTickSmartView
                      view={ttSmart}
                      tasks={smartTasks}
                      projectsById={projectsById}
                      onUpdate={ttUpdate}
                      onComplete={ttComplete}
                      onDelete={ttDelete}
                    />
                  ) : ttSel ? (
                    <TickTickEditor
                      project={ttSel}
                      tasks={ttTasksByProject[ttSel.id] ?? []}
                      draft={ttTaskDraft}
                      setDraft={setTtTaskDraft}
                      onAdd={(title) => ttCreate(ttSel.id, title)}
                      onUpdate={(taskId, patch) => ttUpdate(ttSel.id, taskId, patch)}
                      onComplete={(taskId) => ttComplete(ttSel.id, taskId)}
                      onDelete={(taskId) => ttDelete(ttSel.id, taskId)}
                      onDeleteProject={() => ttDeleteProject(ttSel.id)}
                    />
                  ) : (
                    <div className="notes-empty-state">
                      <ListChecks size={32} strokeWidth={1.2} />
                      <div>Pick a list or smart view on the left.</div>
                    </div>
                  )}
                </>
              )
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
