import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Search, ChevronRight, ArrowRight, Download, LayoutGrid } from 'lucide-react'
import type { OrModelInfo } from '@shared/types'
import {
  LAUNCH_AGENTS,
  STATUS_LABEL,
  type LaunchAgent,
  type AgentStatus
} from '@renderer/lib/launchCatalog'
import { AgentLogo, hasAgentLogo } from './brandIcons'

/** Module cache so the 200+-model list is fetched once across the app. */
let MODELS_CACHE: OrModelInfo[] | null = null

function shortCtx(n?: number): string | null {
  if (!n) return null
  return n >= 1000 ? `${Math.round(n / 1000)}K ctx` : `${n} ctx`
}
function shortPrice(perToken?: number): string | null {
  if (!perToken || perToken <= 0) return null
  const perM = perToken * 1_000_000
  return perM >= 1 ? `$${perM.toFixed(0)}/M` : `$${perM.toFixed(2)}/M`
}
function isFree(m: OrModelInfo): boolean {
  return m.id.endsWith(':free') || (m.promptPrice === 0 && (m.completionPrice ?? 0) === 0)
}

interface Props {
  statusOf: (a: LaunchAgent) => AgentStatus
  orKeySet: boolean
  /** launch / install / configure an agent (reuses the console's activate) */
  onActivate: (a: LaunchAgent) => void
  /** open an OpenRouter chat pane preset to a model id */
  onOpenModel: (id: string) => void
  onClose: () => void
}

/**
 * The "Others" browser: every agent grouped by real status (installed / needs
 * sign-in / not installed) plus OpenRouter's full 200+-model catalog, all
 * searchable. Opened from the launch console's Others card.
 */
export default function OthersModal({
  statusOf,
  orKeySet,
  onActivate,
  onOpenModel,
  onClose
}: Props): JSX.Element {
  const [q, setQ] = useState('')
  const [models, setModels] = useState<OrModelInfo[]>(MODELS_CACHE ?? [])

  useEffect(() => {
    if (MODELS_CACHE || !orKeySet) return
    void window.api.openrouter.models().then((list) => {
      if (list.length) {
        MODELS_CACHE = list
        setModels(list)
      }
    })
  }, [orKeySet])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const needle = q.trim().toLowerCase()
  const orCard = LAUNCH_AGENTS.find((a) => a.configure)
  const matchA = (a: LaunchAgent): boolean =>
    !needle || `${a.name} ${a.cli} ${a.model}`.toLowerCase().includes(needle)

  const groups = useMemo(() => {
    const installed: LaunchAgent[] = []
    const signin: LaunchAgent[] = []
    const missing: LaunchAgent[] = []
    for (const a of LAUNCH_AGENTS) {
      if (a.configure || !matchA(a)) continue
      const s = statusOf(a)
      if (s === 'ready') installed.push(a)
      else if (s === 'signin') signin.push(a)
      else missing.push(a)
    }
    return { installed, signin, missing }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, statusOf])

  const orModels = useMemo(() => {
    const list = needle
      ? models.filter((m) => (m.id + ' ' + (m.name ?? '')).toLowerCase().includes(needle))
      : models
    return list.slice(0, needle ? 300 : 80)
  }, [needle, models])

  const agentRow = (a: LaunchAgent): JSX.Element => {
    const s = statusOf(a)
    const miss = s === 'missing' || s === 'checking'
    const canInstall = miss && !!a.install
    const disabled = miss && !a.install
    return (
      <button
        key={a.command}
        className={clsx('others-row', disabled && 'disabled')}
        disabled={disabled}
        onClick={() => {
          onActivate(a)
          onClose()
        }}
        title={a.model}
      >
        <span className="others-logo">
          {hasAgentLogo(a.command) ? <AgentLogo command={a.command} size={18} /> : a.badge}
        </span>
        <span className="others-row-main">
          <span className="others-row-name">{a.name}</span>
          <span className="others-row-sub">
            {a.cli} · {a.model}
          </span>
        </span>
        <span className={clsx('lc-stat', s)}>
          <span className="d" />
          {STATUS_LABEL[s]}
        </span>
        <span className="others-row-act">
          {canInstall ? (
            <>
              <Download size={12} /> Install
            </>
          ) : miss ? (
            'Unavailable'
          ) : (
            <>
              Launch <ArrowRight size={12} />
            </>
          )}
        </span>
      </button>
    )
  }

  const modelRow = (m: OrModelInfo): JSX.Element => (
    <button
      key={m.id}
      className="others-row"
      onClick={() => {
        onOpenModel(m.id)
        onClose()
      }}
      title={`Open ${m.id} in a chat pane`}
    >
      <span className="others-logo">
        <AgentLogo command="openrouter" size={16} />
      </span>
      <span className="others-row-main">
        <span className="others-row-name mono">{m.id}</span>
        <span className="others-row-sub">
          {[shortCtx(m.contextLength), isFree(m) ? null : shortPrice(m.promptPrice) && `${shortPrice(m.promptPrice)} in`]
            .filter(Boolean)
            .join('  ·  ')}
        </span>
      </span>
      {isFree(m) && <span className="or-tag free">FREE</span>}
      <span className="others-row-act">
        Open <ArrowRight size={12} />
      </span>
    </button>
  )

  const group = (label: string, items: LaunchAgent[]): JSX.Element | null => {
    if (!items.length) return null
    return (
      <div className="others-group">
        <div className="others-group-head">
          {label}
          <span className="others-group-n">{items.length}</span>
        </div>
        <div className="others-list">{items.map(agentRow)}</div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal others-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="others-head">
          <span className="others-head-title">
            <LayoutGrid size={16} /> All agents &amp; models
          </span>
          <div className="others-search">
            <Search size={14} />
            <input
              autoFocus
              value={q}
              placeholder="Search agents & 200+ models…"
              spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="others-body">
          {group('Installed', groups.installed)}
          {group('Needs sign-in', groups.signin)}
          {group('Not installed', groups.missing)}

          <div className="others-group">
            <div className="others-group-head">
              OpenRouter models
              <span className="others-group-n">
                {orKeySet ? (models.length ? models.length : '…') : '200+'}
              </span>
            </div>
            {!orKeySet ? (
              <div className="others-list">
                <button
                  className="others-row"
                  onClick={() => {
                    if (orCard) onActivate(orCard)
                    onClose()
                  }}
                >
                  <span className="others-logo">
                    <AgentLogo command="openrouter" size={16} />
                  </span>
                  <span className="others-row-main">
                    <span className="others-row-name">Connect OpenRouter</span>
                    <span className="others-row-sub">Add your key to browse 200+ models</span>
                  </span>
                  <span className="others-row-act">
                    Set up <ChevronRight size={12} />
                  </span>
                </button>
              </div>
            ) : models.length === 0 ? (
              <div className="others-empty">Loading models…</div>
            ) : orModels.length === 0 ? (
              <div className="others-empty">No models match “{q}”.</div>
            ) : (
              <div className="others-list">{orModels.map(modelRow)}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
