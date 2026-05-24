import { useEffect, useRef, useState } from 'react'
import { LayoutGrid, Cpu, MemoryStick, Zap, Clock, ArrowRight, Bot } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useMetrics } from '@renderer/store/metrics'
import { useTokens } from '@renderer/store/tokens'
import { useUi } from '@renderer/store/ui'
import { getLeaves } from '@renderer/lib/mosaicTree'
import { LAYOUT_PRESETS } from '@renderer/lib/layoutPresets'
import type { LayoutPreset } from '@renderer/lib/layoutPresets'

const VERSION = 'v0.1.0'

function formatChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

/** MB below 1000, GB above. */
function formatMem(mb: number): string {
  return mb >= 1000 ? `${(mb / 1024).toFixed(2)} GB` : `${mb} MB`
}


function LayoutTile({ preset, onClick }: { preset: LayoutPreset; onClick: () => void }): JSX.Element {
  return (
    <button className="lp-tile" title={preset.label} onClick={onClick}>
      <div className="lp-grid">
        {preset.tiles.map((tile, i) => (
          <div
            key={i}
            className="lp-pane"
            style={{
              left: `${tile.l}%`,
              top: `${tile.t}%`,
              width: `${tile.w}%`,
              height: `${tile.h}%`
            }}
          />
        ))}
      </div>
      <span className="lp-label">{preset.label}</span>
    </button>
  )
}

export default function StatusBar(): JSX.Element {
  const paneCount = useWorkspace((s) => Object.keys(s.panes).length)
  const activePaneId = useWorkspace((s) => s.activePaneId)
  const layout = useWorkspace((s) => s.layout)
  const panes = useWorkspace((s) => s.panes)
  const togglePipeTarget = useWorkspace((s) => s.togglePipeTarget)
  const applyLayoutPreset = useWorkspace((s) => s.applyLayoutPreset)

  const activePanesMap = useTokens((s) => s.activePanes)
  const agentsWorking = Object.keys(activePanesMap).filter((id) => panes[id]?.type === 'ai').length
  const streaming = agentsWorking > 0

  const ram = useMetrics((s) => s.ramMB)
  const cpu = useMetrics((s) => s.cpuPercent)
  const tok = useMetrics((s) => s.tokPerSec)
  const totalTokens = useTokens((s) => s.total)

  const toggleTaskManager = useUi((s) => s.toggleTaskManager)

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

  const leaves = getLeaves(layout).slice(0, 9)
  const activeTargets = activePaneId ? (panes[activePaneId]?.pipeTargets ?? []) : []
  const showPipeRow = paneCount >= 2 && !!activePaneId && leaves.length >= 2

  const [layoutOpen, setLayoutOpen] = useState(false)
  const layoutCloseRef = useRef<number>(0)

  const openLayout = (): void => {
    window.clearTimeout(layoutCloseRef.current)
    setLayoutOpen(true)
  }
  const closeLayout = (): void => {
    layoutCloseRef.current = window.setTimeout(() => setLayoutOpen(false), 180)
  }

  return (
    <footer className="statusbar">
      {/* Layout preset picker */}
      <div
        className={clsx('sb-layout-wrap', layoutOpen && 'open')}
        onMouseEnter={openLayout}
        onMouseLeave={closeLayout}
      >
        <span className="sb-item sb-layout-btn">
          <LayoutGrid size={12} />
          <span className="sb-layout-count">{paneCount}</span>
        </span>
        <div className="sb-layout-popup" onMouseEnter={openLayout} onMouseLeave={closeLayout}>
          <div className="sb-layout-grid">
            {LAYOUT_PRESETS.map((preset) => (
              <LayoutTile
                key={preset.id}
                preset={preset}
                onClick={() => { applyLayoutPreset(preset.id); setLayoutOpen(false) }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Always-visible working count */}
      <span className={clsx('sb-item', streaming && 'accent')}>
        <span className={clsx('sb-dot', streaming && 'live', streaming && 'streaming')} />
        {agentsWorking} active
      </span>

      {/* Pipe target selector */}
      {showPipeRow && (
        <span className="sb-pipe-row">
          <ArrowRight size={11} className="sb-pipe-icon" />
          <span className="sb-pipe-label">pipe to</span>
          {leaves.map((paneId, i) => {
            if (paneId === activePaneId) return null
            const num = i + 1
            const isTarget = activeTargets.includes(paneId)
            return (
              <button
                key={paneId}
                className={clsx('sb-pipe-badge', isTarget && 'active')}
                onClick={() => activePaneId && togglePipeTarget(activePaneId, paneId)}
                title={isTarget ? `Stop piping to pane ${num}` : `Pipe output → pane ${num}`}
              >
                {num}
              </button>
            )
          })}
          {activeTargets.length > 0 && (
            <span className="sb-pipe-count">{activeTargets.length} connected</span>
          )}
        </span>
      )}

      <span className="sb-spacer" />

      {/* Combined CPU + RAM button → opens the task manager */}
      <button
        className="sb-item sb-resource-btn"
        onClick={toggleTaskManager}
        title="Open task manager"
      >
        <Cpu size={12} /> {cpu ? `${cpu}%` : '0%'}
        <span className="sb-resource-sep">·</span>
        <MemoryStick size={12} /> {ram ? formatMem(ram) : '—'}
      </button>

      {/* Claude session output (raw terminal chars, not API tokens) */}
      <span className="sb-item sb-claude" title="output tokens">
        <Bot size={12} />
        <span>{formatChars(totalTokens * 4)}</span>
      </span>

      <span className="sb-item">
        <Clock size={12} /> {clock}
      </span>
      <span className="sb-item dim">{VERSION}</span>
    </footer>
  )
}
