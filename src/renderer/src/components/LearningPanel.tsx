import { useEffect, useState } from 'react'

// The Learning settings panel: controls the local observe → distill → inject
// loop and surfaces the review queue. Self-contained — it reads/writes its own
// config + queues straight through window.api.learning, so it doesn't touch the
// app's main settings store. Follows the project's no-CSS-transitions rule.

interface LearningCfg {
  enabled: boolean
  capture: boolean
  aiOnly: boolean
  egressAllowed: boolean
  autoApprove: boolean
  injectionPassive: boolean
  injectionActive: boolean
  model: 'claude-cli-headless' | 'provider-api' | 'local'
  [k: string]: unknown
}

interface Candidate {
  kind: string
  summary: string
  hash: string
}
interface PendingOp {
  id: string
  op: { kind: string; slug: string; title: string; body: string; confidence: number }
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button className={`toggle${on ? ' on' : ''}`} onClick={onClick} aria-label="toggle">
      <span className="toggle-knob" />
    </button>
  )
}

function Row({
  label,
  desc,
  control
}: {
  label: string
  desc?: string
  control: React.ReactNode
}): JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  )
}

export default function LearningPanel(): JSX.Element {
  const [cfg, setCfg] = useState<LearningCfg | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [pending, setPending] = useState<PendingOp[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const api = window.api.learning

  const refresh = (): void => {
    void api?.getConfig().then((c) => setCfg(c as unknown as LearningCfg))
    void api?.listCandidates().then((c) => setCandidates((c as Candidate[]) ?? []))
    void api?.listPendingOps().then((p) => setPending((p as PendingOp[]) ?? []))
  }

  useEffect(() => {
    refresh()
    const off = api?.onCandidates(() => refresh())
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patch = (p: Partial<LearningCfg>): void => {
    if (!cfg) return
    const next = { ...cfg, ...p }
    setCfg(next)
    void api?.setConfig(p as Record<string, unknown>)
  }

  if (!cfg) return <div className="settings-section" />

  const distill = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = (await api?.distill()) as { ok: boolean; applied?: number; queued?: number; error?: string }
      setMsg(r?.ok ? `Distilled — ${r.applied ?? 0} applied, ${r.queued ?? 0} queued for review.` : r?.error ?? 'Failed')
    } catch (e) {
      setMsg((e as Error).message)
    }
    setBusy(false)
    refresh()
  }

  const approve = async (id: string): Promise<void> => {
    await api?.approveOp(id)
    refresh()
  }
  const reject = async (id: string): Promise<void> => {
    await api?.rejectOp(id)
    refresh()
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Learning</h3>
      <div className="settings-row-desc" style={{ marginBottom: 12 }}>
        URterminal can observe your agent sessions, distill durable memory + skills,
        and feed them back to every agent. All local; opt-in; off by default.
      </div>

      <Row
        label="Enable learning"
        desc="Master switch. Nothing is recorded or injected unless this is on."
        control={<Toggle on={cfg.enabled} onClick={() => patch({ enabled: !cfg.enabled })} />}
      />
      <Row
        label="Record sessions"
        desc="Capture scrubbed transcripts to a local store (no model calls)."
        control={<Toggle on={cfg.capture} onClick={() => patch({ capture: !cfg.capture })} />}
      />
      <Row
        label="AI panes only"
        desc="Skip plain shells/SSH; record only agent panes."
        control={<Toggle on={cfg.aiOnly} onClick={() => patch({ aiOnly: !cfg.aiOnly })} />}
      />

      <h3 className="settings-section-title" style={{ marginTop: 18 }}>
        Distillation
      </h3>
      <Row
        label="Allow distillation (model calls)"
        desc="Separate egress gate. Sends scrubbed transcripts to the chosen model to extract memory/skills."
        control={
          <Toggle on={cfg.egressAllowed} onClick={() => patch({ egressAllowed: !cfg.egressAllowed })} />
        }
      />
      <Row
        label="Model"
        desc="Default uses your authenticated Claude Code CLI — no new API key."
        control={
          <select
            className="select"
            value={cfg.model}
            onChange={(e) => patch({ model: e.target.value as LearningCfg['model'] })}
          >
            <option value="claude-cli-headless">Claude CLI (no new key)</option>
            <option value="provider-api">Provider API key</option>
            <option value="local">Local model</option>
          </select>
        }
      />
      <Row
        label="Auto-approve high-confidence"
        desc="Off = review every learning before it's stored/injected (recommended)."
        control={
          <Toggle on={cfg.autoApprove} onClick={() => patch({ autoApprove: !cfg.autoApprove })} />
        }
      />
      <Row
        label="Run distillation now"
        desc={`${candidates.length} candidate exchange(s) gated and ready.`}
        control={
          <button className="btn btn-primary" disabled={busy || !cfg.egressAllowed} onClick={distill}>
            {busy ? 'Working…' : 'Distill'}
          </button>
        }
      />
      {msg && (
        <div className="settings-row-desc" style={{ marginTop: 6 }}>
          {msg}
        </div>
      )}

      <h3 className="settings-section-title" style={{ marginTop: 18 }}>
        Injection
      </h3>
      <Row
        label="Passive (context files)"
        desc="Write learnings into each agent's native context file (untracked only)."
        control={
          <Toggle
            on={cfg.injectionPassive}
            onClick={() => patch({ injectionPassive: !cfg.injectionPassive })}
          />
        }
      />
      <Row
        label="Active (live session)"
        desc="Type a compact context note into a new agent session. Off by default."
        control={
          <Toggle
            on={cfg.injectionActive}
            onClick={() => patch({ injectionActive: !cfg.injectionActive })}
          />
        }
      />

      {pending.length > 0 && (
        <>
          <h3 className="settings-section-title" style={{ marginTop: 18 }}>
            Review queue ({pending.length})
          </h3>
          {pending.map((p) => (
            <div key={p.id} className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">
                  {p.op.kind}: {p.op.title}
                </div>
                <div className="settings-row-desc">{p.op.body.split('\n')[0].slice(0, 120)}</div>
              </div>
              <div className="settings-row-control" style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary" onClick={() => approve(p.id)}>
                  Approve
                </button>
                <button className="btn" onClick={() => reject(p.id)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      <h3 className="settings-section-title" style={{ marginTop: 18 }}>
        Storage
      </h3>
      <Row
        label="Open learning folder"
        desc="Inspect the local transcripts, memory and skills."
        control={
          <button className="btn" onClick={() => void api?.openStore()}>
            Open folder
          </button>
        }
      />
    </section>
  )
}
