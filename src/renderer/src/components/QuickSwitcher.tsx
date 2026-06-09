import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft, Bot, TerminalSquare, Square } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { collectSwitchTargets, jumpToPane, type SwitchTarget } from '@renderer/lib/paneSwitch'

/** Lightweight subsequence fuzzy match: every query char appears in order. */
function fuzzy(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let score = 0
  let last = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += last >= 0 ? ti - last : 0
      last = ti
      qi++
    }
  }
  return qi === q.length ? score : null
}

function TypeIcon({ type }: { type: SwitchTarget['type'] }): JSX.Element {
  if (type === 'ai') return <Bot size={15} />
  if (type === 'shell') return <TerminalSquare size={15} />
  return <Square size={15} />
}

/**
 * Pane quick-switcher (Ctrl+P): fuzzy-jump to any pane across every workspace by
 * title, agent/shell, cwd, or workspace name. Switches workspace if needed.
 */
export default function QuickSwitcher(): JSX.Element | null {
  const show = useUi((s) => s.showQuickSwitch)
  const setShow = useUi((s) => s.setShowQuickSwitch)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Snapshot the pane list each time the switcher opens.
  const targets = useMemo(() => (show ? collectSwitchTargets() : []), [show])

  const results = useMemo(() => {
    const scored: { t: SwitchTarget; score: number }[] = []
    for (const t of targets) {
      const hay = `${t.title} ${t.detail} ${t.cwd ?? ''} ${t.workspaceName}`
      const s = fuzzy(query, hay)
      if (s !== null) scored.push({ t, score: s })
    }
    // Stable: keep collect order (active workspace first) within equal scores.
    scored.sort((a, b) => a.score - b.score)
    return scored.map((s) => s.t)
  }, [targets, query])

  useEffect(() => {
    if (show) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [show])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!show) return null

  const jump = (t: SwitchTarget | undefined): void => {
    if (!t) return
    setShow(false)
    jumpToPane(t)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      jump(results[active])
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={() => setShow(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <Search size={15} className="palette-search-icon" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Jump to a pane…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">No matching panes</div>}
          {results.map((t, i) => (
            <div
              key={t.paneId}
              role="button"
              data-idx={i}
              className={'palette-item qs-item' + (i === active ? ' active' : '')}
              onMouseEnter={() => setActive(i)}
              onClick={() => jump(t)}
            >
              <span className="qs-icon">
                <TypeIcon type={t.type} />
              </span>
              <span className="qs-text">
                <span className="palette-title">
                  {t.title}
                  {t.isActivePane && <span className="qs-current">current</span>}
                </span>
                <span className="qs-detail">
                  {t.detail}
                  {t.cwd ? ` · ${t.cwd}` : ''}
                </span>
              </span>
              {!t.isActiveWorkspace && (
                <span className="qs-ws" title={`In ${t.workspaceName}`}>
                  {t.workspaceName}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="palette-footer">
          <span className="pf-hint">
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate · <CornerDownLeft size={11} /> jump
          </span>
          <span className="pf-count">{results.length} panes</span>
        </div>
      </div>
    </div>
  )
}
