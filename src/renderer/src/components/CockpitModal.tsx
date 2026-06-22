import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { pasteText } from '../lib/terminalPool'
import {
  UREGANT_CATALOG,
  fitBadge,
  FIT_LABEL,
  FIT_RANK,
  type HardwareInfo,
  type UrModelCatalogEntry,
  type UrToolQuality
} from '@shared/uregantModels'
import { DEFAULT_MODELS } from '@shared/providers'
import '../styles/cockpit.css'

/**
 * Uregant Cockpit (Phase 2, Slice 1) — the orchestrator surface from OC1–OC5.
 * Only the Registry · Models tab is built; the other tabs are placeholders for
 * later phases. Registry/Models shows the local catalog matched to the user's
 * detected VRAM with fit/overload badges, marks installed models, and offers a
 * one-click `ollama pull` into a shell pane.
 */
type CockpitTab = 'mission' | 'route' | 'registry' | 'cost' | 'handoffs'

const TABS: { id: CockpitTab; label: string; ready?: boolean }[] = [
  { id: 'mission', label: 'Mission control' },
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
        {tab === 'registry' ? <RegistryView /> : <ComingSoon tab={tab} />}
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
  }, [])

  const isInstalled = (tag: string): boolean => {
    const base = tag.split(':')[0]
    for (const m of installed) {
      if (m === tag || m.split(':')[0] === base) return true
    }
    return false
  }

  const ranked = UREGANT_CATALOG.map((m) => ({ m, fit: fitBadge(m, hw) })).sort(
    (a, b) => FIT_RANK[a.fit.fit] - FIT_RANK[b.fit.fit] || a.m.minVramGb - b.m.minVramGb
  )

  const install = (tag: string): void => {
    const id = useWorkspace.getState().addPane('shell', undefined, { label: `pull ${tag.split(':')[0]}` })
    if (!id) return
    useUi.getState().setShowCockpit(false)
    window.setTimeout(() => {
      pasteText(id, `ollama pull ${tag}`)
      const ptyId = useWorkspace.getState().panes[id]?.shell?.ptyId
      if (ptyId) window.setTimeout(() => window.api.writePty(ptyId, '\r'), 300)
    }, 700)
  }

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
                <div className="ck-model-reason">{fit.reason}</div>
              </div>
              <div className="ck-model-side">
                <span className={clsx('ck-badge', `ck-fit-${fit.fit}`)}>{FIT_LABEL[fit.fit]}</span>
                {here ? (
                  <span className="ck-installed">✓ Installed</span>
                ) : (
                  <button
                    className="btn"
                    disabled={blocked}
                    title={blocked ? fit.reason : `ollama pull ${m.ollamaTag}`}
                    onClick={() => install(m.ollamaTag)}
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
      <div className="ck-cloud">
        {(['anthropic', 'openai', 'gemini'] as const).map((p) => (
          <div key={p} className="ck-cloud-group">
            <span className="ck-cloud-prov">{p}</span>
            {DEFAULT_MODELS[p].map((id) => (
              <span key={id} className="ck-tag">
                {id}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="ck-model-note">
        Cloud providers with cost/latency, install progress, and enable toggles land in the next
        slice. Configure provider keys in Settings.
      </p>
    </section>
  )
}

function toolLabel(t: UrToolQuality): string {
  return t === 'reliable' ? 'tools ✓✓' : t === 'usable' ? 'tools ✓' : 'tools ⚠'
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
