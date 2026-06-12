import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useShortcuts } from '@renderer/store/shortcuts'
import { eventToCombo } from '@renderer/lib/keys'
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

interface Section {
  group: string
  items: Command[]
}

/** Newest features, pinned to the top of a cold-open palette (most recent first). */
const NEW_FEATURE_IDS = [
  'app.timeline',
  'app.tasks',
  'app.rooms',
  'app.bridge',
  'pane.newStream',
  'pane.reviewDiff'
]

/** Held modifiers as a partial combo, e.g. "Ctrl+", "Ctrl+Shift+" (Meta shows as Ctrl). */
function heldModifiers(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  return parts.length ? parts.join('+') + '+' : ''
}

/** Per-row shortcut field: shows the current binding; click to record a new one. */
function ShortcutCell({
  builtin,
  custom,
  recording,
  onStart,
  onSet,
  onClear,
  onCancel
}: {
  builtin?: string
  custom?: string
  recording: boolean
  onStart: () => void
  /** returns false if the combo is already taken (recorder stays open + flashes) */
  onSet: (combo: string) => boolean
  onClear: () => void
  onCancel: () => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [taken, setTaken] = useState(false)
  // Live text in the field: held modifiers while recording, or a rejected combo.
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (recording) {
      ref.current?.focus()
      setPreview('')
      setTaken(false)
    }
  }, [recording])

  if (recording) {
    return (
      <input
        ref={ref}
        className={'palette-rec' + (taken ? ' taken' : '')}
        readOnly
        value={preview}
        placeholder={taken ? 'Already used!' : 'Press keys… (Esc)'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onBlur={onCancel}
        onAnimationEnd={() => setTaken(false)}
        onKeyUp={(e) => setPreview(heldModifiers(e.nativeEvent))}
        onKeyDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Escape') {
            onCancel()
            return
          }
          const combo = eventToCombo(e.nativeEvent)
          if (!combo) {
            // No full combo yet — show the modifiers being held down.
            setPreview(heldModifiers(e.nativeEvent))
            return
          }
          if (onSet(combo)) return // accepted → recorder closes
          // Rejected: show the attempted combo in red + shake.
          setPreview(combo)
          setTaken(false)
          requestAnimationFrame(() => setTaken(true))
        }}
      />
    )
  }

  const eff = custom ?? builtin
  return (
    <span
      className="palette-sc"
      title={eff ? 'Click to change shortcut' : 'Click to set a shortcut'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onStart()
      }}
    >
      {eff ? (
        <kbd className={'palette-shortcut' + (custom ? ' custom' : '')}>{eff}</kbd>
      ) : (
        <span className="palette-sc-add">+ shortcut</span>
      )}
      {custom && (
        <span
          className="palette-sc-clear"
          title="Reset to default"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
        >
          ×
        </span>
      )}
    </span>
  )
}

export default function CommandPalette(): JSX.Element | null {
  const show = useUi((s) => s.showCommandPalette)
  const setShow = useUi((s) => s.setShowCommandPalette)
  const custom = useShortcuts((s) => s.custom)
  const setShortcut = useShortcuts((s) => s.setShortcut)
  const clearShortcut = useShortcuts((s) => s.clearShortcut)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Snapshot the command list each time the palette opens.
  const commands = useMemo(() => (show ? getCommands().filter((c) => !c.hidden) : []), [show])

  // Unique category names (for the filter tags), in first-seen order.
  const groups = useMemo(() => {
    const seen: string[] = []
    for (const c of commands) if (!seen.includes(c.group)) seen.push(c.group)
    return seen
  }, [commands])

  // Filter + score, then group by category (groups ordered by their best score).
  // When the palette opens cold (no query, no group filter) the newest features
  // are pinned to the top in a "✨ New" section so they're easy to discover.
  const { sections, flat } = useMemo(() => {
    const showNew = !query.trim() && !groupFilter
    const newSet = new Set(showNew ? NEW_FEATURE_IDS : [])

    const scored: { cmd: Command; score: number }[] = []
    for (const cmd of commands) {
      if (groupFilter && cmd.group !== groupFilter) continue
      const s = fuzzy(query, `${cmd.group} ${cmd.title}`)
      if (s !== null) scored.push({ cmd, score: s })
    }
    scored.sort((a, b) => a.score - b.score)

    const order: string[] = []
    const byGroup = new Map<string, Command[]>()
    for (const { cmd } of scored) {
      if (newSet.has(cmd.id)) continue // surfaced in the New section instead
      if (!byGroup.has(cmd.group)) {
        byGroup.set(cmd.group, [])
        order.push(cmd.group)
      }
      byGroup.get(cmd.group)!.push(cmd)
    }
    const secs: Section[] = order.map((g) => ({ group: g, items: byGroup.get(g)! }))

    if (showNew) {
      const newItems = NEW_FEATURE_IDS.map((id) => commands.find((c) => c.id === id)).filter(
        (c): c is Command => !!c
      )
      if (newItems.length) secs.unshift({ group: '✨ New', items: newItems })
    }
    return { sections: secs, flat: secs.flatMap((s) => s.items) }
  }, [commands, query, groupFilter])

  // Keep the active item scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  useEffect(() => {
    if (show) {
      setQuery('')
      setActive(0)
      setGroupFilter(null)
      setRecordingId(null)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [show])

  useEffect(() => setActive(0), [query, groupFilter])

  if (!show) return null

  const run = (cmd: Command | undefined): void => {
    if (!cmd) return
    setShow(false)
    cmd.run()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(flat.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(flat[active])
    }
  }

  let idx = -1 // running flat index assigned as items render

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

        {/* colorful category filter tags */}
        <div className="palette-tags">
          {groups.map((g) => (
            <button
              key={g}
              className={'palette-tag' + (groupFilter === g ? ' active' : '')}
              onClick={() => setGroupFilter((cur) => (cur === g ? null : g))}
            >
              <span className="palette-tag-hash">#</span>
              {g.toLowerCase()}
            </button>
          ))}
        </div>

        <div className="palette-list" ref={listRef}>
          {flat.length === 0 && <div className="palette-empty">No matching commands</div>}
          {sections.map((section) => (
            <div className="palette-section" key={section.group}>
              <div className="palette-section-title">{section.group}</div>
              {section.items.map((cmd) => {
                idx += 1
                const i = idx
                return (
                  <div
                    key={cmd.id}
                    role="button"
                    data-idx={i}
                    className={'palette-item' + (i === active ? ' active' : '')}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(cmd)}
                  >
                    <span className="palette-title">{cmd.title}</span>
                    <ShortcutCell
                      builtin={cmd.shortcut}
                      custom={custom[cmd.id]}
                      recording={recordingId === cmd.id}
                      onStart={() => setRecordingId(cmd.id)}
                      onSet={(combo) => {
                        // Reject if another command already owns this combo
                        // (custom binding or built-in) — don't overwrite.
                        const taken = commands.some(
                          (o) => o.id !== cmd.id && (custom[o.id] ?? o.shortcut) === combo
                        )
                        if (taken) return false
                        setShortcut(cmd.id, combo)
                        setRecordingId(null)
                        return true
                      }}
                      onClear={() => clearShortcut(cmd.id)}
                      onCancel={() => setRecordingId(null)}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="palette-footer">
          <span className="pf-hint">
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate · <CornerDownLeft size={11} /> run · click a shortcut to rebind
          </span>
          <span className="pf-count">
            {flat.length} of {commands.length}
          </span>
        </div>
      </div>
    </div>
  )
}
