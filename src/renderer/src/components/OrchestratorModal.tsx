import { useEffect, useRef, useState } from 'react'
import { Workflow, Play, Copy, CheckCircle2, RotateCcw } from 'lucide-react'
import { DEFAULT_AGENT } from '@shared/providers'
import { useUi } from '@renderer/store/ui'
import { useOrchestrator } from '@renderer/store/orchestrator'
import { usePaneStatus } from '@renderer/store/paneStatus'
import { getLastAgentCwd, setLastAgentCwd } from '@renderer/lib/agentPrefs'
import { parseSubtasks, runOrchestration, collectReport } from '@renderer/lib/orchestrate'
import { toast } from '@renderer/store/toasts'

/** Live status word for a worker pane. */
function statusOf(paneId: string, status: Record<string, string>, done: Record<string, boolean>): string {
  if (done[paneId]) return 'done'
  const s = status[paneId]
  if (s === 'working') return 'working'
  if (s === 'awaiting') return 'queued'
  return 'idle'
}

/**
 * Orchestrator (#2): enter a goal + one subtask per line, and URterminal spawns
 * a worker agent pane for each, seeding it with the goal + its subtask. Then
 * monitor the workers and collect their answers into one markdown report.
 */
export default function OrchestratorModal(): JSX.Element | null {
  const show = useUi((s) => s.showOrchestrate)
  const setShow = useUi((s) => s.setShowOrchestrate)
  const workers = useOrchestrator((s) => s.workers)
  const status = usePaneStatus((s) => s.status)
  const done = usePaneStatus((s) => s.done)

  const [goal, setGoal] = useState('')
  const [subtasksText, setSubtasksText] = useState('')
  const [cwd, setCwd] = useState('')
  const [command, setCommand] = useState(DEFAULT_AGENT)
  const [autoSend, setAutoSend] = useState(true)
  const [report, setReport] = useState('')
  const goalRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (show) {
      setReport('')
      setCwd((c) => c || getLastAgentCwd())
      requestAnimationFrame(() => goalRef.current?.focus())
    }
  }, [show])

  if (!show) return null

  const running = workers.length > 0
  const subtaskCount = parseSubtasks(subtasksText).length

  const run = (): void => {
    const subtasks = parseSubtasks(subtasksText)
    if (!subtasks.length) {
      toast('Add at least one subtask (one per line).', 'info')
      return
    }
    if (!cwd.trim()) {
      toast('Pick a folder for the workers to run in.', 'info')
      return
    }
    setLastAgentCwd(cwd.trim())
    const n = runOrchestration({
      goal,
      subtasks,
      cwd: cwd.trim(),
      command: command.trim() || DEFAULT_AGENT,
      autoSend
    })
    if (n) toast(`Orchestrating ${n} worker${n > 1 ? 's' : ''}…`, 'ok')
  }

  const collect = (): void => {
    const md = collectReport()
    setReport(md)
    void navigator.clipboard
      .writeText(md)
      .then(() => toast('Report copied to clipboard', 'ok'))
      .catch(() => {})
  }

  const reset = (): void => {
    useOrchestrator.getState().clear()
    setReport('')
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal runcmd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="runcmd-title">
            <Workflow size={16} />
            <span>Orchestrate a goal across agents</span>
            {running && <span className="runcmd-count">{workers.length} workers</span>}
          </div>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>

        <div className="modal-body runcmd-body">
          {!running ? (
            <>
              <textarea
                ref={goalRef}
                className="input"
                rows={2}
                placeholder="Shared goal (optional) — e.g. “Add OAuth login end-to-end.”"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
              <textarea
                className="input mono"
                rows={5}
                placeholder={'One subtask per line — each opens its own agent. e.g.\nDesign the DB schema\nBuild the API routes\nWrite the React form'}
                value={subtasksText}
                onChange={(e) => setSubtasksText(e.target.value)}
              />
              <div className="snippet-add-row">
                <input
                  className="input"
                  placeholder="Folder to run workers in"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                />
                <input
                  className="input"
                  style={{ maxWidth: 120 }}
                  placeholder="agent"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </div>
              <label className="setting-card as-label" style={{ marginTop: 2 }}>
                <span className="setting-card-main">
                  <span className="setting-card-text">
                    <span className="setting-card-title">Send each subtask automatically</span>
                    <span className="setting-card-desc">
                      Off = type it into each worker so you press Enter yourself.
                    </span>
                  </span>
                </span>
                <span className="setting-card-control">
                  <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
                </span>
              </label>
              <div className="runcmd-actions">
                <button className="btn" onClick={() => setShow(false)}>
                  Cancel
                </button>
                <button className="btn primary" onClick={run} disabled={!subtaskCount || !cwd.trim()}>
                  <Play size={13} /> Run {subtaskCount || ''} {subtaskCount === 1 ? 'worker' : 'workers'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="orch-workers">
                {workers.map((w, i) => {
                  const st = statusOf(w.paneId, status, done)
                  return (
                    <div className="orch-worker" key={w.paneId}>
                      <span className={`orch-status orch-${st}`}>{st}</span>
                      <span className="orch-worker-task">
                        {i + 1}. {w.subtask}
                      </span>
                    </div>
                  )
                })}
              </div>
              {report && <pre className="snippet-preview orch-report">{report}</pre>}
              <div className="runcmd-actions">
                <button className="btn" onClick={reset}>
                  <RotateCcw size={13} /> New
                </button>
                <button className="btn primary" onClick={collect}>
                  {report ? <Copy size={13} /> : <CheckCircle2 size={13} />} Collect report
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
