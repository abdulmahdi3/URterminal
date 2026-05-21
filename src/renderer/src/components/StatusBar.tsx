import { useEffect, useState } from 'react'
import { LayoutGrid, Activity, Cpu, MemoryStick, Zap, Clock } from 'lucide-react'
import { useWorkspace } from '@renderer/store/workspace'
import { useMetrics } from '@renderer/store/metrics'

const VERSION = 'v0.1.0'

export default function StatusBar(): JSX.Element {
  const paneCount = useWorkspace((s) => Object.keys(s.panes).length)
  const agentsLive = useWorkspace(
    (s) => Object.values(s.panes).filter((p) => p.type === 'ai' && p.agent?.ptyId).length
  )
  const activeAgent = useWorkspace((s) => {
    const id = s.activePaneId
    return (id && s.panes[id]?.agent?.command) || null
  })
  const ram = useMetrics((s) => s.ramMB)
  const cpu = useMetrics((s) => s.cpuPercent)
  const tok = useMetrics((s) => s.tokPerSec)

  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
  useEffect(() => {
    const id = window.setInterval(
      () => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      15000
    )
    return () => window.clearInterval(id)
  }, [])

  return (
    <footer className="statusbar">
      <span className="sb-item">
        <LayoutGrid size={12} /> {paneCount} {paneCount === 1 ? 'pane' : 'panes'}
      </span>
      <span className={'sb-item' + (agentsLive ? ' accent' : '')}>
        <Activity size={12} /> {agentsLive} live
      </span>
      {activeAgent && <span className="sb-item mono">{activeAgent}</span>}

      <span className="sb-spacer" />

      <span className="sb-item">
        <MemoryStick size={12} /> {ram ? `${ram} MB` : '—'}
      </span>
      <span className="sb-item">
        <Cpu size={12} /> {cpu ? `${cpu}%` : '0%'}
      </span>
      <span className="sb-item">
        <Zap size={12} /> {tok || 0} tok/s
      </span>
      <span className="sb-item">
        <Clock size={12} /> {clock}
      </span>
      <span className="sb-item dim">{VERSION}</span>
    </footer>
  )
}
