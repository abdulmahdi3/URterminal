import { Terminal, Plus, Settings, Command as CommandIcon } from 'lucide-react'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'
import { useMetrics } from '@renderer/store/metrics'

export default function TitleBar(): JSX.Element {
  const addPane = useWorkspace((s) => s.addPane)
  const paneCount = useWorkspace((s) => Object.keys(s.panes).length)
  const setShowSettings = useUi((s) => s.setShowSettings)
  const togglePalette = useUi((s) => s.toggleCommandPalette)

  const ram = useMetrics((s) => s.ramMB)
  const cpu = useMetrics((s) => s.cpuPercent)
  const tok = useMetrics((s) => s.tokPerSec)
  const live = useWorkspace((s) =>
    Object.values(s.panes).some((p) => p.type === 'ai' && p.agent?.ptyId)
  )

  return (
    <header className="titlebar">
      <div className="titlebar-brand" data-nodrag>
        <Terminal size={15} className="brand-icon" />
        <span className="brand-name">uregant-terminal</span>
      </div>

      <div className="titlebar-actions" data-nodrag>
        <button className="btn primary sm" onClick={() => addPane('ai')}>
          <Plus size={13} /> Agent
        </button>
        <button className="btn sm" onClick={() => addPane('shell')}>
          <Plus size={13} /> Shell
        </button>
        <span className="badge">{paneCount} panes</span>
      </div>

      {/* drag region fills the gap */}
      <div className="titlebar-drag" />

      <div className="titlebar-stats" data-nodrag>
        <span className="pill">
          RAM <b>{ram ? `${ram} MB` : '—'}</b>
        </span>
        <span className="pill">
          CPU <b>{cpu ? `${cpu}%` : '0%'}</b>
        </span>
        <span className="pill">
          <span className={'dot' + (live ? ' live' : '')} />
          TOK/S <b>{tok || 0}</b>
        </span>
        <button className="icon-btn" title="Command palette (Ctrl+K)" onClick={togglePalette}>
          <CommandIcon size={15} />
        </button>
        <button className="icon-btn" title="Settings (Ctrl+,)" onClick={() => setShowSettings(true)}>
          <Settings size={15} />
        </button>
      </div>
    </header>
  )
}
