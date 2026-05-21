import { useUi } from '@renderer/store/ui'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'General',
    items: [
      ['Ctrl + K', 'Command palette'],
      ['Ctrl + ,', 'Settings'],
      ['?', 'This cheatsheet'],
      ['Esc', 'Stop stream · close overlay · exit zoom']
    ]
  },
  {
    title: 'Panes',
    items: [
      ['Ctrl + T', 'New agent pane (claude)'],
      ['Ctrl + Shift + 5', 'New shell pane'],
      ['Ctrl + D', 'Split → right'],
      ['Ctrl + Shift + D', 'Split → down'],
      ['Ctrl + W', 'Close active pane'],
      ['Ctrl + Shift + T', 'Reopen closed pane'],
      ['Ctrl + Shift + Enter', 'Zoom active pane'],
      ['Ctrl + 1…9', 'Focus pane by number'],
      ['F2 / double-click', 'Rename pane']
    ]
  },
  {
    title: 'Agents',
    items: [
      ['Ctrl + K', 'Palette → "Run agent: …"'],
      ['claude · codex · gemini · aider', 'Available agents'],
      ['Palette → Restart agent', 'Relaunch the CLI']
    ]
  }
]

export default function ShortcutsModal(): JSX.Element | null {
  const show = useUi((s) => s.showShortcuts)
  const setShow = useUi((s) => s.setShowShortcuts)
  if (!show) return null

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
          {GROUPS.map((g) => (
            <section key={g.title} className="shortcuts-section">
              <h3>{g.title}</h3>
              {g.items.map(([keys, desc]) => (
                <div className="shortcut-row" key={keys}>
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
