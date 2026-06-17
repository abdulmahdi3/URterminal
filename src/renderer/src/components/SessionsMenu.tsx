import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  History,
  Save,
  RotateCcw,
  Trash2,
  MessageSquare,
  Layers,
  Star,
  Search,
  ArrowUpDown
} from 'lucide-react'
import clsx from 'clsx'
import type { ChatSession, Pane } from '@shared/types'
import { useSessions } from '@renderer/store/sessions'
import { useWorkspace } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toasts'

type SortMode = 'pinned' | 'recent' | 'name'
const SORT_LABEL: Record<SortMode, string> = { pinned: 'Pinned', recent: 'Recent', name: 'Name' }
const NEXT_SORT: Record<SortMode, SortMode> = { pinned: 'recent', recent: 'name', name: 'pinned' }

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Last path segment of a folder, for the chat row's secondary line. */
function folderName(cwd?: string): string {
  if (!cwd) return ''
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

/** Short type tag shown next to a pane in the save picker. */
function paneTag(p: Pane): string {
  if (p.type === 'ai') return p.agent?.command ?? 'agent'
  if (p.type === 'shell') return 'shell'
  return p.type
}

/**
 * Sidebar entry: save/restore whole workspaces and reopen individual chats. The
 * trigger is a rail row; the menu is portalled to <body> and positioned beside
 * the rail so the rail's `overflow:hidden` can't clip it.
 *
 * The list is searchable + sortable (pinned/recent/name) and shows live counts so
 * every saved session/chat is reachable. Saving always shows a per-pane picker so
 * you keep just the chats that matter; pinned items float to the top and survive
 * the auto-prune. Chats whose Claude transcript was cleared show dimmed (not gone).
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
  const panes = useWorkspace((s) => s.panes)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('pinned')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Panes worth saving (an empty/chooser pane has nothing to capture).
  const pickable = Object.values(panes).filter((p) => p.type !== 'empty')

  const place = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // Open to the right of the rail, vertically anchored near the row (clamped so
    // the now-taller menu stays on screen).
    const top = Math.min(r.top, window.innerHeight - 600)
    setPos({ top: Math.max(8, top), left: r.right + 8 })
  }

  const toggle = (): void => {
    if (!open) place()
    setOpen((v) => !v)
  }

  // On open, default the save picker to "all panes checked" and reset search.
  useEffect(() => {
    if (!open) return
    setSelected(new Set(Object.values(panes).filter((p) => p.type !== 'empty').map((p) => p.id)))
    setQuery('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // While open, drop any selected ids whose pane has since closed so the picker
  // count + whole-vs-selective decision stay honest.
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

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const togglePane = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const doSave = (): void => {
    // Reconcile against live panes: a pane may have closed while the menu stayed
    // open, leaving stale ids in `selected`. Decide whole-vs-selective on the
    // live-valid selection so we never silently save an unchecked pane.
    const pickableIds = new Set(pickable.map((p) => p.id))
    const liveSelected = [...selected].filter((id) => pickableIds.has(id))
    if (pickable.length && liveSelected.length === 0) {
      toast('Pick at least one pane to save', 'info')
      return
    }
    const name = draft.trim() || `Session ${new Date().toLocaleString()}`
    // All panes chosen → save the whole workspace; a subset → selective save.
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

  // ---- search + sort over the loaded lists (so every entry stays reachable) ----
  const q = query.trim().toLowerCase()
  const byPinThen = (aPin?: boolean, bPin?: boolean): number =>
    !!aPin === !!bPin ? 0 : aPin ? -1 : 1
  const shownSessions = sessions
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name)
      if (sortMode === 'recent') return b.savedAt - a.savedAt
      return byPinThen(a.pinned, b.pinned) || b.savedAt - a.savedAt
    })
  // Chats the user dismissed ("Remove") stay on disk but never show in the menu.
  const visibleChats = chats.filter((c) => !c.hidden)
  const shownChats = visibleChats
    .filter((c) => !q || c.title.toLowerCase().includes(q) || (c.cwd ?? '').toLowerCase().includes(q))
    .sort((a, b) => {
      if (sortMode === 'name') return a.title.localeCompare(b.title)
      if (sortMode === 'recent') return b.updatedAt - a.updatedAt
      return byPinThen(a.pinned, b.pinned) || b.updatedAt - a.updatedAt
    })
  const count = (shown: number, total: number): string => (q ? `${shown}/${total}` : `${total}`)

  return (
    <>
      <button
        ref={btnRef}
        className={clsx('sb-row', open && 'active')}
        title="Saved sessions & chats"
        onClick={toggle}
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
          <div
            ref={menuRef}
            className="sessions-menu sessions-menu-float"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="sessions-save">
              <input
                className="sessions-input"
                placeholder="Name this session…"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doSave()
                  if (e.key === 'Escape') setOpen(false)
                }}
              />
              <button
                className="btn sm primary"
                onClick={doSave}
                disabled={!!pickable.length && selected.size === 0}
                title="Save the selected panes"
              >
                <Save size={12} /> Save
              </button>
            </div>

            {/* per-pane picker: choose exactly which chats/panes to keep */}
            {pickable.length > 0 && (
              <div className="sessions-picker">
                <div className="sessions-picker-head">
                  <span>
                    Include panes <b>{selected.size}</b>/{pickable.length}
                  </span>
                  <span className="sessions-picker-acts">
                    <button onClick={() => setSelected(new Set(pickable.map((p) => p.id)))}>All</button>
                    <button onClick={() => setSelected(new Set())}>None</button>
                  </span>
                </div>
                <div className="sessions-picker-list">
                  {pickable.map((p) => (
                    <label key={p.id} className="sessions-pick">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => togglePane(p.id)}
                      />
                      <span className="sessions-pick-name">{p.title}</span>
                      <span className="sessions-pick-tag">{paneTag(p)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* search + sort over saved sessions/chats */}
            <div className="sessions-tools">
              <div className="sessions-search">
                <Search size={12} />
                <input
                  placeholder="Search sessions & chats…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button
                className="sessions-sort"
                title="Change sort order"
                onClick={() => setSortMode((m) => NEXT_SORT[m])}
              >
                <ArrowUpDown size={12} /> {SORT_LABEL[sortMode]}
              </button>
            </div>

            <div className="sessions-list">
              <div className="sessions-section">
                <Layers size={11} /> Workspaces
                <span className="sessions-section-count">{count(shownSessions.length, sessions.length)}</span>
              </div>
              {shownSessions.length === 0 ? (
                <p className="sessions-empty">{q ? 'No matches.' : 'No saved workspaces yet.'}</p>
              ) : (
                shownSessions.map((s) => (
                  <div key={s.id} className={clsx('session-row', s.auto && 'auto')}>
                    <button
                      className={clsx('icon-btn', 'session-pin', s.pinned && 'on')}
                      title={s.pinned ? 'Unpin' : 'Pin to top (never auto-deleted)'}
                      onClick={() => togglePin(s.id)}
                    >
                      <Star size={12} />
                    </button>
                    <div className="session-info" onClick={() => doRestore(s.id)} title="Restore">
                      <span className="session-name">{s.name}</span>
                      <span className="session-meta">
                        {s.paneCount} pane{s.paneCount !== 1 ? 's' : ''} · {relativeTime(s.savedAt)}
                      </span>
                    </div>
                    <button
                      className="icon-btn"
                      title="Restore this workspace"
                      onClick={() => doRestore(s.id)}
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Delete saved workspace"
                      onClick={() => remove(s.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}

              <div className="sessions-section">
                <MessageSquare size={11} /> Chats
                <span className="sessions-section-count">{count(shownChats.length, visibleChats.length)}</span>
              </div>
              {shownChats.length === 0 ? (
                <p className="sessions-empty">
                  {q ? 'No matches.' : 'No chats yet — start one in a Claude pane.'}
                </p>
              ) : (
                shownChats.map((c) => (
                  <div key={c.sessionId} className={clsx('session-row', c.missing && 'missing')}>
                    <button
                      className={clsx('icon-btn', 'session-pin', c.pinned && 'on')}
                      title={c.pinned ? 'Unpin' : 'Pin to top'}
                      onClick={() => togglePinChat(c.sessionId)}
                    >
                      <Star size={12} />
                    </button>
                    <div
                      className="session-info"
                      onClick={() => doResumeChat(c)}
                      title={c.missing ? 'History cleared — reopens as a new conversation' : 'Reopen this chat in a new pane'}
                    >
                      <span className="session-name">{c.title}</span>
                      <span className="session-meta">
                        {c.missing
                          ? 'history cleared'
                          : `${folderName(c.cwd) ? `${folderName(c.cwd)} · ` : ''}${relativeTime(c.updatedAt)}`}
                      </span>
                    </div>
                    <button
                      className="icon-btn"
                      title="Reopen this chat in a new pane"
                      onClick={() => doResumeChat(c)}
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Remove from this list (keeps the conversation on disk)"
                      onClick={() => removeChat(c.sessionId)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
