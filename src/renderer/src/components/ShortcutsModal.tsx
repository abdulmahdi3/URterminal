import { useUi } from '@renderer/store/ui'
import { useShortcuts } from '@renderer/store/shortcuts'
import { getCommands } from '@renderer/lib/commands'

// Order the groups appear in the cheatsheet (any other group is appended after).
const GROUP_ORDER = ['General', 'Panes', 'Agent', 'Shells', 'App']

/**
 * Shortcuts handled directly in the hotkey layer (not bound to a palette
 * command), so they can't be derived from `getCommands()`. Listed manually.
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

export default function ShortcutsModal(): JSX.Element | null {
  const show = useUi((s) => s.showShortcuts)
  const setShow = useUi((s) => s.setShowShortcuts)
  const custom = useShortcuts((s) => s.custom)
  if (!show) return null

  // Build the list from the live commands so new shortcuts + rebinds show up.
  const byGroup = new Map<string, [string, string][]>()
  const add = (group: string, keys: string, desc: string): void => {
    const rows = byGroup.get(group) ?? []
    rows.push([keys, desc])
    byGroup.set(group, rows)
  }

  // Seed the non-command hints first so they head their group.
  for (const [group, rows] of Object.entries(EXTRAS))
    for (const [keys, desc] of rows) add(group, keys, desc)

  for (const cmd of getCommands()) {
    // The per-pane focus commands are collapsed into the "Ctrl+1…9" extra above.
    if (cmd.id.startsWith('pane.focus.')) continue
    const combo = custom[cmd.id] ?? cmd.shortcut
    if (!combo) continue
    add(cmd.group, fmt(combo), cmd.title)
  }

  // Stable group order: known groups first, then any extras alphabetically.
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
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>
        <div className="modal-body shortcuts-grid">
          {groups.map((group) => (
            <section key={group} className="shortcuts-section">
              <h3>{group}</h3>
              {byGroup.get(group)!.map(([keys, desc]) => (
                <div className="shortcut-row" key={keys + desc}>
                  <kbd>{keys}</kbd>
                  <span>{desc}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
