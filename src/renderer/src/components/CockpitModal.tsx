import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { useUregant } from '../store/uregant'
import { useUregantPulls } from '../store/uregantPulls'
import { getEnabled, toggleEnabled } from '../lib/uregantEnabled'
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
  { id: 'route', label: 'Route' },
  { id: 'registry', label: 'Registry', ready: true },
  { id: 'cost', label: 'Cost' },
  { id: 'handoffs', label: 'Handoffs' }
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
    { id: 'agents', label: 'Agents' },
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
