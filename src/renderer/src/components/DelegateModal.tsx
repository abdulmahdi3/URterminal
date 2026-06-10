import { useEffect, useRef, useState } from 'react'
import { GitFork, CornerDownLeft } from 'lucide-react'
import { DEFAULT_AGENT } from '@shared/providers'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { seedPrompt } from '@renderer/lib/terminalPool'
import { toast } from '@renderer/store/toasts'

/**
 * Delegate a subtask to a fresh sibling agent pane: spawns a new agent (same CLI
 * + folder as the active pane) and types the task in once it boots, so you can
 * run a parallel workstream. The task is typed (not auto-sent) so you review it.
 */
export default function DelegateModal(): JSX.Element | null {
  const show = useUi((s) => s.showDelegate)
  const setShow = useUi((s) => s.setShowDelegate)
  const addPane = useWorkspace((s) => s.addPane)
  const updatePane = useWorkspace((s) => s.updatePane)
  const activeId = useWorkspace((s) => s.activePaneId)
  const pane = useWorkspace((s) => (activeId ? s.panes[activeId] : undefined))
  const [task, setTask] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (show) {
      setTask('')
      requestAnimationFrame(() => ref.current?.focus())
    }
  }, [show])

  if (!show) return null

  const agent = pane?.type === 'ai' ? pane.agent?.command ?? DEFAULT_AGENT : DEFAULT_AGENT
  const cwd = pane?.type === 'ai' ? pane.agent?.cwd : pane?.shell?.cwd

  const delegate = (): void => {
    const t = task.trim()
    if (!t) return
    if (!cwd) {
      toast('The active pane has no folder to delegate in.', 'info')
      return
    }
    const id = addPane('ai', 'row', { agentCommand: agent, agentCwd: cwd, label: 'subagent' })
    if (!id) {
      toast('Max panes reached.', 'info')
      return
    }
    updatePane(id, { agent: { command: agent, cwd }, title: 'subagent' })
    seedPrompt(id, t)
    setShow(false)
    toast('Subagent opening — your task will appear once it boots.', 'ok')
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal runcmd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="runcmd-title">
            <GitFork size={16} />
            <span>Delegate to a subagent</span>
            <span className="runcmd-count">{agent}</span>
          </div>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>
        <div className="modal-body runcmd-body">
          <textarea
            ref={ref}
            className="input"
            rows={4}
            placeholder="Describe the subtask — a new agent opens in this folder and gets it. e.g. “Write tests for src/auth and run them.”"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                delegate()
              }
            }}
          />
          <div className="runcmd-actions">
            <button className="btn" onClick={() => setShow(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={delegate} disabled={!task.trim()}>
              <CornerDownLeft size={13} /> Delegate
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
