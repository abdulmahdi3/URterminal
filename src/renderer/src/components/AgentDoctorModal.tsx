import { useEffect, useState } from 'react'
import {
  Stethoscope,
  CheckCircle2,
  XCircle,
  Download,
  RefreshCw,
  RotateCw,
  Loader2
} from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { getAgents, refreshAgentAvailability } from '@renderer/lib/agents'
import { toast } from '@renderer/store/toasts'
import type { AgentDescriptor } from '@shared/providers'

/** The runnable install command from a hint (drop any "(or: …)" alternative). */
function installCommand(hint: string): string {
  return hint.split('(or:')[0].trim()
}

/**
 * Agent doctor: a one-glance checklist of every known agent CLI and whether it's
 * installed on PATH. Missing agents get a one-click Install button that runs the
 * install command, notifies on success, and — if PATH hasn't refreshed yet —
 * offers to relaunch the app. Auto-opens once on first run when nothing's found;
 * also reachable from the command palette ("Check agent setup").
 */
export default function AgentDoctorModal(): JSX.Element | null {
  const show = useUi((s) => s.showAgentDoctor)
  const setShow = useUi((s) => s.setShowAgentDoctor)
  const [agents, setAgents] = useState<AgentDescriptor[]>([])
  const [available, setAvailable] = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  /** agents that installed OK but aren't on PATH yet → need an app relaunch */
  const [needRelaunch, setNeedRelaunch] = useState<Set<string>>(new Set())

  const probe = (): Promise<Set<string>> =>
    refreshAgentAvailability().then((avail) => {
      const set = new Set(avail)
      setAvailable(set)
      setAgents(getAgents())
      return set
    })

  const recheck = (): void => {
    setChecking(true)
    void probe().finally(() => setChecking(false))
  }

  // Re-probe whenever the doctor opens so the status is fresh.
  useEffect(() => {
    if (show) recheck()
  }, [show])

  if (!show) return null

  const installedCount = agents.filter((a) => available.has(a.id)).length

  const mutate = (
    setter: typeof setInstalling,
    id: string,
    add: boolean
  ): void => {
    setter((prev) => {
      const next = new Set(prev)
      if (add) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const install = (a: AgentDescriptor): void => {
    if (!a.installHint) return
    const cmd = installCommand(a.installHint)
    mutate(setInstalling, a.id, true)
    void window.api
      .installAgent(cmd)
      .then(async (res) => {
        if (!res.ok) {
          toast(`Couldn't install ${a.label}: ${res.error ?? 'failed'}`, 'error')
          return
        }
        const avail = await probe()
        if (avail.has(a.id)) {
          toast(`${a.label} installed`, 'ok')
        } else {
          // Installed but not yet visible on this process's PATH.
          mutate(setNeedRelaunch, a.id, true)
          toast(`${a.label} installed — relaunch to start using it`, 'ok')
        }
      })
      .catch((e: Error) => toast(`Couldn't install ${a.label}: ${e.message}`, 'error'))
      .finally(() => mutate(setInstalling, a.id, false))
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal doctor" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="doctor-title">
            <Stethoscope size={16} />
            <span>Agent setup</span>
            <span className="doctor-count">
              {installedCount}/{agents.length} installed
            </span>
          </div>
          <div className="doctor-head-actions">
            <button className="btn" onClick={recheck} disabled={checking}>
              {checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Re-check
            </button>
            <button className="icon-btn" onClick={() => setShow(false)}>
              ✕
            </button>
          </div>
        </div>

        <div className="modal-body doctor-body">
          {installedCount === 0 && (
            <div className="doctor-hint">
              No agent CLIs found on your PATH. Install one below — then open it with{' '}
              <kbd>Ctrl</kbd>+<kbd>T</kbd>.
            </div>
          )}
          {agents.map((a) => {
            const ok = available.has(a.id)
            const busy = installing.has(a.id)
            const relaunch = needRelaunch.has(a.id)
            return (
              <div className={'doctor-row' + (ok ? ' ok' : '')} key={a.id}>
                <span className="doctor-status">
                  {ok ? (
                    <CheckCircle2 size={17} className="doctor-ok" />
                  ) : (
                    <XCircle size={17} className="doctor-missing" />
                  )}
                </span>
                <span className="doctor-name">
                  {a.label}
                  <span className="doctor-bin">{a.bin ?? a.id}</span>
                </span>
                {ok ? (
                  <span className="doctor-installed">Installed</span>
                ) : relaunch ? (
                  <button className="btn primary doctor-action" onClick={() => window.api.relaunchApp()}>
                    <RotateCw size={13} /> Relaunch app
                  </button>
                ) : a.installHint ? (
                  <button
                    className="btn doctor-action"
                    onClick={() => install(a)}
                    disabled={busy}
                    title={installCommand(a.installHint)}
                  >
                    {busy ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                    {busy ? 'Installing…' : 'Install'}
                  </button>
                ) : (
                  <span className="doctor-installed missing">Not installed</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
