import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { FolderOpen, Sparkles, ArrowRight } from 'lucide-react'
import {
  getAgents,
  getAgentDescriptor,
  getAgentLabel,
  getAvailableAgents,
  refreshAgentAvailability
} from '@renderer/lib/agents'

interface Props {
  command: string
  defaultCwd: string
  onOpen: (cwd: string) => void
  /** switch which agent CLI this pane will launch */
  onSelectAgent: (command: string) => void
}

/**
 * Small form shown before an agent launches: pick which agent CLI to run and the
 * folder to open it in (and trust). Prefilled with the last-used folder for
 * one-click reopen.
 */
export default function AgentLauncher({
  command,
  defaultCwd,
  onOpen,
  onSelectAgent
}: Props): JSX.Element {
  const [path, setPath] = useState(defaultCwd)
  const [agents, setAgents] = useState(getAgents())
  const [available, setAvailable] = useState<Set<string>>(getAvailableAgents())
  useEffect(() => {
    void refreshAgentAvailability().then((s) => {
      setAgents([...getAgents()])
      setAvailable(new Set(s))
    })
  }, [])
  const label = getAgentLabel(command)
  const missing = available.size > 0 && !available.has(command)
  const installHint = getAgentDescriptor(command)?.installHint

  // Browsing to a folder is itself the confirmation — open the agent immediately.
  const browse = async (): Promise<void> => {
    const picked = await window.api.pickDirectory(path || undefined)
    if (picked) {
      setPath(picked)
      onOpen(picked)
    }
  }

  // The button is for the typed path / reusing the last folder.
  const open = (): void => {
    const v = path.trim()
    if (v) onOpen(v)
  }

  return (
    <div className="agent-launcher">
      <div className="launcher-card">
        <div className="launcher-head">
          <Sparkles size={16} className="launcher-spark" />
          <span>
            Open <b>{label}</b> in a folder
          </span>
        </div>
        <div className="agent-toggle-row">
          {agents.map((a) => {
            const unavailable = available.size > 0 && !available.has(a.id)
            return (
              <button
                key={a.id}
                type="button"
                className={clsx('agent-toggle', command === a.id && 'active', unavailable && 'unavailable')}
                title={unavailable ? `${a.label} — not installed` : `Use ${a.label}`}
                aria-disabled={unavailable}
                onClick={() => {
                  if (!unavailable) onSelectAgent(a.id)
                }}
              >
                {a.label}
              </button>
            )
          })}
        </div>
        <p className="launcher-hint">
          {missing ? (
            <>
              <b>{label}</b> isn’t on your PATH — install its CLI first, or pick another agent.
              {installHint && (
                <>
                  {' '}
                  <code className="install-hint">{installHint}</code>
                </>
              )}
            </>
          ) : (
            <>{label} will start in this folder and ask to trust it on first run.</>
          )}
        </p>
        <div className="launcher-row">
          <input
            className="input"
            autoFocus
            value={path}
            placeholder="C:\path\to\project"
            spellCheck={false}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && open()}
          />
          <button className="btn" title="Browse…" onClick={browse}>
            <FolderOpen size={14} /> Browse
          </button>
        </div>
        <div className="launcher-actions">
          <button className="btn primary" onClick={open} disabled={!path.trim()}>
            Open {label} <ArrowRight size={14} />
          </button>
          {defaultCwd && (
            <span className="launcher-last">
              <kbd>↵</kbd> reuse last folder
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
