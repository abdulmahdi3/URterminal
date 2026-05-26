import { useEffect, useRef, useState } from 'react'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { searchInPane, clearSearch, onSearchResults } from '@renderer/lib/terminalPool'

/**
 * Ctrl+F scrollback search for the active pane. Floats at the top-right of the
 * workspace and drives xterm's search addon (next/prev + highlighted matches).
 */
export default function SearchBar(): JSX.Element | null {
  const open = useUi((s) => s.searchOpen)
  const setOpen = useUi((s) => s.setSearchOpen)
  const paneId = useWorkspace((s) => s.activePaneId)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ resultIndex: -1, resultCount: 0 })
  const ref = useRef<HTMLInputElement>(null)

  // Track match counts for the active pane while the bar is open.
  useEffect(() => {
    if (!open || !paneId) return
    const off = onSearchResults(paneId, setResults)
    return off
  }, [open, paneId])

  useEffect(() => {
    if (open) requestAnimationFrame(() => ref.current?.focus())
  }, [open])

  // Re-run the search whenever the query changes.
  useEffect(() => {
    if (!open || !paneId) return
    searchInPane(paneId, query, 'next')
    if (!query) setResults({ resultIndex: -1, resultCount: 0 })
  }, [query, open, paneId])

  if (!open) return null

  const close = (): void => {
    if (paneId) clearSearch(paneId)
    setOpen(false)
  }
  const find = (dir: 'next' | 'prev'): void => {
    if (paneId && query) searchInPane(paneId, query, dir)
  }

  return (
    <div className="search-bar" onMouseDown={(e) => e.stopPropagation()}>
      <Search size={13} className="search-bar-icon" />
      <input
        ref={ref}
        className="search-bar-input"
        placeholder="Search scrollback…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            find(e.shiftKey ? 'prev' : 'next')
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      <span className="search-bar-count">
        {results.resultCount ? `${results.resultIndex + 1}/${results.resultCount}` : query ? '0/0' : ''}
      </span>
      <button className="icon-btn" title="Previous (Shift+Enter)" onClick={() => find('prev')}>
        <ChevronUp size={14} />
      </button>
      <button className="icon-btn" title="Next (Enter)" onClick={() => find('next')}>
        <ChevronDown size={14} />
      </button>
      <button className="icon-btn" title="Close (Esc)" onClick={close}>
        <X size={14} />
      </button>
    </div>
  )
}
