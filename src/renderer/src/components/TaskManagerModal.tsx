import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Bot, Terminal, Cpu, MemoryStick, Square, Activity, X, ChevronUp, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { useMetrics } from '@renderer/store/metrics'
import { useTokens, formatTokens } from '@renderer/store/tokens'
import { costFor, formatCost } from '@renderer/lib/pricing'
import type { PtyTaskInfo, SystemProcess } from '@shared/types'

type Tab = 'tasks' | 'system'
type SortKey = 'name' | 'cpuPercent' | 'memMB' | 'pid'
type SortDir = 'asc' | 'desc'

/** MB below 1000, GB above — so big processes read "1.83 GB" instead of "1873.4 MB". */
function formatMem(mb: number): string {
  if (mb >= 1000) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// ---------------------------------------------------------------------------
// "Tasks" tab — the app's own agent/shell sessions.
// ---------------------------------------------------------------------------
function TasksTab(): JSX.Element {
  const panes = useWorkspace((s) => s.panes)
  const removePane = useWorkspace((s) => s.removePane)
  const byPane = useTokens((s) => s.byPane)
  const activePanes = useTokens((s) => s.activePanes)

  const [tasks, setTasks] = useState<PtyTaskInfo[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void window.api.listPtys().then((t) => alive && setTasks(t))
      setNow(Date.now())
    }
    refresh()
    const id = window.setInterval(refresh, 1000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const endTask = (paneId: string): void => {
    window.api.linkPaneToTelegram(paneId, null)
    removePane(paneId)
  }

  if (tasks.length === 0) return <p className="tm-empty">No running tasks.</p>

  const sessionCost = tasks.reduce(
    (acc, t) => acc + costFor(byPane[t.paneId] ?? 0, panes[t.paneId]?.agent?.command),
    0
  )

  return (
    <>
      <table className="tm-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Process</th>
            <th>PID</th>
            <th>Uptime</th>
            <th>Output</th>
            <th>Est. cost</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const pane = panes[t.paneId]
            const isAi = pane?.type === 'ai'
            const live = !!activePanes[t.paneId]
            const tokens = byPane[t.paneId] ?? 0
            const cost = costFor(tokens, pane?.agent?.command)
            const shellName = t.shell.split(/[\\/]/).pop() ?? t.shell
            return (
              <tr key={t.ptyId}>
                <td className="tm-name">
                  {isAi ? (
                    <Bot size={14} className="pane-icon ai" />
                  ) : (
                    <Terminal size={14} className="pane-icon shell" />
                  )}
                  <span>{pane?.title ?? t.paneId}</span>
                  {live && <span className="tm-live">live</span>}
                </td>
                <td className="tm-mono">{shellName}</td>
                <td className="tm-mono">{t.pid}</td>
                <td className="tm-mono">{formatUptime(Math.max(0, now - t.startedAt))}</td>
                <td className="tm-mono">{tokens ? `~${formatTokens(tokens)}` : '—'}</td>
                <td className="tm-mono">{isAi && cost > 0 ? formatCost(cost) : '—'}</td>
                <td>
                  <button
                    className="btn sm danger"
                    title="End this task (kills the process)"
                    onClick={() => endTask(t.paneId)}
                  >
                    <Square size={11} /> End task
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="tm-cost-note">
        Estimated session cost: <b>{formatCost(sessionCost)}</b> — rough, based on output tokens
        only.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// "System" tab — every OS process, sortable, virtualized for instant repaint.
// ---------------------------------------------------------------------------
function SystemTab(): JSX.Element {
  const [procs, setProcs] = useState<SystemProcess[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('memMB')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    let inflight = false
    const refresh = (): void => {
      if (inflight) return // skip if the previous sample is still running
      inflight = true
      window.api
        .listSystemProcesses()
        .then((p) => {
          if (alive) {
            setProcs(p)
            setLoading(false)
          }
        })
        .finally(() => {
          inflight = false
        })
    }
    refresh()
    const id = window.setInterval(refresh, 2000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const rows = q ? procs.filter((p) => p.name.toLowerCase().includes(q)) : procs
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir
      return (a[sortKey] - b[sortKey]) * dir
    })
  }, [procs, sortKey, sortDir, filter])

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 14
  })

  const sortBy = (key: SortKey): void => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const totalMem = procs.reduce((acc, p) => acc + p.memMB, 0)

  const Header = ({ label, k, align }: { label: string; k: SortKey; align?: 'right' }): JSX.Element => (
    <button
      className={clsx('sp-th', align === 'right' && 'right', sortKey === k && 'active')}
      onClick={() => sortBy(k)}
    >
      {label}
      {sortKey === k && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
    </button>
  )

  return (
    <div className="sp-wrap">
      <div className="sp-toolbar">
        <input
          className="sp-filter"
          placeholder="Filter by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="sp-summary">
          {sorted.length} processes · {(totalMem / 1024).toFixed(2)} GB
        </span>
      </div>

      <div className="sp-head">
        <Header label="Name" k="name" />
        <Header label="CPU" k="cpuPercent" align="right" />
        <Header label="Memory" k="memMB" align="right" />
        <Header label="PID" k="pid" align="right" />
        <span className="sp-th-action" />
      </div>

      <div className="sp-list" ref={parentRef}>
        {sorted.length === 0 && (
          <p className="tm-empty">{loading ? 'Reading processes…' : 'No processes match.'}</p>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const p = sorted[vi.index]
            return (
              <div
                key={p.pid}
                className="sp-row"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`
                }}
              >
                <span className="sp-name" title={p.name}>{p.name}</span>
                <span className={clsx('sp-cell right', p.cpuPercent >= 1 && 'hot')}>
                  {p.cpuPercent.toFixed(1)}%
                </span>
                <span className={clsx('sp-cell right', p.memMB >= 500 && 'hot')}>
                  {formatMem(p.memMB)}
                </span>
                <span className="sp-cell right mono">{p.pid}</span>
                <button
                  className="sp-kill"
                  title={`End ${p.name} (PID ${p.pid})`}
                  onClick={() => window.api.killSystemProcess(p.pid)}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function TaskManagerModal(): JSX.Element | null {
  const show = useUi((s) => s.showTaskManager)
  const setShow = useUi((s) => s.setShowTaskManager)
  const ram = useMetrics((s) => s.ramMB)
  const cpu = useMetrics((s) => s.cpuPercent)
  const [tab, setTab] = useState<Tab>('tasks')

  if (!show) return null

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal taskmgr" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="tm-tabs">
            <button
              className={clsx('tm-tab', tab === 'tasks' && 'active')}
              onClick={() => setTab('tasks')}
            >
              Tasks
            </button>
            <button
              className={clsx('tm-tab', tab === 'system' && 'active')}
              onClick={() => setTab('system')}
            >
              System
            </button>
          </div>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>

        {/* App-wide resource usage */}
        <div className="tm-overall">
          <span className="tm-metric">
            <Cpu size={14} /> {cpu ? `${cpu}%` : '0%'}
            <span className="tm-metric-label">app CPU</span>
          </span>
          <span className="tm-metric">
            <MemoryStick size={14} /> {ram ? formatMem(ram) : '—'}
            <span className="tm-metric-label">app memory</span>
          </span>
          <span className="tm-metric">
            <Activity size={14} />
            <span className="tm-metric-label">{tab === 'system' ? 'all processes' : 'app sessions'}</span>
          </span>
        </div>

        <div className="modal-body tm-body">
          {tab === 'tasks' ? <TasksTab /> : <SystemTab />}
        </div>
      </div>
    </div>
  )
}
