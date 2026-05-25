import { useEffect, useState } from 'react'
import { Clock, RotateCcw } from 'lucide-react'
import { AGENTS, AGENT_LABELS } from '@shared/providers'
import { useWorkspace } from '@renderer/store/workspace'
import { useSessions } from '@renderer/store/sessions'
import { getShellSpecs, refreshWslDistros, type ShellSpec } from '@renderer/lib/shells'
import { getAvailableAgents, refreshAgentAvailability } from '@renderer/lib/agents'
import { AgentLogo, ShellLogo } from './brandIcons'

export default function EmptyPane({ paneId }: { paneId: string }): JSX.Element {
  const setPaneType = useWorkspace((s) => s.setPaneType)
  const reopenClosed = useWorkspace((s) => s.reopenClosed)
  const canReopen = useWorkspace((s) => s.recentlyClosed.length > 0)
  const sessions = useSessions((s) => s.sessions)
  const restore = useSessions((s) => s.restore)
  const lastSession = sessions[0]

  const [shells, setShells] = useState<ShellSpec[]>(getShellSpecs())
  const [available, setAvailable] = useState<Set<string>>(getAvailableAgents())
  useEffect(() => {
    void refreshWslDistros().then(() => setShells(getShellSpecs()))
    void refreshAgentAvailability().then((s) => setAvailable(new Set(s)))
  }, [])

  // Installed agents (fall back to all before detection finishes).
  const agentList = available.size ? AGENTS.filter((a) => available.has(a)) : [...AGENTS]

  return (
    <div className="empty-pane">
      <div className="empty-launcher">
        <div className="empty-launcher-title">What do you want to open?</div>

        <section className="empty-group">
          <div className="empty-group-title">Agents</div>
          <div className="empty-grid">
            {agentList.map((a) => (
              <button
                key={a}
                className="empty-card"
                onClick={() => setPaneType(paneId, 'ai', { agentCommand: a, label: AGENT_LABELS[a] })}
              >
                <AgentLogo command={a} size={20} />
                <span className="empty-card-label">{AGENT_LABELS[a]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="empty-group">
          <div className="empty-group-title">Shells</div>
          <div className="empty-grid">
            {shells.map((spec) => (
              <button
                key={spec.id}
                className="empty-card"
                title={spec.label}
                onClick={() =>
                  setPaneType(paneId, 'shell', {
                    shell: spec.file,
                    shellArgs: spec.args,
                    label: spec.label
                  })
                }
              >
                <ShellLogo shell={spec.file} args={spec.args} size={20} />
                <span className="empty-card-label">{spec.label}</span>
              </button>
            ))}
          </div>
        </section>

        {(lastSession || canReopen) && (
          <div className="empty-resume">
            {lastSession && (
              <button
                className="empty-resume-btn"
                title={`Restore "${lastSession.name}" (${lastSession.paneCount} pane${lastSession.paneCount !== 1 ? 's' : ''})`}
                onClick={() => restore(lastSession.id)}
              >
                <Clock size={13} />
                Open last session · {lastSession.name}
              </button>
            )}
            {canReopen && (
              <button className="empty-resume-btn" onClick={() => reopenClosed()}>
                <RotateCcw size={13} />
                Reopen closed pane
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
