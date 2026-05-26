import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { RotateCcw } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useShortcuts } from '@renderer/store/shortcuts'
import { getCommands } from '@renderer/lib/commands'
import { eventToCombo } from '@renderer/lib/keys'

// Order the groups appear in the cheatsheet (any other group is appended after).
const GROUP_ORDER = ['General', 'Panes', 'Agent', 'Shells', 'App']

/**
 * Reserved/handled-elsewhere shortcuts that aren't bound to a palette command,
 * so they can't be derived from `getCommands()` and aren't rebindable. Shown as
 * static rows for reference.
 */
const EXTRAS: Record<string, [string, string][]> = {
  General: [
    ['Ctrl+K', 'Command palette'],
    ['Esc', 'Stop stream · close overlay · exit zoom']
  ],
  Panes: [
    ['Ctrl+1…9', 'Focus pane by number'],
    ['F2 / double-click', 'Rename pane']
  ]
}

/** "Ctrl+Shift+S" → "Ctrl + Shift + S"; leave plain hints like "F2 / …" alone. */
function fmt(combo: string): string {
  return combo.includes('+') ? combo.split('+').join(' + ') : combo
}

type Row =
  | { kind: 'static'; keys: string; desc: string }
  | { kind: 'cmd'; id: string; title: string; combo?: string; custom: boolean }

export default function ShortcutsModal(): JSX.Element | null {
  const show = useUi((s) => s.showShortcuts)
  const setShow = useUi((s) => s.setShowShortcuts)
  const custom = useShortcuts((s) => s.custom)
  const setShortcut = useShortcuts((s) => s.setShortcut)
  const clearShortcut = useShortcuts((s) => s.clearShortcut)
  const resetAll = useShortcuts((s) => s.resetAll)
  const [recordingId, setRecordingId] = useState<string | null>(null)

  // While recording a rebind, capture the next combo on the capture phase so it
  // beats the global hotkey handler. Esc cancels; Backspace/Delete resets.
  useEffect(() => {
    if (!recordingId) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecordingId(null)
      if (e.key === 'Backspace' || e.key === 'Delete') {
        clearShortcut(recordingId)
        return setRecordingId(null)
      }
      const combo = eventToCombo(e)
      if (!combo) return // keep waiting for a valid modifier combo
      // Free this combo from any other command (explicit unbind) so a key maps
      // to exactly one command.
      for (const c of getCommands()) {
        if (c.id === recordingId) continue
        const eff = c.id in custom ? custom[c.id] : c.shortcut
        if (eff && eff === combo) setShortcut(c.id, '')
      }
      setShortcut(recordingId, combo)
      setRecordingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recordingId, custom, setShortcut, clearShortcut])

  if (!show) return null

  const byGroup = new Map<string, Row[]>()
  const add = (group: string, row: Row): void => {
    const rows = byGroup.get(group) ?? []
    rows.push(row)
    byGroup.set(group, rows)
  }

  // Static reference rows first so they head their group.
  for (const [group, rows] of Object.entries(EXTRAS))
    for (const [keys, desc] of rows) add(group, { kind: 'static', keys, desc })

  // Editable rows for every command that has a default or a custom binding.
  for (const cmd of getCommands()) {
    if (cmd.hidden) continue // includes the per-number focus commands
    const hasBinding = cmd.shortcut !== undefined || cmd.id in custom
    if (!hasBinding) continue
    const combo = cmd.id in custom ? custom[cmd.id] : cmd.shortcut
    add(cmd.group, {
      kind: 'cmd',
      id: cmd.id,
      title: cmd.title,
      combo: combo || undefined,
      custom: cmd.id in custom
    })
  }

  const groups = [...byGroup.keys()].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a)
    const bi = GROUP_ORDER.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Keyboard shortcuts</h2>
          <div className="shortcuts-actions">
            <button className="btn sm" onClick={() => resetAll()} title="Reset all shortcuts to their defaults">
              <RotateCcw size={12} /> Restore defaults
            </button>
            <button className="icon-btn" onClick={() => setShow(false)}>
              ✕
            </button>
          </div>
        </div>
        <p className="shortcuts-hint">
          Click a shortcut to rebind it · Esc cancels · Backspace resets to default
        </p>
        <div className="modal-body shortcuts-grid">
          {groups.map((group) => (
            <section key={group} className="shortcuts-section">
              <h3>{group}</h3>
              {byGroup.get(group)!.map((row) =>
                row.kind === 'static' ? (
                  <div className="shortcut-row" key={`s:${row.keys}:${row.desc}`}>
                    <span>{row.desc}</span>
                    <kbd>{fmt(row.keys)}</kbd>
                  </div>
                ) : (
                  <div className="shortcut-row" key={row.id}>
                    <span>{row.title}</span>
                    <div className="shortcut-keys">
                      <button
                        className={clsx(
                          'shortcut-edit',
                          recordingId === row.id && 'recording',
                          !row.combo && 'unbound'
                        )}
                        title="Click, then press the new shortcut"
                        onClick={() => setRecordingId(row.id)}
                      >
                        {recordingId === row.id
                          ? 'Press keys…'
                          : row.combo
                            ? fmt(row.combo)
                            : 'Unbound'}
                      </button>
                      {row.custom && (
                        <button
                          className="icon-btn shortcut-reset"
                          title="Reset to default"
                          onClick={() => clearShortcut(row.id)}
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
