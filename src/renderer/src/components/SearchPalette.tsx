import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  ChevronUp,
  ChevronDown,
  SquareTerminal,
  LayoutGrid,
  History,
  CornerDownLeft,
  FolderOpen,
  Loader2,
  ArrowRight
} from 'lucide-react'
import clsx from 'clsx'
import { useUi, type SearchScope } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { useSessions } from '@renderer/store/sessions'
import { getLeaves } from '@renderer/lib/mosaicTree'
import {
  findMatchesInPane,
  searchInPane,
  clearSearch,
  scrollPaneToLine,
  focusTerminal,
  type PaneMatch
} from '@renderer/lib/terminalPool'
import type { SessionHit } from '@shared/types'

const SCOPES: SearchScope[] = ['pane', 'all', 'history']

/** One scrollback hit, carrying its pane + (for all-panes) its group label. */
interface LineRow {
  paneId: string
  line: number
  text: string
  groupNum?: number
  groupTitle?: string
  firstOfGroup?: boolean
}

/** "x minutes/hours/days ago" for a history result timestamp. */
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d < 30 ? `${d}d ago` : `${Math.round(d / 30)}mo ago`
}

/** Wrap every case-insensitive occurrence of `q` in `text` with a highlight mark. */
function highlight(text: string, q: string): JSX.Element {
  if (!q) return <>{text}</>
  const out: (string | JSX.Element)[] = []
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  let i = 0
  let k = 0
  while (i < text.length) {
    const at = lower.indexOf(needle, i)
    if (at < 0) {
      out.push(text.slice(i))
      break
    }
    if (at > i) out.push(text.slice(i, at))
    out.push(
      <mark className="usp-hl" key={k++}>
        {text.slice(at, at + q.length)}
      </mark>
    )
    i = at + q.length
  }
  return <>{out}</>
}

/**
 * Unified search palette. One panel, three scopes:
 *   • This pane — the active pane's scrollback (live xterm highlight + jump)
 *   • All panes — every pane's buffer, grouped by pane
 *   • History  — full-text search over past Claude conversations (resume one)
 * ↑/↓ navigate, Enter jumps/resumes, → (or Tab) switches scope, Esc closes.
 */
export default function SearchPalette(): JSX.Element | null {
  const open = useUi((s) => s.searchOpen)
  const scope = useUi((s) => s.searchScope)
  const setScope = useUi((s) => s.setSearchScope)
  const setOpen = useUi((s) => s.setSearchOpen)

  const activePaneId = useWorkspace((s) => s.activePaneId)
  const panes = useWorkspace((s) => s.panes)
  const layout = useWorkspace((s) => s.layout)
  const setActive = useWorkspace((s) => s.setActive)
  const resumeChat = useSessions((s) => s.resumeChat)

  const [query, setQuery] = useState('')
  const [active, setActiveIdx] = useState(0)
  const [liveFind, setLiveFind] = useState(true)
  const [hits, setHits] = useState<SessionHit[]>([])
  const [busy, setBusy] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const reqRef = useRef(0)

  const leaves = useMemo(() => getLeaves(layout), [layout])
  const q = query.trim()

  // Reset state each time the palette opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIdx(0)
    setHits([])
    setBusy(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  // Clear any lingering xterm decorations when the palette closes (however it does).
  useEffect(() => {
    if (!open) return
    return () => leaves.forEach((id) => clearSearch(id))
  }, [open, leaves])

  // Active-pane scrollback matches (cheap buffer scan).
  const paneMatches = useMemo<LineRow[]>(() => {
    if (!open || !q || !activePaneId) return []
    return findMatchesInPane(activePaneId, q, 200).map((m) => ({
      paneId: activePaneId,
      line: m.line,
      text: m.text
    }))
  }, [open, q, activePaneId])

  // Every pane's matches, grouped, then flattened for navigation.
  const allRows = useMemo<LineRow[]>(() => {
    if (!open || !q) return []
    const rows: LineRow[] = []
    for (const id of leaves) {
      const matches: PaneMatch[] = findMatchesInPane(id, q, 200)
      const num = leaves.indexOf(id) + 1
      const title = panes[id]?.title ?? id
      matches.forEach((m, i) =>
        rows.push({
          paneId: id,
          line: m.line,
          text: m.text,
          groupNum: num,
          groupTitle: title,
          firstOfGroup: i === 0
        })
      )
    }
    return rows
  }, [open, q, leaves, panes])

  // History search — runs for any scope so the History tab badge stays live.
  // Debounced; the latest request wins (reqRef guards out-of-order results).
  useEffect(() => {
    if (!open) return
    if (!q) {
      setHits([])
      setBusy(false)
      return
    }
    setBusy(true)
    const id = ++reqRef.current
    const t = window.setTimeout(() => {
      void window.api
        .searchSessions(q)
        .then((r) => {
          if (id !== reqRef.current) return
          setHits(r)
          setBusy(false)
        })
        .catch(() => {
          if (id === reqRef.current) setBusy(false)
        })
    }, 220)
    return () => window.clearTimeout(t)
  }, [open, q])

  const lineRows = scope === 'pane' ? paneMatches : scope === 'all' ? allRows : []
  const total = scope === 'history' ? hits.length : lineRows.length

  // Snap selection back to the top whenever the query or scope changes, and keep
  // it in range as results shrink.
  useEffect(() => setActiveIdx(0), [q, scope])
  useEffect(() => {
    setActiveIdx((a) => Math.min(Math.max(0, a), Math.max(0, total - 1)))
  }, [total])

  // Live find: paint the active pane's matches in the real terminal as you type.
  useEffect(() => {
    if (!open || !liveFind || scope === 'history') return
    if (activePaneId && q) searchInPane(activePaneId, q, 'next')
  }, [open, liveFind, scope, activePaneId, q])

  // Live preview: scroll the underlying pane to the highlighted result as you move.
  useEffect(() => {
    if (!open || !liveFind || scope === 'history') return
    const row = lineRows[active]
    if (row) scrollPaneToLine(row.paneId, row.line)
  }, [active, open, liveFind, scope, lineRows])

  // Keep the active row scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const close = (): void => {
    leaves.forEach((id) => clearSearch(id))
    setOpen(false)
  }

  const cycleScope = (dir: 1 | -1): void => {
    const i = SCOPES.indexOf(scope)
    setScope(SCOPES[(i + dir + SCOPES.length) % SCOPES.length])
  }

  const activateLine = (row: LineRow | undefined): void => {
    if (!row) return
    setActive(row.paneId)
    scrollPaneToLine(row.paneId, row.line)
    setOpen(false)
    focusTerminal(row.paneId)
  }
  const activateHistory = (hit: SessionHit | undefined): void => {
    if (!hit) return
    setOpen(false)
    resumeChat({
      sessionId: hit.sessionId,
      agent: 'claude',
      cwd: hit.cwd ?? '',
      title: hit.title ?? 'chat',
      updatedAt: hit.when
    })
  }
  const activate = (): void => {
    if (scope === 'history') activateHistory(hits[active])
    else activateLine(lineRows[active])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((a) => Math.min(total - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      cycleScope(e.shiftKey ? -1 : 1)
    } else if (e.key === 'ArrowRight' && e.currentTarget.selectionStart === query.length) {
      // caret at the end → advance the scope (matches the "→ switch scope" hint)
      e.preventDefault()
      cycleScope(1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const counts: Record<SearchScope, number> = {
    pane: paneMatches.length,
    all: allRows.length,
    history: hits.length
  }
  const tabs: { id: SearchScope; label: string; icon: JSX.Element }[] = [
    { id: 'pane', label: 'This pane', icon: <SquareTerminal size={15} /> },
    { id: 'all', label: 'All panes', icon: <LayoutGrid size={15} /> },
    { id: 'history', label: 'History', icon: <History size={15} /> }
  ]

  const placeholder =
    scope === 'history'
      ? 'Search your past conversations…'
      : scope === 'all'
        ? 'Search every pane…'
        : 'Search this pane…'

  return (
    <div className="usp-overlay" onMouseDown={close}>
      <div className="usp-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="usp-head">
          <Search size={16} className="usp-search-icon" />
          <input
            ref={inputRef}
            className="usp-input"
            dir="ltr"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="usp-actions">
            {total > 0 && (
              <span className="usp-counter">
                {active + 1} / {total}
              </span>
            )}
            {scope !== 'history' && (
              <>
                <button
                  className="icon-btn"
                  title="Previous (↑)"
                  onClick={() => setActiveIdx((a) => Math.max(0, a - 1))}
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  className="icon-btn"
                  title="Next (↓)"
                  onClick={() => setActiveIdx((a) => Math.min(total - 1, a + 1))}
                >
                  <ChevronDown size={15} />
                </button>
              </>
            )}
            <span className="usp-divider" />
            <button className="usp-esc" onClick={close} title="Close">
              esc
            </button>
          </div>
        </div>

        <div className="usp-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={clsx('usp-tab', scope === t.id && 'active')}
              onClick={() => setScope(t.id)}
            >
              {t.icon}
              {t.label}
              {(counts[t.id] > 0 || (t.id === 'history' && busy)) && (
                <span className="usp-tab-count">{counts[t.id]}</span>
              )}
            </button>
          ))}
          <button
            className={clsx('usp-livefind', liveFind && 'on')}
            onClick={() => setLiveFind((v) => !v)}
            title="Highlight & follow matches in the live terminal"
          >
            <span className="usp-livefind-dot" />
            live find
          </button>
        </div>

        <div className="usp-list" ref={listRef}>
          {/* History results */}
          {scope === 'history' && (
            <>
              {!q && (
                <div className="usp-empty">
                  <History size={20} />
                  <div>Search everything you&apos;ve discussed — then jump back in.</div>
                </div>
              )}
              {q && !busy && hits.length === 0 && (
                <div className="usp-empty">No past conversations matched “{q}”.</div>
              )}
              {hits.map((h, i) => (
                <div
                  key={h.sessionId}
                  data-idx={i}
                  role="button"
                  className={clsx('usp-srow', i === active && 'active')}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => activateHistory(h)}
                >
                  <div className="ss-row">
                    <span className="ss-title">{h.title || 'Untitled conversation'}</span>
                    <span className="ss-when">{ago(h.when)}</span>
                  </div>
                  {h.snippet && <div className="ss-snippet">{highlight(h.snippet, q)}</div>}
                  {h.cwd && (
                    <div className="ss-cwd">
                      <FolderOpen size={11} /> {h.cwd}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Scrollback results (this pane / all panes) */}
          {scope !== 'history' && (
            <>
              {!q && (
                <div className="usp-empty">
                  <Search size={20} />
                  <div>
                    {scope === 'all'
                      ? 'Search the scrollback of every open pane.'
                      : 'Search this pane’s scrollback.'}
                  </div>
                </div>
              )}
              {q && lineRows.length === 0 && (
                <div className="usp-empty">
                  No matches {scope === 'all' ? 'in any pane' : 'in this pane'}.
                </div>
              )}
              {lineRows.map((row, i) => (
                <div key={`${row.paneId}:${row.line}:${i}`}>
                  {scope === 'all' && row.firstOfGroup && (
                    <div className="usp-group">
                      <span className="usp-group-num">{row.groupNum}</span>
                      <span className="usp-group-title">{row.groupTitle}</span>
                    </div>
                  )}
                  <div
                    data-idx={i}
                    role="button"
                    tabIndex={-1}
                    className={clsx('usp-row', i === active && 'active')}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => activateLine(row)}
                    title={row.text}
                  >
                    <span className="usp-gutter">{row.line}</span>
                    <span className="usp-text">{highlight(row.text || ' ', q)}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="usp-foot">
          <span className="usp-foot-hint">
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate ·{' '}
            <CornerDownLeft size={11} /> {scope === 'history' ? 'resume conversation' : 'jump to match'}{' '}
            · <ArrowRight size={11} /> switch scope
          </span>
          <span className="usp-foot-count">
            {busy && scope === 'history' ? (
              <Loader2 size={12} className="spin" />
            ) : total ? (
              `${total} match${total !== 1 ? 'es' : ''}`
            ) : (
              ''
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
