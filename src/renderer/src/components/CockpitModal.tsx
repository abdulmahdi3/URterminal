import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { useUregant, UREGANT_DEFAULT_MODEL } from '../store/uregant'
import type { UrPlan, UrGateResult } from '@shared/uregant'
import { useUregantPulls } from '../store/uregantPulls'
import { getEnabled, toggleEnabled } from '../lib/uregantEnabled'
import { getEvalScores, setEvalScore } from '../lib/uregantEval'
import type { OrModelInfo } from '@shared/types'
import {
  UREGANT_CATALOG,
  UREGANT_CLOUD_CATALOG,
  fitBadge,
  FIT_LABEL,
  FIT_RANK,
  type HardwareInfo,
  type UrToolQuality
} from '@shared/uregantModels'
import { DEFAULT_MODELS } from '@shared/providers'
import { UREGANT_CREW } from '@shared/uregantCrew'
import { getAutoCrew, setAutoCrew } from '../lib/uregantAutoCrew'
import '../styles/cockpit.css'

/**
 * Uregant Cockpit (Phase 2) — the orchestrator surface from OC1–OC5.
 * Built: Mission Control (live agents) + Registry · Models (local catalog with
 * VRAM badges + streamed install, cloud providers, enable toggles). Route / Cost /
 * Handoffs are placeholders for later phases.
 */
type CockpitTab = 'mission' | 'route' | 'registry' | 'cost' | 'handoffs'

const TABS: { id: CockpitTab; label: string; ready?: boolean }[] = [
  { id: 'mission', label: 'Mission control', ready: true },
  { id: 'route', label: 'Route', ready: true },
  { id: 'registry', label: 'Registry', ready: true },
  { id: 'cost', label: 'Cost' },
  { id: 'handoffs', label: 'Handoffs', ready: true }
]

export default function CockpitModal(): JSX.Element | null {
  const show = useUi((s) => s.showCockpit)
  const setShow = useUi((s) => s.setShowCockpit)
  const [tab, setTab] = useState<CockpitTab>('registry')

  if (!show) return null

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal cockpit" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header cockpit-head">
          <div className="cockpit-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={clsx('cockpit-tab', tab === t.id && 'active')}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {!t.ready && <span className="cockpit-soon">soon</span>}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>
        {tab === 'registry' ? (
          <RegistryView />
        ) : tab === 'mission' ? (
          <MissionView />
        ) : tab === 'handoffs' ? (
          <HandoffsView />
        ) : tab === 'route' ? (
          <RouteView />
        ) : (
          <ComingSoon tab={tab} />
        )}
      </div>
    </div>
  )
}

function ComingSoon({ tab }: { tab: CockpitTab }): JSX.Element {
  const labels: Record<CockpitTab, string> = {
    mission: 'Mission Control',
    route: 'Route',
    registry: 'Registry',
    cost: 'Cost & usage',
    handoffs: 'Handoffs'
  }
  return <div className="cockpit-soon-panel">{labels[tab]} — coming in a later phase.</div>
}

// ---------- Mission Control ----------

function MissionView(): JSX.Element {
  const setShow = useUi((s) => s.setShowCockpit)
  const setActive = useWorkspace((s) => s.setActive)
  const panes = useWorkspace((s) => s.panes)
  const byPane = useUregant((s) => s.byPane)

  const agents = Object.values(panes).filter((p) => p.type === 'uregant')
  const working = agents.filter((p) => byPane[p.id]?.streaming).length
  const focus = (id: string): void => {
    setActive(id)
    setShow(false)
  }

  return (
    <div className="cockpit-body ck-mission">
      <div className="ck-tiles">
        <Tile value={String(Object.keys(panes).length)} label="Panes" />
        <Tile value={String(agents.length)} label="Uregant agents" />
        <Tile value={String(working)} label="Working now" />
      </div>
      <h3 className="ck-cloud-title">Agents</h3>
      {agents.length === 0 && (
        <p className="settings-empty">No Uregant agents yet — open an Orchestrator pane.</p>
      )}
      <div className="ck-models">
        {agents.map((p) => {
          const r = byPane[p.id]
          const status = r?.error ? 'error' : r?.pending ? 'awaiting' : r?.streaming ? 'working' : 'idle'
          const last =
            [...(r?.messages ?? [])].reverse().find((m) => m.role === 'assistant')?.content ||
            r?.streamingText ||
            ''
          return (
            <div key={p.id} className="ck-model">
              <div className="ck-model-main">
                <div className="ck-model-name">
                  {p.title}
                  <span className="ck-tag">{r?.model ?? '—'}</span>
                  <span className={clsx('ck-tag', `ck-status-${status}`)}>{status}</span>
                </div>
                <div className="ck-model-note">{last ? last.slice(0, 120) : 'no activity yet'}</div>
              </div>
              <div className="ck-model-side">
                <button className="btn" onClick={() => focus(p.id)}>
                  Focus
                </button>
                {r?.streaming && (
                  <button className="btn" onClick={() => useUregant.getState().stop(p.id)}>
                    Stop
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Tile({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div className="ck-tile">
      <div className="ck-tile-val">{value}</div>
      <div className="ck-tile-label">{label}</div>
    </div>
  )
}

// ---------- Registry ----------

type RegistrySection = 'models' | 'agents' | 'mcp' | 'memory' | 'secrets'

function RegistryView(): JSX.Element {
  const [section, setSection] = useState<RegistrySection>('models')
  const SECTIONS: { id: RegistrySection; label: string; ready?: boolean }[] = [
    { id: 'models', label: 'Models', ready: true },
    { id: 'agents', label: 'Agents', ready: true },
    { id: 'mcp', label: 'MCP servers' },
    { id: 'memory', label: 'Memory' },
    { id: 'secrets', label: 'Secrets vault' }
  ]
  return (
    <div className="settings-layout">
      <aside className="settings-nav">
        <nav className="settings-nav-list">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={clsx('settings-nav-item', section === s.id && 'active', !s.ready && 'dim')}
              onClick={() => s.ready && setSection(s.id)}
            >
              {s.label}
              {!s.ready && <span className="cockpit-soon">soon</span>}
            </button>
          ))}
        </nav>
      </aside>
      <div className="settings-content">
        {section === 'models' ? (
          <ModelsSection />
        ) : section === 'agents' ? (
          <AgentsSection />
        ) : (
          <p className="settings-empty">Coming in a later phase.</p>
        )}
      </div>
    </div>
  )
}

function ModelsSection(): JSX.Element {
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState<Set<string>>(() => getEnabled())
  const [orModels, setOrModels] = useState<OrModelInfo[]>([])
  const [evals, setEvals] = useState(() => getEvalScores())
  const [evalRunning, setEvalRunning] = useState<Set<string>>(new Set())
  const pulls = useUregantPulls((s) => s.byTag)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    const [h, models] = await Promise.all([
      window.api.uregant.hardware(),
      window.api.discoverModels('ollama')
    ])
    setHw(h)
    setInstalled(new Set(models))
    setLoading(false)
  }
  useEffect(() => {
    void refresh()
    void window.api.openrouter.models().then(setOrModels).catch(() => undefined)
  }, [])

  // when a pull finishes, refresh the installed set and drop the progress entry
  useEffect(() => {
    for (const [tag, p] of Object.entries(pulls)) {
      if (p.done && p.status === 'success') {
        useUregantPulls.getState().clear(tag)
        void refresh()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulls])

  const isInstalled = (tag: string): boolean => {
    const base = tag.split(':')[0]
    for (const m of installed) if (m === tag || m.split(':')[0] === base) return true
    return false
  }
  const toggle = (id: string): void => setEnabled(new Set(toggleEnabled(id)))

  const installedTag = (tag: string): string => {
    const base = tag.split(':')[0]
    for (const m of installed) if (m === tag || m.split(':')[0] === base) return m
    return tag
  }
  const runEval = async (catalogTag: string): Promise<void> => {
    setEvalRunning((s) => new Set(s).add(catalogTag))
    try {
      const res = await window.api.uregant.evalModel(installedTag(catalogTag))
      setEvals(setEvalScore(catalogTag, res))
    } finally {
      setEvalRunning((s) => {
        const n = new Set(s)
        n.delete(catalogTag)
        return n
      })
    }
  }

  const ranked = UREGANT_CATALOG.map((m) => ({ m, fit: fitBadge(m, hw) })).sort(
    (a, b) => FIT_RANK[a.fit.fit] - FIT_RANK[b.fit.fit] || a.m.minVramGb - b.m.minVramGb
  )

  return (
    <section className="settings-section">
      <div className="settings-section-head ck-head-row">
        <h3>Local models · Ollama</h3>
        <button className="btn" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Detecting…' : 'Refresh'}
        </button>
      </div>

      <div className="ck-hw">{renderHw(hw)}</div>

      <div className="ck-models">
        {ranked.map(({ m, fit }) => {
          const here = isInstalled(m.ollamaTag)
          const blocked = fit.fit === 'cant-run' || fit.fit === 'no-disk'
          const pull = pulls[m.ollamaTag]
          const pulling = pull && !pull.done
          const pct = pull?.total ? Math.round(((pull.completed ?? 0) / pull.total) * 100) : null
          const ev = evals[m.ollamaTag]
          return (
            <div key={m.ollamaTag} className={clsx('ck-model', `ck-fit-${fit.fit}`)}>
              <div className="ck-model-main">
                <div className="ck-model-name">
                  {m.name}
                  <span className="ck-tag">{m.params}</span>
                  {m.status === 'verified' ? (
                    <span className="ck-tag ck-verified">verified</span>
                  ) : (
                    <span className="ck-tag ck-atlas">unverified</span>
                  )}
                  <span className="ck-tag">{toolLabel(m.tools)}</span>
                </div>
                <div className="ck-model-note">
                  {m.note} · ~{m.downloadSizeGb} GB · {m.minVramGb} GB VRAM ·{' '}
                  <span className="ck-mono">{m.ollamaTag}</span>
                </div>
                {pulling ? (
                  <div className="ck-progress">
                    <div className="ck-progress-bar" style={{ width: pct != null ? `${pct}%` : '100%' }} />
                    <span className="ck-progress-label">
                      {pull?.status}
                      {pct != null ? ` ${pct}%` : ''}
                    </span>
                  </div>
                ) : pull?.error ? (
                  <div className="ck-model-reason ck-err">{pull.error}</div>
                ) : (
                  <div className="ck-model-reason">{fit.reason}</div>
                )}
                {ev && (
                  <div className={clsx('ck-eval', ev.ok ? 'ck-eval-ok' : 'ck-eval-bad')}>
                    {ev.ok ? '✓ ' : '⚠ '}
                    {ev.note}
                  </div>
                )}
              </div>
              <div className="ck-model-side">
                <span className={clsx('ck-badge', `ck-fit-${fit.fit}`)}>{FIT_LABEL[fit.fit]}</span>
                {pulling ? (
                  <button className="btn" onClick={() => window.api.uregant.cancelPull(m.ollamaTag)}>
                    Cancel
                  </button>
                ) : here ? (
                  <>
                    <span className="ck-installed">✓ Installed</span>
                    <Toggle on={enabled.has(m.ollamaTag)} onClick={() => toggle(m.ollamaTag)} />
                    <button
                      className="btn"
                      disabled={evalRunning.has(m.ollamaTag)}
                      title="Test tool-calling fidelity"
                      onClick={() => void runEval(m.ollamaTag)}
                    >
                      {evalRunning.has(m.ollamaTag) ? 'Testing…' : 'Test'}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn"
                    disabled={blocked}
                    title={blocked ? fit.reason : `ollama pull ${m.ollamaTag}`}
                    onClick={() => window.api.uregant.pull(m.ollamaTag)}
                  >
                    Install
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <h3 className="ck-cloud-title">Cloud models</h3>
      <div className="ck-models">
        {UREGANT_CLOUD_CATALOG.map((m) => (
          <div key={m.id} className="ck-model">
            <div className="ck-model-main">
              <div className="ck-model-name">
                {m.name}
                <span className="ck-tag">{m.provider}</span>
                <span className="ck-tag">{m.ctxK}K ctx</span>
              </div>
              <div className="ck-model-note">
                {priceM(m.inPerM)} in · {priceM(m.outPerM)} out · <span className="ck-mono">{m.id}</span>
              </div>
            </div>
            <div className="ck-model-side">
              <Toggle on={enabled.has(m.id)} onClick={() => toggle(m.id)} />
            </div>
          </div>
        ))}

        {DEFAULT_MODELS.openrouter.map((id) => {
          const live = orModels.find((x) => x.id === id)
          return (
            <div key={id} className="ck-model">
              <div className="ck-model-main">
                <div className="ck-model-name">
                  {live?.name ?? id}
                  <span className="ck-tag">openrouter</span>
                  {live?.contextLength != null && (
                    <span className="ck-tag">{Math.round(live.contextLength / 1000)}K ctx</span>
                  )}
                </div>
                <div className="ck-model-note">
                  {orPriceM(live?.promptPrice) ?? 'pricing via OpenRouter (add a key)'} ·{' '}
                  <span className="ck-mono">{id}</span>
                </div>
              </div>
              <div className="ck-model-side">
                <Toggle on={enabled.has(id)} onClick={() => toggle(id)} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="ck-model-note">
        Cloud prices are USD per 1M tokens. OpenRouter rows fill in live when a key is set (Settings →
        Providers). Per-role assignment + agents/MCP/memory tabs land in later phases.
      </p>
    </section>
  )
}

function AgentsSection(): JSX.Element {
  const panes = useWorkspace((s) => s.panes)
  const activeId = useWorkspace((s) => s.activePaneId)
  const active = activeId ? panes[activeId] : undefined
  const cwd = active?.agent?.cwd || active?.shell?.cwd || ''
  const [result, setResult] = useState<{ ok: boolean; port?: number; agents?: number; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(() => getAutoCrew())

  const toggleAuto = (): void => {
    const next = !auto
    setAuto(next)
    setAutoCrew(next)
  }

  const connect = async (): Promise<void> => {
    if (!cwd) return
    setBusy(true)
    try {
      setResult(await window.api.uregant.connectCrew(cwd))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-head ck-head-row">
        <h3>Claude Crew</h3>
        <button
          className={clsx('ck-toggle', auto && 'on')}
          onClick={toggleAuto}
          title="Auto-connect when a Claude pane opens in a folder"
        >
          {auto ? 'Auto-connect: On' : 'Auto-connect: Off'}
        </button>
      </div>
      <p className="ck-model-note">
        Give Claude control of URterminal&apos;s panes via MCP, and install a per-role crew into the
        folder&apos;s <span className="ck-mono">.claude/agents</span>. Then open a{' '}
        <span className="ck-mono">claude</span> pane there and @-invoke a role.
      </p>
      <div className="ck-model">
        <div className="ck-model-main">
          <div className="ck-model-name">
            uregant-panes
            <span className="ck-tag">MCP bridge</span>
          </div>
          <div className="ck-model-note">
            {cwd ? (
              <>
                Active folder: <span className="ck-mono">{cwd}</span>
              </>
            ) : (
              'Focus an agent/shell pane that has a folder first.'
            )}
          </div>
          {result &&
            (result.ok ? (
              <div className="ck-eval ck-eval-ok">
                ✓ Connected on port {result.port} · installed {result.agents ?? 0} crew agents +
                .mcp.json. Open a <span className="ck-mono">claude</span> pane here.
              </div>
            ) : (
              <div className="ck-eval ck-eval-bad">⚠ {result.error}</div>
            ))}
        </div>
        <div className="ck-model-side">
          <button className="btn" disabled={!cwd || busy} onClick={() => void connect()}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>

      <h3 className="ck-cloud-title">Crew roster</h3>
      <div className="ck-models">
        {UREGANT_CREW.map((c) => (
          <div key={c.name} className="ck-model">
            <div className="ck-model-main">
              <div className="ck-model-name">
                {c.role}
                <span className="ck-tag">{c.name}</span>
                <span className="ck-tag">{c.model}</span>
                <span className="ck-tag">{c.tools}</span>
              </div>
              <div className="ck-model-note">{c.blurb}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function HandoffsView(): JSX.Element {
  return (
    <div className="cockpit-body">
      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Handoffs</h3>
        </div>
        <p className="ck-model-note">
          Agents coordinate by handing work to each other and keeping shared notes. Open a connected{' '}
          <span className="ck-mono">claude</span> pane, give it a goal, and it delegates to the crew via
          the Task tool — each role keeps its own memory in{' '}
          <span className="ck-mono">.claude/agent-memory/&lt;role&gt;/</span>.
        </p>
        <div className="ck-models">
          {UREGANT_CREW.map((c) => (
            <div key={c.name} className="ck-model">
              <div className="ck-model-main">
                <div className="ck-model-name">
                  {c.role}
                  <span className="ck-tag">{c.name}</span>
                  <span className="ck-tag">{c.model}</span>
                </div>
                <div className="ck-model-note">{c.blurb}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="ck-model-note">
          The live agent↔agent run timeline (who handed what to whom, with shared-memory writes)
          arrives with Phase 4 — the Route tab. For now this shows the crew available for handoffs.
        </p>
      </section>
    </div>
  )
}

function RouteView(): JSX.Element {
  const [goal, setGoal] = useState('')
  const [model, setModel] = useState(UREGANT_DEFAULT_MODEL)
  const [models, setModels] = useState<string[]>([])
  const [plan, setPlan] = useState<UrPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planErr, setPlanErr] = useState<string | null>(null)
  const [gate, setGate] = useState<UrGateResult[] | null>(null)
  const [gating, setGating] = useState(false)

  const activeId = useWorkspace((s) => s.activePaneId)
  const panes = useWorkspace((s) => s.panes)
  const active = activeId ? panes[activeId] : undefined
  const cwd = active?.agent?.cwd || active?.shell?.cwd || ''

  useEffect(() => {
    void window.api.discoverModels('ollama').then((m) => {
      setModels(m)
      if (m.length && !m.includes(model)) {
        setModel(m.includes(UREGANT_DEFAULT_MODEL) ? UREGANT_DEFAULT_MODEL : m[0])
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doPlan = async (): Promise<void> => {
    if (!goal.trim() || planning) return
    setPlanning(true)
    setPlanErr(null)
    setPlan(null)
    setGate(null)
    try {
      const r = await window.api.uregant.planProject({ goal: goal.trim(), model })
      if (r.ok && r.plan) setPlan(r.plan)
      else setPlanErr(r.error ?? 'planning failed')
    } finally {
      setPlanning(false)
    }
  }

  const runWithUregant = (): void => {
    if (!plan) return
    const prompt =
      `Goal: ${goal.trim()}\n\nPlan:\n` +
      plan.steps.map((s, i) => `${i + 1}. [${s.role}] ${s.instruction}`).join('\n') +
      '\n\nExecute this plan step by step using your tools. Call done() with a summary when finished.'
    const id = useWorkspace.getState().addPane('uregant', undefined, { label: 'Route' })
    if (!id) return
    useWorkspace.getState().setActive(id)
    useUregant.getState().setModel(id, model)
    useUi.getState().setShowCockpit(false)
    window.setTimeout(() => useUregant.getState().send(id, prompt), 150)
  }

  const doGate = async (): Promise<void> => {
    if (gating) return
    setGating(true)
    setGate(null)
    try {
      setGate(await window.api.uregant.runGate(cwd))
    } finally {
      setGating(false)
    }
  }

  return (
    <div className="cockpit-body">
      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Route — goal → plan → ship</h3>
        </div>
        <textarea
          className="input mono"
          style={{ width: '100%', minHeight: 64, padding: 8 }}
          placeholder="Describe the goal, e.g. 'add an inline diff-review modal with apply/revert'"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
        <div className="ck-route-controls">
          <div className="cockpit-tabs">
            <button className="cockpit-tab active" title="run the plan as one crew (sequential)">
              Sequential
            </button>
            <button className="cockpit-tab" disabled title="coming in a later slice">
              Parallel<span className="cockpit-soon">soon</span>
            </button>
            <button className="cockpit-tab" disabled title="coming in a later slice">
              Race<span className="cockpit-soon">soon</span>
            </button>
          </div>
          {models.length > 0 && (
            <select
              className="input mono"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{ fontSize: 11, padding: '2px 6px' }}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <button className="btn" disabled={!goal.trim() || planning} onClick={() => void doPlan()}>
            {planning ? 'Planning…' : 'Plan'}
          </button>
        </div>
        {planErr && <div className="ck-eval ck-eval-bad">⚠ {planErr}</div>}

        {plan && (
          <>
            {plan.summary && <p className="ck-model-note">{plan.summary}</p>}
            <div className="ck-models">
              {plan.steps.map((s, i) => (
                <div key={i} className="ck-model">
                  <div className="ck-model-main">
                    <div className="ck-model-name">
                      {i + 1}. {s.role}
                    </div>
                    <div className="ck-model-note">{s.instruction}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="ck-route-controls">
              <button
                className="btn"
                style={{ background: 'var(--accent, #3a7afe)', color: '#fff' }}
                onClick={runWithUregant}
              >
                Run with Uregant
              </button>
              <button className="btn" disabled={gating} onClick={() => void doGate()}>
                {gating ? 'Checking…' : 'Run Definition of Done'}
              </button>
            </div>
          </>
        )}

        {gate && (
          <div className="ck-models" style={{ marginTop: 8 }}>
            {gate.map((g, i) => (
              <div key={i} className="ck-model">
                <div className="ck-model-main">
                  <div className="ck-model-name">
                    {g.ok ? '✅' : '⛔'} {g.name}
                  </div>
                  <div className="ck-model-note">{g.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="ck-model-note">
          Slice 1: plan + sequential run + Definition of Done. Parallel/race fan-out, merge &amp; ship
          land next.
        </p>
      </section>
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button className={clsx('ck-toggle', on && 'on')} onClick={onClick} title={on ? 'Enabled' : 'Disabled'}>
      {on ? 'On' : 'Off'}
    </button>
  )
}

function toolLabel(t: UrToolQuality): string {
  return t === 'reliable' ? 'tools ✓✓' : t === 'usable' ? 'tools ✓' : 'tools ⚠'
}

function priceM(n?: number): string {
  if (n == null) return '—'
  return n >= 1 ? `$${n.toFixed(0)}/M` : `$${n.toFixed(2)}/M`
}
function orPriceM(perToken?: number): string | null {
  if (!perToken) return null
  const m = perToken * 1_000_000
  return m >= 1 ? `$${m.toFixed(0)}/M` : `$${m.toFixed(2)}/M`
}

function renderHw(hw: HardwareInfo | null): JSX.Element {
  if (!hw) return <span className="ck-model-note">Detecting hardware…</span>
  const gb = (mb?: number): string => (mb != null ? (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) : '?')
  const vram =
    hw.vramTotalMB != null
      ? `${gb(hw.vramTotalMB)} GB${hw.vramFreeMB != null ? ` (${gb(hw.vramFreeMB)} free)` : ''}`
      : hw.gpuName
        ? 'VRAM unknown'
        : 'no GPU detected'
  return (
    <>
      <span className="ck-hw-item">🎮 {hw.gpuName ?? 'GPU n/a'} · {vram}</span>
      <span className="ck-hw-item">🧠 RAM {gb(hw.ramTotalMB)} GB</span>
      {hw.diskFreeMB != null && <span className="ck-hw-item">💾 {gb(hw.diskFreeMB)} GB free</span>}
      <span className="ck-hw-item">⚙ {hw.cpuCores} cores</span>
    </>
  )
}
