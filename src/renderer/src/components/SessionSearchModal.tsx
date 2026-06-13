import { useEffect, useRef, useState } from 'react'
import { Search, History, FolderOpen, CornerDownLeft, Loader2 } from 'lucide-react'
import type { SessionHit } from '@shared/types'
import { useUi } from '@renderer/store/ui'
import { useSessions } from '@renderer/store/sessions'

/** "x minutes/hours/days ago" for a result timestamp. */
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

/** Highlight every case-insensitive occurrence of `q` inside `text`. */
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
      <mark className="ss-hl" key={k++}>
        {text.slice(at, at + q.length)}
      </mark>
    )
    i = at + q.length
  }
  return <>{out}</>
}

/**
 * Cross-session search: full-text search over every past Claude conversation
 * (indexed in the main process). Pick a result to resume that exact session in a
 * new pane. Debounced search; ↑/↓ to navigate, Enter to open.
 */
export default function SessionSearchModal(): JSX.Element | null {
  const show = useUi((s) => s.showSessionSearch)
  const setShow = useUi((s) => s.setShowSessionSearch)
  const resumeChat = useSessions((s) => s.resumeChat)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SessionHit[]>([])
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const reqRef = useRef(0)

  useEffect(() => {
    if (show) {
      setQuery('')
      setHits([])
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [show])

  // Debounced search; the latest request wins (reqRef guards out-of-order results).
  useEffect(() => {
    if (!show) return
    const q = query.trim()
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
          setActive(0)
          setBusy(false)
        })
        .catch(() => {
          if (id === reqRef.current) setBusy(false)
        })
    }, 220)
    return () => window.clearTimeout(t)
  }, [query, show])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!show) return null

  const open = (hit: SessionHit | undefined): void => {
    if (!hit) return
    setShow(false)
    resumeChat({
      sessionId: hit.sessionId,
      agent: 'claude',
      cwd: hit.cwd ?? '',
      title: hit.title ?? 'chat',
      updatedAt: hit.when
    })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(hits.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      open(hits[active])
    }
  }

  return (
    <div className="palette-overlay ss-fullscreen" onMouseDown={() => setShow(false)}>
      <div className="palette ss-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <Search size={15} className="palette-search-icon" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search your past conversations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {busy ? <Loader2 size={14} className="spin" /> : <kbd>Esc</kbd>}
        </div>

        <div className="palette-list" ref={listRef}>
          {!query.trim() && (
            <div className="palette-empty">
              <History size={20} />
              <div>Search everything you've discussed — then jump back in.</div>
            </div>
          )}
          {query.trim() && !busy && hits.length === 0 && (
            <div className="palette-empty">No past conversations matched “{query.trim()}”.</div>
          )}
          {hits.map((h, i) => (
            <div
              key={h.sessionId}
              role="button"
              data-idx={i}
              className={'palette-item ss-item' + (i === active ? ' active' : '')}
              onMouseEnter={() => setActive(i)}
              onClick={() => open(h)}
            >
              <div className="ss-row">
                <span className="ss-title">{h.title || 'Untitled conversation'}</span>
                <span className="ss-when">{ago(h.when)}</span>
              </div>
              {h.snippet && <div className="ss-snippet">{highlight(h.snippet, query.trim())}</div>}
              {h.cwd && (
                <div className="ss-cwd">
                  <FolderOpen size={11} /> {h.cwd}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="palette-footer">
          <span className="pf-hint">
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate · <CornerDownLeft size={11} /> resume conversation
          </span>
          <span className="pf-count">{hits.length ? `${hits.length} found` : ''}</span>
        </div>
      </div>
    </div>
  )
}
