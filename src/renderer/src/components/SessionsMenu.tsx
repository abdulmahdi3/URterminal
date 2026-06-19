import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  History,
  Save,
  Trash2,
  MessageSquare,
  Layers,
  Star,
  Pin,
  Search,
  ArrowUpDown,
  ChevronDown,
  Check,
  X,
  RotateCcw,
  CalendarDays,
  Clock,
  Folder
} from 'lucide-react'
import clsx from 'clsx'
import type { MosaicNode } from 'react-mosaic-component'
import type { ChatSession, Pane } from '@shared/types'
import { useSessions } from '@renderer/store/sessions'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import { toast } from '@renderer/store/toasts'

/** Pane "kind" — the colored category shown in thumbnails, dots and chips. */
type Kind = 'claude' | 'shell' | 'ssh' | 'stream' | 'openrouter' | 'empty'
type SortMode = 'recent' | 'name' | 'size'
type Scope = 'all' | 'pinned' | 'restored' | 'chats'
type When = null | 'today' | 'earlier'

const SORT_LABEL: Record<SortMode, string> = { recent: 'Recent', name: 'Name', size: 'Size' }
const SORT_DESC: Record<SortMode, string> = {
  recent: 'newest first',
  name: 'A–Z',
  size: 'largest first'
}
const SCOPE_LABEL: Record<Scope, string> = {
  all: 'All sessions',
  pinned: 'Pinned',
  restored: 'Recently restored',
  chats: 'Chats'
}

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`
}

/** Wall-clock "HH:MM" (24h) for a saved/updated timestamp — the upper time line. */
function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "1.2 MB" / "240 KB" — captured scrollback size of a session. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Last path segment of a folder, for the row's context chip. */
function folderName(cwd?: string): string {
  if (!cwd) return ''
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Which colored category a pane belongs to (SSH wins over its underlying type). */
function paneKind(p?: Pane): Kind {
  if (!p) return 'empty'
  if (p.type === 'shell') return p.shell?.ssh ? 'ssh' : 'shell'
  if (p.type === 'ai') return p.agent?.sshTarget ? 'ssh' : 'claude'
  if (p.type === 'stream') return 'stream'
  if (p.type === 'openrouter') return 'openrouter'
  return 'empty'
}

/** Short label for a pane's composition dot (e.g. "claude", "shell", "ssh"). */
function paneLabel(p?: Pane): string {
  if (!p) return ''
  switch (paneKind(p)) {
    case 'ssh':
      return 'ssh'
    case 'claude':
      return p.agent?.command || 'claude'
    case 'shell':
      return 'shell'
    case 'stream':
      return p.stream?.command || 'stream'
    case 'openrouter':
      return p.openrouter?.model?.split('/').pop() || 'model'
    default:
      return ''
  }
}

/** Pane-id leaves of a mosaic tree, in visual (left→right, top→bottom) order. */
function orderedLeafIds(node: MosaicNode<string> | null): string[] {
  if (node == null) return []
  if (typeof node === 'string') return [node]
  return [...orderedLeafIds(node.first), ...orderedLeafIds(node.second)]
}

/** Panes in layout order (so the composition reads the way the panes were arranged). */
function orderedPanes(layout: MosaicNode<string> | null, panes: Record<string, Pane>): Pane[] {
  const seen = new Set<string>()
  const out: Pane[] = []
  for (const id of orderedLeafIds(layout)) {
    if (panes[id] && !seen.has(id)) {
      out.push(panes[id])
      seen.add(id)
    }
  }
  for (const [id, p] of Object.entries(panes)) if (!seen.has(id)) out.push(p)
  return out
}

/** First working directory found across a session's panes (for the context chip). */
function sessionCwd(panes: Record<string, Pane>): string | undefined {
  for (const p of Object.values(panes)) {
    const cwd = p.agent?.cwd || p.shell?.cwd || p.stream?.cwd
    if (cwd) return cwd
  }
  return undefined
}

/** Render a mosaic layout as a tiny colored pane-grid thumbnail. */
function thumbNode(node: MosaicNode<string> | null, panes: Record<string, Pane>): JSX.Element {
  if (node == null) {
    const ps = Object.values(panes)
    if (ps.length <= 1) return <div className={clsx('sm-cell', `sm-k-${paneKind(ps[0])}`)} />
    return (
      <div className="sm-split" data-dir="row">
        {ps.slice(0, 4).map((p) => (
          <div key={p.id} className="sm-split-part">
            <div className={clsx('sm-cell', `sm-k-${paneKind(p)}`)} />
          </div>
        ))}
      </div>
    )
  }
  if (typeof node === 'string') return <div className={clsx('sm-cell', `sm-k-${paneKind(panes[node])}`)} />
  const pct = node.splitPercentage ?? 50
  return (
    <div className="sm-split" data-dir={node.direction}>
      <div className="sm-split-part" style={{ flexGrow: pct, flexBasis: 0 }}>
        {thumbNode(node.first, panes)}
      </div>
      <div className="sm-split-part" style={{ flexGrow: 100 - pct, flexBasis: 0 }}>
        {thumbNode(node.second, panes)}
      </div>
    </div>
  )
}

/** One unified row model spanning saved workspaces ("session") and resumable chats. */
interface Entry {
  kind: 'session' | 'chat'
  id: string
  name: string
  time: number
  restoredAt?: number
  pinned: boolean
  paneCount: number
  comps: { kind: Kind; label: string }[]
  layout: MosaicNode<string> | null
  panes: Record<string, Pane> | null
  cwd?: string
  bytes?: number
  missing?: boolean
  auto?: boolean
}

function hasKind(e: Entry, k: Kind): boolean {
  return e.comps.some((c) => c.kind === k)
}

/** A left-rail filter row with a leading icon (or colored dot) and a trailing count. */
function NavItem({
  icon,
  dot,
  label,
  count,
  active,
  onClick
}: {
  icon?: JSX.Element
  dot?: Kind
  label: string
  count: number
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button className={clsx('sm-nav-item', active && 'active')} onClick={onClick}>
      <span className="sm-nav-ico">
        {dot ? <i className={clsx('sm-dot', `sm-k-${dot}`)} /> : icon}
      </span>
      <span className="sm-nav-label">{label}</span>
      <span className="sm-nav-count">{count}</span>
    </button>
  )
}

/** The session thumbnail (mosaic grid for workspaces, single cell for chats). */
function Thumb({ e }: { e: Entry }): JSX.Element {
  let inner: JSX.Element
  if (e.kind === 'chat' || !e.panes) {
    inner = <div className={clsx('sm-cell', e.missing ? 'sm-k-empty' : 'sm-k-claude')} />
  } else {
    inner = thumbNode(e.layout, e.panes)
  }
  return <div className="sm-thumb">{inner}</div>
}

/**
 * Saved-session browser. A rail row opens a full-screen modal that lets you save
 * the current workspace (per-pane picker), and browse / search / restore every
 * saved workspace and resumable chat. The list is faceted down the left side
 * (browse scope, time, pane composition), grouped by Pinned/Today/Earlier, and
 * fully keyboard-drivable (↑↓ navigate, ↵ restore, ⌫ delete, P pin, S save).
 */
export default function SessionsMenu(): JSX.Element {
  const sessions = useSessions((s) => s.sessions)
  const chats = useSessions((s) => s.chats)
  const save = useSessions((s) => s.save)
  const restore = useSessions((s) => s.restore)
  const remove = useSessions((s) => s.remove)
  const togglePin = useSessions((s) => s.togglePin)
  const resumeChat = useSessions((s) => s.resumeChat)
  const removeChat = useSessions((s) => s.removeChat)
  const togglePinChat = useSessions((s) => s.togglePinChat)
  const recordChats = useSessions((s) => s.recordChats)
  const panes = useWorkspace((s) => s.panes)
  const wsList = useWorkspaces((s) => s.list)
  const activeWsId = useWorkspaces((s) => s.activeId)
  const activeWsName = wsList.find((w) => w.id === activeWsId)?.name ?? 'Workspace'

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [sortOpen, setSortOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('all')
  const [when, setWhen] = useState<When>(null)
  const [comp, setComp] = useState<Kind | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  const btnRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)

  const visibleChats = chats.filter((c) => !c.hidden)
  // Panes worth saving (an empty/chooser pane has nothing to capture).
  const pickable = Object.values(panes).filter((p) => p.type !== 'empty')

  // On open: refresh chats, default the save picker to "all panes", reset filters.
  useEffect(() => {
    if (!open) return
    void recordChats()
    setSelected(new Set(Object.values(panes).filter((p) => p.type !== 'empty').map((p) => p.id)))
    setDraft('')
    setQuery('')
    setScope('all')
    setWhen(null)
    setComp(null)
    setSortOpen(false)
    requestAnimationFrame(() => searchRef.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Drop any selected ids whose pane has since closed so the save count stays honest.
  const paneIdKey = pickable.map((p) => p.id).join(',')
  useEffect(() => {
    if (!open) return
    setSelected((prev) => {
      const live = new Set(paneIdKey ? paneIdKey.split(',') : [])
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneIdKey, open])

  // Close the sort menu on an outside click.
  useEffect(() => {
    if (!sortOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!sortRef.current?.contains(e.target as Node)) setSortOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sortOpen])

  const togglePane = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const doSave = (): void => {
    const pickableIds = new Set(pickable.map((p) => p.id))
    const liveSelected = [...selected].filter((id) => pickableIds.has(id))
    if (pickable.length && liveSelected.length === 0) {
      toast('Pick at least one pane to save', 'info')
      return
    }
    const name = draft.trim() || `Session ${new Date().toLocaleString()}`
    const ids = pickable.length && liveSelected.length < pickable.length ? liveSelected : undefined
    save(name, ids)
    setDraft('')
    const n = ids ? ids.length : pickable.length
    toast(`Saved: ${name}${ids ? ` (${n} of ${pickable.length} panes)` : ''}`, 'ok')
  }

  const doRestore = (id: string): void => {
    void restore(id).then((s) => {
      if (s) {
        toast(`Restored session: ${s.name}`, 'ok')
        setOpen(false)
      }
    })
  }

  const doResumeChat = (chat: ChatSession): void => {
    void resumeChat(chat)
    toast(chat.missing ? `Re-creating: ${chat.title}` : `Resuming: ${chat.title}`, 'ok')
    setOpen(false)
  }

  // The display time depends on scope: "Recently restored" sorts/labels by restore time.
  const dispTime = (e: Entry): number =>
    scope === 'restored' && e.restoredAt ? e.restoredAt : e.time

  // ---- build the faceted, grouped view from the saved sessions + chats ----
  const { groups, flat, allCount, pinnedCount, restoredCount, chatsCount, facet } = useMemo(() => {
    const sessionEntries: Entry[] = sessions.map((s) => {
      const ps = orderedPanes(s.layout ?? null, s.panes)
      const comps = ps
        .map((p) => ({ kind: paneKind(p), label: paneLabel(p) }))
        .filter((c) => c.kind !== 'empty')
      return {
        kind: 'session',
        id: s.id,
        name: s.name,
        time: s.savedAt,
        restoredAt: s.restoredAt,
        pinned: !!s.pinned,
        paneCount: s.paneCount,
        comps,
        layout: s.layout ?? null,
        panes: s.panes,
        cwd: sessionCwd(s.panes),
        bytes: s.bytes,
        auto: s.auto
      }
    })
    const chatEntries: Entry[] = visibleChats.map((c) => ({
      kind: 'chat',
      id: c.sessionId,
      name: c.title,
      time: c.updatedAt,
      pinned: !!c.pinned,
      paneCount: 1,
      comps: [{ kind: 'claude' as Kind, label: c.agent || 'claude' }],
      layout: null,
      panes: null,
      cwd: c.cwd,
      missing: c.missing
    }))

    const today0 = startOfToday()
    const kt = (e: Entry): number => (scope === 'restored' && e.restoredAt ? e.restoredAt : e.time)

    let scoped: Entry[]
    if (scope === 'chats') scoped = chatEntries
    else if (scope === 'pinned') scoped = [...sessionEntries, ...chatEntries].filter((e) => e.pinned)
    else if (scope === 'restored') scoped = sessionEntries.filter((e) => e.restoredAt)
    else scoped = sessionEntries

    // Facet counts reflect the active scope (before when/composition refine it).
    const facetCounts = {
      today: scoped.filter((e) => kt(e) >= today0).length,
      earlier: scoped.filter((e) => kt(e) < today0).length,
      claude: scoped.filter((e) => hasKind(e, 'claude')).length,
      shell: scoped.filter((e) => hasKind(e, 'shell')).length,
      ssh: scoped.filter((e) => hasKind(e, 'ssh')).length
    }

    let list = scoped
    if (when === 'today') list = list.filter((e) => kt(e) >= today0)
    else if (when === 'earlier') list = list.filter((e) => kt(e) < today0)
    if (comp) list = list.filter((e) => hasKind(e, comp))
    const q = query.trim().toLowerCase()
    if (q)
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.cwd ?? '').toLowerCase().includes(q) ||
          e.comps.some((c) => c.label.toLowerCase().includes(q))
      )

    const sorted = [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'size') return (b.bytes ?? -1) - (a.bytes ?? -1)
      return kt(b) - kt(a)
    })

    type Group = { label: string; items: Entry[] }
    let gs: Group[]
    if (q || sort !== 'recent') {
      gs = [{ label: '', items: sorted }]
    } else if (scope === 'all') {
      const pinned = sorted.filter((e) => e.pinned)
      const rest = sorted.filter((e) => !e.pinned)
      gs = [
        { label: 'Pinned', items: pinned },
        { label: 'Today', items: rest.filter((e) => kt(e) >= today0) },
        { label: 'Earlier', items: rest.filter((e) => kt(e) < today0) }
      ].filter((g) => g.items.length)
    } else {
      gs = [
        { label: 'Today', items: sorted.filter((e) => kt(e) >= today0) },
        { label: 'Earlier', items: sorted.filter((e) => kt(e) < today0) }
      ].filter((g) => g.items.length)
    }

    return {
      groups: gs,
      flat: gs.flatMap((g) => g.items),
      allCount: sessionEntries.length,
      pinnedCount:
        sessionEntries.filter((e) => e.pinned).length + chatEntries.filter((e) => e.pinned).length,
      restoredCount: sessionEntries.filter((e) => e.restoredAt).length,
      chatsCount: chatEntries.length,
      facet: facetCounts
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, chats, scope, when, comp, query, sort])

  const indexOf = useMemo(() => new Map(flat.map((e, i) => [e, i])), [flat])

  // Reset / clamp the keyboard cursor when the result set changes.
  useEffect(() => {
    setActiveIdx((i) => (i >= flat.length ? Math.max(0, flat.length - 1) : i))
  }, [flat.length])
  useEffect(() => {
    setActiveIdx(0)
  }, [scope, when, comp, query, sort, open])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const act = (e: Entry): void => {
    if (e.kind === 'session') doRestore(e.id)
    else {
      const c = visibleChats.find((x) => x.sessionId === e.id)
      if (c) doResumeChat(c)
    }
  }
  const del = (e: Entry): void => {
    if (e.kind === 'session') remove(e.id)
    else removeChat(e.id)
  }
  const pin = (e: Entry): void => {
    if (e.kind === 'session') togglePin(e.id)
    else togglePinChat(e.id)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    const tag = (e.target as HTMLElement).tagName
    const typing = tag === 'INPUT' || tag === 'TEXTAREA'
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = flat[activeIdx]
      if (it) act(it)
    } else if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      const it = flat[activeIdx]
      if (it) del(it)
    } else if (!typing && e.key.toLowerCase() === 'p') {
      const it = flat[activeIdx]
      if (it) pin(it)
    } else if (!typing && e.key.toLowerCase() === 's') {
      e.preventDefault()
      nameRef.current?.focus()
    }
  }

  const pinnedShown = flat.filter((e) => e.pinned).length
  const noun = scope === 'chats' ? 'chat' : 'session'

  return (
    <>
      <button
        ref={btnRef}
        className={clsx('sb-row', open && 'active')}
        title="Saved sessions & chats"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sb-ico">
          <History size={18} />
        </span>
        <span className="sb-label">Sessions</span>
        {sessions.length + visibleChats.length > 0 && (
          <span className="sb-meta">
            <span className="sb-count">{sessions.length + visibleChats.length}</span>
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="sm-overlay" onMouseDown={() => setOpen(false)}>
            <div className="sm-modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
              {/* ---- header ---- */}
              <div className="sm-head">
                <div className="sm-head-left">
                  <span className="sm-head-icon">
                    <History size={20} />
                  </span>
                  <div className="sm-head-titles">
                    <span className="sm-title">Sessions</span>
                    <span className="sm-sub">
                      {sessions.length} saved · {activeWsName}
                    </span>
                  </div>
                </div>
                <div className="sm-search">
                  <Search size={15} />
                  <input
                    ref={searchRef}
                    placeholder="Search sessions & chats…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="sm-sort-wrap" ref={sortRef}>
                  <button className="sm-sort" onClick={() => setSortOpen((o) => !o)} title="Sort order">
                    <ArrowUpDown size={13} />
                    {SORT_LABEL[sort]}
                    <ChevronDown size={13} className="sm-sort-caret" />
                  </button>
                  {sortOpen && (
                    <div className="sm-sort-menu">
                      {(['recent', 'name', 'size'] as SortMode[]).map((m) => (
                        <button
                          key={m}
                          className={clsx('sm-sort-opt', sort === m && 'on')}
                          onClick={() => {
                            setSort(m)
                            setSortOpen(false)
                          }}
                        >
                          {SORT_LABEL[m]}
                          {sort === m && <Check size={13} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button className="sm-close" onClick={() => setOpen(false)} title="Close (Esc)">
                  <X size={18} />
                </button>
              </div>

              {/* ---- body: facets | list ---- */}
              <div className="sm-body">
                <div className="sm-side">
                  {/* save current */}
                  <div className="sm-save">
                    <div className="sm-save-head">
                      <span className="sm-save-title">Save current</span>
                      <span className="sm-save-count">
                        {pickable.length} pane{pickable.length !== 1 ? 's' : ''} open
                      </span>
                    </div>
                    <input
                      ref={nameRef}
                      className="sm-save-input"
                      placeholder="Name this session…"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') doSave()
                      }}
                    />
                    {pickable.length > 0 ? (
                      <div className="sm-chips">
                        {pickable.map((p) => {
                          const on = selected.has(p.id)
                          return (
                            <button
                              key={p.id}
                              className={clsx('sm-chip', `sm-k-${paneKind(p)}`, on && 'on')}
                              onClick={() => togglePane(p.id)}
                              title={p.title}
                            >
                              {on ? <Check size={11} /> : <i className="sm-dot" />}
                              <span className="sm-chip-label">{paneLabel(p) || p.title}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="sm-save-empty">No open panes to save.</p>
                    )}
                    <button
                      className="sm-save-btn"
                      onClick={doSave}
                      disabled={pickable.length === 0 || selected.size === 0}
                    >
                      <Save size={13} /> Save session
                    </button>
                  </div>

                  {/* facets */}
                  <nav className="sm-nav">
                    <div className="sm-nav-group">
                      <div className="sm-nav-title">Browse</div>
                      <NavItem
                        icon={<Layers size={15} />}
                        label="All sessions"
                        count={allCount}
                        active={scope === 'all'}
                        onClick={() => setScope('all')}
                      />
                      <NavItem
                        icon={<Pin size={15} />}
                        label="Pinned"
                        count={pinnedCount}
                        active={scope === 'pinned'}
                        onClick={() => setScope('pinned')}
                      />
                      <NavItem
                        icon={<RotateCcw size={15} />}
                        label="Recently restored"
                        count={restoredCount}
                        active={scope === 'restored'}
                        onClick={() => setScope('restored')}
                      />
                      <NavItem
                        icon={<MessageSquare size={15} />}
                        label="Chats"
                        count={chatsCount}
                        active={scope === 'chats'}
                        onClick={() => setScope('chats')}
                      />
                    </div>
                    <div className="sm-nav-group">
                      <div className="sm-nav-title">When</div>
                      <NavItem
                        icon={<CalendarDays size={15} />}
                        label="Today"
                        count={facet.today}
                        active={when === 'today'}
                        onClick={() => setWhen((w) => (w === 'today' ? null : 'today'))}
                      />
                      <NavItem
                        icon={<CalendarDays size={15} />}
                        label="Earlier"
                        count={facet.earlier}
                        active={when === 'earlier'}
                        onClick={() => setWhen((w) => (w === 'earlier' ? null : 'earlier'))}
                      />
                    </div>
                    <div className="sm-nav-group">
                      <div className="sm-nav-title">Composition</div>
                      <NavItem
                        dot="claude"
                        label="With Claude"
                        count={facet.claude}
                        active={comp === 'claude'}
                        onClick={() => setComp((c) => (c === 'claude' ? null : 'claude'))}
                      />
                      <NavItem
                        dot="shell"
                        label="With shell"
                        count={facet.shell}
                        active={comp === 'shell'}
                        onClick={() => setComp((c) => (c === 'shell' ? null : 'shell'))}
                      />
                      <NavItem
                        dot="ssh"
                        label="With SSH"
                        count={facet.ssh}
                        active={comp === 'ssh'}
                        onClick={() => setComp((c) => (c === 'ssh' ? null : 'ssh'))}
                      />
                    </div>
                  </nav>
                </div>

                <div className="sm-main">
                  <div className="sm-main-head">
                    <span className="sm-main-title">{SCOPE_LABEL[scope]}</span>
                    <span className="sm-main-sub">
                      {flat.length} {noun}
                      {flat.length !== 1 ? 's' : ''} · {pinnedShown} pinned · {SORT_DESC[sort]}
                    </span>
                  </div>

                  <div className="sm-list" ref={listRef}>
                    {flat.length === 0 ? (
                      <div className="sm-empty">
                        <History size={26} />
                        <p>
                          {query
                            ? `No ${noun}s match “${query.trim()}”.`
                            : scope === 'chats'
                              ? 'No chats yet — start one in a Claude pane.'
                              : scope === 'restored'
                                ? 'Nothing restored yet.'
                                : scope === 'pinned'
                                  ? 'No pinned items yet.'
                                  : 'No saved sessions yet — name the current one and save it.'}
                        </p>
                      </div>
                    ) : (
                      groups.map((g) => (
                        <Fragment key={g.label || 'all'}>
                          {g.label && (
                            <div className="sm-sec">
                              {g.label === 'Pinned' && <Pin size={11} />}
                              <span className="sm-sec-label">{g.label}</span>
                              <span className="sm-sec-count">{g.items.length}</span>
                            </div>
                          )}
                          {g.items.map((e) => {
                            const idx = indexOf.get(e) ?? 0
                            return (
                              <div
                                key={e.kind + e.id}
                                data-idx={idx}
                                className={clsx(
                                  'sm-row',
                                  idx === activeIdx && 'active',
                                  e.missing && 'missing'
                                )}
                                onMouseEnter={() => setActiveIdx(idx)}
                                onClick={() => act(e)}
                                title={
                                  e.kind === 'session'
                                    ? 'Restore session'
                                    : e.missing
                                      ? 'History cleared — reopens as a new conversation'
                                      : 'Resume chat'
                                }
                              >
                                <Thumb e={e} />
                                <div className="sm-row-main">
                                  <div className="sm-row-title">
                                    {e.pinned && <Star size={12} className="sm-row-star" />}
                                    <span className="sm-row-name">{e.name}</span>
                                    {e.auto && <span className="sm-row-tag">auto</span>}
                                  </div>
                                  <div className="sm-row-meta">
                                    <span className="sm-comps">
                                      {e.comps.slice(0, 5).map((c, i) => (
                                        <span className="sm-comp" key={i}>
                                          <i className={clsx('sm-dot', `sm-k-${c.kind}`)} />
                                          {c.label}
                                        </span>
                                      ))}
                                      {e.comps.length > 5 && (
                                        <span className="sm-comp-more">+{e.comps.length - 5}</span>
                                      )}
                                    </span>
                                    <span className="sm-sep">·</span>
                                    <span className="sm-panes">
                                      {e.paneCount} pane{e.paneCount !== 1 ? 's' : ''}
                                    </span>
                                    {e.cwd && (
                                      <>
                                        <span className="sm-sep">·</span>
                                        <span className="sm-folder">
                                          <Folder size={11} />
                                          {folderName(e.cwd)}
                                        </span>
                                      </>
                                    )}
                                    {e.missing && (
                                      <>
                                        <span className="sm-sep">·</span>
                                        <span className="sm-missing-note">history cleared</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="sm-row-right">
                                  {e.bytes != null && (
                                    <div className="sm-meta-col">
                                      <span className="sm-size">{formatBytes(e.bytes)}</span>
                                      <span className="sm-size-label">scrollback</span>
                                    </div>
                                  )}
                                  <div className="sm-meta-col sm-meta-time">
                                    <span className="sm-time">{clockTime(dispTime(e))}</span>
                                    <span className="sm-ago">
                                      <Clock size={10} />
                                      {relativeTime(dispTime(e))}
                                    </span>
                                  </div>
                                </div>
                                <div className="sm-row-acts">
                                  <button
                                    className={clsx('sm-act', e.pinned && 'on')}
                                    title={e.pinned ? 'Unpin' : 'Pin to top'}
                                    onClick={(ev) => {
                                      ev.stopPropagation()
                                      pin(e)
                                    }}
                                  >
                                    <Star size={13} />
                                  </button>
                                  <button
                                    className="sm-act danger"
                                    title={e.kind === 'session' ? 'Delete session' : 'Remove from list'}
                                    onClick={(ev) => {
                                      ev.stopPropagation()
                                      del(e)
                                    }}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </Fragment>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* ---- footer: key hints ---- */}
              <div className="sm-foot">
                <div className="sm-foot-hints">
                  <span className="sm-hint">
                    <kbd>↑</kbd>
                    <kbd>↓</kbd> navigate
                  </span>
                  <span className="sm-hint">
                    <kbd>↵</kbd> {scope === 'chats' ? 'resume' : 'restore'}
                  </span>
                  <span className="sm-hint">
                    <kbd>⌫</kbd> delete
                  </span>
                  <span className="sm-hint">
                    <kbd>P</kbd> pin
                  </span>
                </div>
                <div className="sm-foot-hints">
                  <span className="sm-hint">
                    <kbd>S</kbd> save
                  </span>
                  <span className="sm-hint">
                    <kbd>Esc</kbd> close
                  </span>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
