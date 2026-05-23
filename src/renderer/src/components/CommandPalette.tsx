import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { getCommands, type Command } from '@renderer/lib/commands'

/** Lightweight fuzzy match: every query char appears in order. Returns a score (lower = better). */
function fuzzy(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let score = 0
  let lastIdx = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += lastIdx >= 0 ? ti - lastIdx : 0
      lastIdx = ti
      qi++
    }
  }
  return qi === q.length ? score : null
}

export default function CommandPalette(): JSX.Element | null {
  const show = useUi((s) => s.showCommandPalette)
  const setShow = useUi((s) => s.setShowCommandPalette)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll the active item into view whenever it changes.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Snapshot the command list each time the palette opens.
  const commands = useMemo(() => (show ? getCommands().filter((c) => !c.hidden) : []), [show])

  const results = useMemo(() => {
    const scored: { cmd: Command; score: number }[] = []
    for (const cmd of commands) {
      const s = fuzzy(query, `${cmd.group} ${cmd.title}`)
      if (s !== null) scored.push({ cmd, score: s })
    }
    scored.sort((a, b) => a.score - b.score)
    return scored.map((s) => s.cmd)
  }, [commands, query])

  useEffect(() => {
    if (show) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [show])

  useEffect(() => setActive(0), [query])

  if (!show) return null

  const run = (cmd: Command | undefined): void => {
    if (!cmd) return
    setShow(false)
    cmd.run()
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
      run(results[active])
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
            placeholder="Type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">No matching commands</div>}
          {results.map((cmd, i) => (
            <button
              key={cmd.id}
              className={'palette-item' + (i === active ? ' active' : '')}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(cmd)}
            >
              <span className="palette-group">{cmd.group}</span>
              <span className="palette-title">{cmd.title}</span>
              {cmd.shortcut && <kbd className="palette-shortcut">{cmd.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
