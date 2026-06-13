import { useEffect, useState } from 'react'
import { Clock, Bot, GitBranch } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useMetrics } from '@renderer/store/metrics'
import { useTokens } from '@renderer/store/tokens'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { usePaneStatus } from '@renderer/store/paneStatus'
import { useGitStatus } from '@renderer/hooks/useGitStatus'
import NotificationBell from './NotificationBell'
import LearningStatus from './LearningStatus'

function formatChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

/** MB below 1000, GB above. */
function formatMem(mb: number): string {
  return mb >= 1000 ? `${(mb / 1024).toFixed(2)} GB` : `${mb} MB`
}

export default function StatusBar(): JSX.Element {
  const panes = useWorkspace((s) => s.panes)

  const statusMap = usePaneStatus((s) => s.status)
  const aiPaneIds = Object.keys(panes).filter((id) => panes[id]?.type === 'ai')
  const agentsWorking = aiPaneIds.filter((id) => statusMap[id] === 'working').length
  const streaming = agentsWorking > 0

  const ram = useMetrics((s) => s.ramMB)
  const cpu = useMetrics((s) => s.cpuPercent)
  const tok = useMetrics((s) => s.tokPerSec)
  const totalTokens = useTokens((s) => s.total)
  const budget = useSettings((s) => s.settings?.prefs.sessionTokenBudget ?? 0)
  const budgetPct = budget > 0 ? Math.min(999, Math.round((totalTokens / budget) * 100)) : 0
  const budgetLevel = budgetPct >= 100 ? 'over' : budgetPct >= 80 ? 'warn' : 'ok'
  const git = useGitStatus()
  const gitChanges = git ? git.staged + git.unstaged + git.untracked : 0

  const toggleTaskManager = useUi((s) => s.toggleTaskManager)
  const openSettings = useUi((s) => s.openSettings)

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

  // Real app version (from package.json via the main process), not a hardcoded string.
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.api.getAppInfo().then((i) => setVersion(i.version)).catch(() => {})
  }, [])

  return (
    <footer className="statusbar">
      {/* Always-visible working count */}
      <span className={clsx('sb-item', streaming && 'accent')}>
        <span className={clsx('sb-dot', streaming && 'live', streaming && 'streaming')} />
        {agentsWorking} working
      </span>

      {/* Git status for the active pane's folder */}
      {git && (
        <span
          className={clsx('sb-item sb-git', git.dirty && 'dirty')}
          title={
            `${git.branch}` +
            (git.dirty ? ` · ${gitChanges} change${gitChanges === 1 ? '' : 's'}` : ' · clean') +
            (git.ahead ? ` · ↑${git.ahead}` : '') +
            (git.behind ? ` · ↓${git.behind}` : '')
          }
        >
          <GitBranch size={12} />
          <span className="sb-git-branch">{git.branch}</span>
          {git.dirty && <span className="sb-git-dirty">●{gitChanges}</span>}
          {git.ahead > 0 && <span className="sb-git-ab">↑{git.ahead}</span>}
          {git.behind > 0 && <span className="sb-git-ab">↓{git.behind}</span>}
        </span>
      )}

      <span className="sb-spacer" />

      {/* Hermes learning: pending-review indicator (only when learning is on) */}
      <LearningStatus />

      {/* Combined CPU + RAM button → opens the task manager */}
      <button
        className="sb-item sb-resource-btn"
        onClick={toggleTaskManager}
        title="Open task manager"
      >
        <span className="sb-res-label">cpu</span> {cpu ? `${cpu}%` : '0%'}
        <span className="sb-resource-sep">·</span>
        <span className="sb-res-label">ram</span> {ram ? formatMem(ram) : '—'}
      </button>

      {/* Claude session output (raw terminal chars, not API tokens) */}
      <span className="sb-item sb-claude" title="output tokens">
        <Bot size={12} />
        <span>{formatChars(totalTokens * 4)}</span>
      </span>

      {/* Session token budget meter (only when a budget is set) */}
      {budget > 0 && (
        <button
          className={clsx('sb-item sb-budget', budgetLevel)}
          title={`Session token budget: ${formatChars(totalTokens)} / ${formatChars(budget)} (${budgetPct}%) — click to change`}
          onClick={() => openSettings('behavior')}
        >
          <span className="sb-budget-bar">
            <span className="sb-budget-fill" style={{ width: `${Math.min(100, budgetPct)}%` }} />
          </span>
          {budgetPct}%
        </button>
      )}

      <NotificationBell />

      <span className="sb-item">
        <Clock size={12} /> {clock}
      </span>
      <span className="sb-item dim">{version ? `v${version}` : ''}</span>
    </footer>
  )
}
