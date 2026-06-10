import { useEffect, useState } from 'react'
import { Pin, PinOff, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import type { ProviderId } from '@shared/types'
import { DEFAULT_MODELS, latestModel } from '@shared/providers'
import { toast } from '@renderer/store/toasts'

// The Learning settings panel: controls the local observe → distill → inject
// loop, the prompt enhancer, and the shared AI provider. Self-contained — it
// reads/writes its own config + queues straight through window.api.learning, so
// it doesn't touch the app's main settings store. Follows the project's
// purposeful-animation rule (collapsing groups toggle instantly).

type LearnProvider = 'claude-cli' | 'gemini' | 'openai' | 'anthropic' | 'openrouter'

interface LearningCfg {
  enabled: boolean
  capture: boolean
  aiOnly: boolean
  egressAllowed: boolean
  autoApprove: boolean
  autoDistill: boolean
  injectionPassive: boolean
  injectionActive: boolean
  provider: LearnProvider
  providerModel: string
  apiKeys: { gemini: string; openai: string; anthropic: string; openrouter: string }
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

/** Provider metadata for the AI-provider selector (label + key requirement). */
const PROVIDERS: Array<{
  id: LearnProvider
  label: string
  needsKey: boolean
  keyHint?: string
  keyHelp?: string
}> = [
  { id: 'claude-cli', label: 'Claude CLI — reuse my login (no key)', needsKey: false },
  {
    id: 'openrouter',
    label: 'OpenRouter — one key, 200+ models',
    needsKey: true,
    keyHint: 'sk-or-…',
    keyHelp: 'One key for 200+ models — openrouter.ai/keys'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    needsKey: true,
    keyHint: 'AIza…',
    keyHelp: 'Free key from Google AI Studio — aistudio.google.com/apikey'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    needsKey: true,
    keyHint: 'sk-…',
    keyHelp: 'Key from platform.openai.com/api-keys'
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    needsKey: true,
    keyHint: 'sk-ant-…',
    keyHelp: 'Key from console.anthropic.com/settings/keys'
  }
]

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
    <div className="learn-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  )
}

/** A titled section; advanced ones start collapsed to keep the tab uncluttered. */
function Group({
  title,
  hint,
  defaultOpen = true,
  children
}: {
  title: string
  hint?: string
  defaultOpen?: boolean
  children: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="learn-group">
      <button
        className="learn-group-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="learn-group-caret">{open ? '▾' : '▸'}</span>
        <span className="settings-section-title" style={{ margin: 0 }}>
          {title}
        </span>
      </button>
      {open && (
        <div className="learn-group-body">
          {hint && (
            <div className="settings-row-desc" style={{ marginBottom: 12 }}>
              {hint}
            </div>
          )}
          {children}
        </div>
      )}
    </section>
  )
}

export default function LearningPanel(): JSX.Element {
  const [cfg, setCfg] = useState<LearningCfg | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [pending, setPending] = useState<PendingOp[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [brain, setBrain] = useState<{
    memories: { title: string; body: string; scope: string; slug: string; scopeKey: string; confidence: number }[]
    skills: {
      name: string; description: string; scope: string; slug: string; scopeKey: string; pinned: boolean; archived: boolean
    }[]
  } | null>(null)
  const [brainOpen, setBrainOpen] = useState(false)
  const [skillUrl, setSkillUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [userDoc, setUserDoc] = useState('')
  const [personaDoc, setPersonaDoc] = useState('')

  const api = window.api.learning

  const refresh = (): void => {
    void api?.getConfig().then((c) => setCfg(c as unknown as LearningCfg))
    void api?.listCandidates().then((c) => setCandidates((c as Candidate[]) ?? []))
    void api?.listPendingOps().then((p) => setPending((p as PendingOp[]) ?? []))
  }

  useEffect(() => {
    refresh()
    void api?.getProfile?.('user').then((t) => setUserDoc(t ?? ''))
    void api?.getProfile?.('persona').then((t) => setPersonaDoc(t ?? ''))
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

  if (!cfg) return <></>

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

  // ---- automatic mode (one switch = record + distill + apply, no manual click) ----
  const isAuto = !!cfg.autoDistill && !!cfg.autoApprove && !!cfg.egressAllowed
  const setAuto = (on: boolean): void => {
    if (on) patch({ enabled: true, capture: true, egressAllowed: true, autoDistill: true, autoApprove: true })
    else patch({ autoDistill: false, autoApprove: false })
  }

  // ---- "what URterminal has learned about you" viewer ----
  const loadBrain = (): void => {
    void api?.viewBrain?.().then((b) => setBrain(b))
  }
  const showBrain = (): void => {
    setBrainOpen(true)
    loadBrain()
  }
  const skillAct = async (
    action: 'pin' | 'unpin' | 'archive' | 'unarchive' | 'delete',
    scopeKey: string,
    slug: string
  ): Promise<void> => {
    await api?.skillAction?.(action, scopeKey, slug)
    loadBrain()
  }
  const delMemory = async (scopeKey: string, slug: string): Promise<void> => {
    await api?.deleteMemory?.(scopeKey, slug)
    loadBrain()
  }
  const tidySkills = async (): Promise<void> => {
    const r = await api?.tidySkills?.()
    toast(
      r ? `Tidied — archived ${r.archived} stale skill${r.archived === 1 ? '' : 's'}.` : 'Tidy failed',
      'ok'
    )
    loadBrain()
  }
  const installSkill = async (): Promise<void> => {
    const url = skillUrl.trim()
    if (!url || installing) return
    setInstalling(true)
    try {
      const r = await api?.installSkill?.(url)
      if (r?.ok) {
        toast(`Installed skill: ${r.name}`, 'ok')
        setSkillUrl('')
        setBrainOpen(true)
        loadBrain()
      } else {
        toast(r?.error ?? 'Install failed', 'error')
      }
    } finally {
      setInstalling(false)
    }
  }

  // ---- AI provider helpers ----
  type KeyProv = 'gemini' | 'openai' | 'anthropic' | 'openrouter'
  const meta = PROVIDERS.find((p) => p.id === cfg.provider) ?? PROVIDERS[0]
  const isApi = cfg.provider !== 'claude-cli'
  // OpenRouter has 200+ models → free-text id; the others use a fixed model list.
  const isOpenRouter = cfg.provider === 'openrouter'
  const baseModels = isApi && !isOpenRouter ? DEFAULT_MODELS[cfg.provider as ProviderId] : []
  // Keep a saved/custom model id (e.g. migrated from an older default) selectable.
  const models =
    cfg.providerModel && !baseModels.includes(cfg.providerModel)
      ? [cfg.providerModel, ...baseModels]
      : baseModels

  const onProvider = (id: LearnProvider): void => {
    if (id === 'claude-cli') {
      patch({ provider: id })
      return
    }
    if (id === 'openrouter') {
      patch({ provider: id, providerModel: cfg.providerModel || 'openai/gpt-4o-mini' })
      return
    }
    const list = DEFAULT_MODELS[id as ProviderId]
    const model = list.includes(cfg.providerModel) ? cfg.providerModel : latestModel(id as ProviderId)
    patch({ provider: id, providerModel: model })
  }

  const setKey = (id: KeyProv, value: string): void =>
    patch({ apiKeys: { ...cfg.apiKeys, [id]: value } })

  return (
    <>
      <div className="settings-row-desc" style={{ marginBottom: 4 }}>
        URterminal can observe your agent sessions, distill durable memory + skills,
        and feed them back to every agent. All local; opt-in; off by default.
      </div>

      <Group title="Learning">
        <Row
          label="Enable learning"
          desc="Master switch. Nothing is recorded or injected unless this is on."
          control={<Toggle on={cfg.enabled} onClick={() => patch({ enabled: !cfg.enabled })} />}
        />
        <Row
          label="Automatic"
          desc="Record, distil into memory, and feed it back to your agents on its own — no manual review. Distillation uses the AI provider below."
          control={<Toggle on={isAuto} onClick={() => setAuto(!isAuto)} />}
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
      </Group>

      <Group title="Your profile & persona" defaultOpen={false}>
        <div className="settings-row-desc" style={{ marginBottom: 10 }}>
          Injected into every agent you launch (when learning + injection are on). The persona
          shapes how agents behave; the profile lists durable facts about you.
        </div>
        <div className="learn-doc">
          <div className="settings-row-label">About you — facts (USER.md)</div>
          <textarea
            className="input mono"
            rows={4}
            placeholder="e.g. I use pnpm, never npm. Stack: React + Electron + TypeScript. Prefer terse answers, no preamble."
            value={userDoc}
            onChange={(e) => setUserDoc(e.target.value)}
            onBlur={() => void api?.setProfile?.('user', userDoc)}
          />
        </div>
        <div className="learn-doc">
          <div className="settings-row-label">Persona — how agents should act (SOUL.md)</div>
          <textarea
            className="input mono"
            rows={4}
            placeholder="e.g. Be direct and concise. Challenge weak ideas. Explain trade-offs, then recommend one."
            value={personaDoc}
            onChange={(e) => setPersonaDoc(e.target.value)}
            onBlur={() => void api?.setProfile?.('persona', personaDoc)}
          />
        </div>
      </Group>

      <Group title="What URterminal has learned about you" defaultOpen={false}>
        <Row
          label="Your learning profile"
          desc="Every memory + skill distilled across your projects. Pin to protect, archive to hide from agents, or delete."
          control={
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" onClick={tidySkills} title="Archive stale, unpinned skills">
                Tidy
              </button>
              <button className="btn" onClick={showBrain}>
                {brainOpen ? 'Refresh' : 'Show'}
              </button>
            </div>
          }
        />
        <div className="learn-doc" style={{ marginTop: 10 }}>
          <div className="settings-row-label">Install a skill (agentskills.io / GitHub)</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="input mono"
              placeholder="https://raw.githubusercontent.com/…/SKILL.md"
              value={skillUrl}
              onChange={(e) => setSkillUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void installSkill()
              }}
              style={{ flex: 1 }}
            />
            <button className="btn primary" onClick={installSkill} disabled={!skillUrl.trim() || installing}>
              {installing ? 'Installing…' : 'Install'}
            </button>
          </div>
        </div>
        {brainOpen && brain && (
          <div className="learn-brain">
            {brain.memories.length === 0 && brain.skills.length === 0 && (
              <div className="settings-row-desc">
                Nothing learned yet — it fills in as you use agents with learning on.
              </div>
            )}
            {brain.skills.map((s, i) => (
              <div className={'learn-brain-item' + (s.archived ? ' archived' : '')} key={`s${i}`}>
                <div className="learn-brain-head">
                  <span className="learn-brain-title">
                    🛠 {s.name}
                    {s.pinned && <Pin size={11} className="brain-pin" />}
                    {s.archived && <span className="brain-tag">archived</span>}
                  </span>
                  <span className="brain-actions">
                    <button
                      className="icon-btn"
                      title={s.pinned ? 'Unpin' : 'Pin (protect from tidy)'}
                      onClick={() => skillAct(s.pinned ? 'unpin' : 'pin', s.scopeKey, s.slug)}
                    >
                      {s.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                    <button
                      className="icon-btn"
                      title={s.archived ? 'Restore' : 'Archive (hide from agents)'}
                      onClick={() => skillAct(s.archived ? 'unarchive' : 'archive', s.scopeKey, s.slug)}
                    >
                      {s.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Delete skill"
                      onClick={() => skillAct('delete', s.scopeKey, s.slug)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                {s.description && <div className="learn-brain-body">{s.description}</div>}
              </div>
            ))}
            {brain.memories.map((m, i) => (
              <div className="learn-brain-item" key={`m${i}`}>
                <div className="learn-brain-head">
                  <span className="learn-brain-title">{m.title}</span>
                  <span className="brain-actions">
                    <span className="learn-brain-scope">{m.scope}</span>
                    <button
                      className="icon-btn danger"
                      title="Delete memory"
                      onClick={() => delMemory(m.scopeKey, m.slug)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                <div className="learn-brain-body">{m.body}</div>
              </div>
            ))}
          </div>
        )}
      </Group>

      <Group
        title="AI provider"
        hint="Powers the prompt enhancer (rewrites your typed request using your learned memory) and distillation. Claude CLI reuses your Claude login at no extra cost; the others call the provider's API with your key."
      >
        <Row
          label="Provider"
          desc="Which AI service runs the learning model calls."
          control={
            <select
              className="select"
              value={cfg.provider}
              onChange={(e) => onProvider(e.target.value as LearnProvider)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          }
        />
        {isApi && isOpenRouter && (
          <Row
            label="Model"
            desc="Any OpenRouter model id — e.g. anthropic/claude-3.5-sonnet, openai/gpt-4o-mini."
            control={
              <input
                className="input mono"
                placeholder="openai/gpt-4o-mini"
                value={cfg.providerModel || ''}
                onChange={(e) => patch({ providerModel: e.target.value })}
                style={{ width: 240 }}
              />
            }
          />
        )}
        {isApi && !isOpenRouter && (
          <Row
            label="Model"
            desc="The model used for this provider."
            control={
              <select
                className="select"
                value={cfg.providerModel || ''}
                onChange={(e) => patch({ providerModel: e.target.value })}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            }
          />
        )}
        {isApi && meta.needsKey && (
          <Row
            label={`${meta.label} API key`}
            desc={meta.keyHelp}
            control={
              <input
                className="input"
                type="password"
                placeholder={meta.keyHint}
                value={cfg.apiKeys[cfg.provider as KeyProv] ?? ''}
                onChange={(e) => setKey(cfg.provider as KeyProv, e.target.value)}
                style={{ width: 240 }}
              />
            }
          />
        )}
        {!isApi && (
          <div className="settings-row-desc">
            No API key needed — the enhancer spawns your authenticated Claude Code CLI.
          </div>
        )}
      </Group>

      <Group
        title="Distillation"
        defaultOpen={false}
        hint="Turns recorded sessions into durable memory + skills by sending scrubbed transcripts to the AI provider above. Egress is off by default."
      >
        <Row
          label="Allow distillation (model calls)"
          desc="Separate egress gate. Sends scrubbed transcripts to the chosen provider to extract memory/skills."
          control={
            <Toggle on={cfg.egressAllowed} onClick={() => patch({ egressAllowed: !cfg.egressAllowed })} />
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
      </Group>

      <Group
        title="Injection"
        defaultOpen={false}
        hint="How learned memory is fed back to your agents."
      >
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
      </Group>

      {pending.length > 0 && (
        <Group title={`Review queue (${pending.length})`}>
          {pending.map((p) => (
            <div key={p.id} className="learn-row">
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
        </Group>
      )}

      <Group title="Storage" defaultOpen={false}>
        <Row
          label="Open learning folder"
          desc="Inspect the local transcripts, memory and skills."
          control={
            <button className="btn" onClick={() => void api?.openStore()}>
              Open folder
            </button>
          }
        />
      </Group>
    </>
  )
}
