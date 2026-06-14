import { useEffect, useMemo, useRef, useState } from 'react'
import type { MosaicNode } from 'react-mosaic-component'
import clsx from 'clsx'
import {
  Search,
  Sparkles,
  TerminalSquare,
  Command as CommandIcon,
  ChevronRight,
  Zap,
  LayoutGrid,
  CornerDownRight,
  Send,
  Clock,
  Download,
  Loader2
} from 'lucide-react'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import { useSessions } from '@renderer/store/sessions'
import type { SavedSession } from '@renderer/store/sessions'
import { useUi } from '@renderer/store/ui'
import { useShortcuts, effectiveCombo } from '@renderer/store/shortcuts'
import { toast } from '@renderer/store/toasts'
import type { AgentRuntimeStatus } from '@shared/types'
import { useSettings } from '@renderer/store/settings'
import { getShellSpecs, refreshWslDistros, type ShellSpec } from '@renderer/lib/shells'
import { getCommands, runCommand } from '@renderer/lib/commands'
import { ShellLogo, AgentLogo, hasAgentLogo } from './brandIcons'
import logoPng from '@renderer/assets/logo.png'
import {
  LAUNCH_AGENTS,
  STATUS_LABEL,
  shellRowMeta,
  sessionDesc,
  countLeaves,
  type LaunchAgent,
  type AgentStatus
} from '@renderer/lib/launchCatalog'

type Filter = 'all' | 'installed' | 'cloud' | 'local'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'local', label: 'Local' }
]

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Format a real shortcut combo ("Ctrl+Shift+5") into display keycaps (['^','⇧','5']). */
function comboToKeys(combo: string | undefined): string[] {
  if (!combo) return []
  const map: Record<string, string> = {
    Ctrl: '^',
    Shift: '⇧',
    Alt: '⌥',
    Meta: '⌘',
    Enter: '⏎',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→'
  }
  return combo.split('+').map((p) => map[p] ?? (p.length === 1 ? p.toUpperCase() : p))
}

/** Render a sequence of keycap chips (e.g. ['^','⇧','K']). */
function Keys({ keys }: { keys: string[] }): JSX.Element {
  return (
    <span className="lc-keys">
      {keys.map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  )
}

/** A miniature of a saved session's pane layout (the thumbnail in each row). */
function MiniLayout({ node }: { node: MosaicNode<string> | null }): JSX.Element {
  if (node === null || typeof node === 'string') return <div className="ml-cell" />
  return (
    <div className={clsx('ml-split', node.direction)}>
      <MiniLayout node={node.first} />
      <MiniLayout node={node.second} />
    </div>
  )
}

function AgentCard({
  a,
  status,
  index,
  installing,
  onActivate
}: {
  a: LaunchAgent
  status: AgentStatus
  index: number
  installing: boolean
  onActivate: () => void
}): JSX.Element {
  const isMissing = !a.configure && status === 'missing'
  const canInstall = isMissing && !!a.install
  // Not clickable while installing, or when missing with no way to install it.
  const disabled = installing || (isMissing && !a.install)
  const statusLabel = a.configure ? (status === 'ready' ? 'Ready' : 'Set up') : STATUS_LABEL[status]
  const title = a.configure
    ? status === 'ready'
      ? 'Use OpenRouter — choose a default model'
      : 'Configure OpenRouter — add your key'
    : canInstall
      ? `Install ${a.name}  ·  ${a.install}`
      : isMissing
        ? `${a.name} isn’t installed`
        : `Open ${a.name} in a folder`
  return (
    <button
      type="button"
      className={clsx(
        'lc-card',
        a.featured && 'featured',
        a.configure && 'configure',
        installing && 'installing',
        isMissing && !a.install && 'unavailable'
      )}
      style={{ ['--b' as string]: a.color, ['--i' as string]: index }}
      title={title}
      disabled={disabled}
      onClick={onActivate}
    >
      <div className="lc-card-top">
        <span className="lc-badge">
          {hasAgentLogo(a.command) ? <AgentLogo command={a.command} size={20} /> : a.badge}
        </span>
        <div className="lc-card-id">
          <div className="lc-card-name">
            {a.name}
            {a.spark && <Zap size={12} className="lc-spark" />}
          </div>
          <div className="lc-card-cli">{a.cli}</div>
        </div>
        <span className={clsx('lc-stat', status)}>
          <span className="d" />
          {statusLabel}
        </span>
      </div>
      <div className="lc-card-model">{a.model}</div>
      <div className="lc-card-foot">
        <span className="lc-card-hint">
          {a.configure
            ? status === 'ready'
              ? 'key saved · 200+ models'
              : 'one key · 200+ models'
            : installing
              ? 'fetching…'
              : isMissing
                ? canInstall
                  ? 'not installed'
                  : 'not on PATH'
                : 'opens in a folder'}
        </span>
        {a.configure ? (
          <span className="lc-card-launch">
            {status === 'ready' ? 'Choose model' : 'Set up'} <ChevronRight size={13} />
          </span>
        ) : installing ? (
          <span className="lc-card-launch install">
            <Loader2 size={13} className="spin" /> Installing…
          </span>
        ) : canInstall ? (
          <span className="lc-card-launch install">
            <Download size={13} /> Install
          </span>
        ) : isMissing ? (
          <span className="lc-card-launch muted">Unavailable</span>
        ) : (
          <span className="lc-card-launch">
            Launch <ChevronRight size={13} />
          </span>
        )}
      </div>
    </button>
  )
}

export default function LaunchConsole(): JSX.Element {
  const addPane = useWorkspace((s) => s.addPane)
  const activePaneCount = useWorkspace((s) => Object.keys(s.panes).length)
  const wsList = useWorkspaces((s) => s.list)
  const wsActiveId = useWorkspaces((s) => s.activeId)
  const sessions = useSessions((s) => s.sessions)
  const restore = useSessions((s) => s.restore)
  const toggleCommandPalette = useUi((s) => s.toggleCommandPalette)
  const setShowOpenRouter = useUi((s) => s.setShowOpenRouter)
  const custom = useShortcuts((s) => s.custom)
  const orKeySet = useSettings((s) => !!s.settings?.providers.openrouter.keySet)

  // Real total across EVERY workspace — the active one is empty here, so this
  // also reflects panes opened in other workspaces (which the old count missed).
  const totalPanes = useMemo(() => {
    let n = activePaneCount
    for (const w of wsList) if (w.id !== wsActiveId) n += Object.keys(w.panes ?? {}).length
    return n
  }, [activePaneCount, wsList, wsActiveId])

  // Live keybindings (custom override ?? built-in default) for the action buttons,
  // pulled from the same command registry the palette uses — so the chips match
  // what actually fires and stay correct after a rebind.
  const cmdDefaults = useMemo(() => {
    const m: Record<string, string | undefined> = {}
    for (const c of getCommands()) m[c.id] = c.shortcut
    return m
  }, [])
  const newShellKeys = comboToKeys(effectiveCombo(custom, 'pane.newShell', cmdDefaults['pane.newShell']))
  const newAgentKeys = comboToKeys(effectiveCombo(custom, 'pane.newAi', cmdDefaults['pane.newAi']))

  const [statuses, setStatuses] = useState<Record<string, AgentRuntimeStatus>>({})
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [shells, setShells] = useState<ShellSpec[]>(getShellSpecs())
  useEffect(() => {
    void window.api
      .agentStatuses(LAUNCH_AGENTS.filter((a) => !a.configure).map((a) => a.command))
      .then(setStatuses)
    void refreshWslDistros().then(() => setShells(getShellSpecs()))
  }, [])

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const searchRef = useRef<HTMLInputElement>(null)

  // Keyboard: "/" focuses the agent search; a shell's letter (P, A, C, U, K, …)
  // opens that shell directly — matching the key chip shown on each row.
  useEffect(() => {
    const keyMap = new Map<string, ShellSpec>()
    for (const spec of shells) {
      const k = shellRowMeta(spec).key.toLowerCase()
      if (k && !keyMap.has(k)) keyMap.set(k, spec)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      const spec = keyMap.get(e.key.toLowerCase())
      if (spec) {
        e.preventDefault()
        addPane('shell', undefined, { shell: spec.file, shellArgs: spec.args, label: spec.label })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shells, addPane])

  // Real status per card: OpenRouter (a provider gateway) reflects whether its
  // key is set; every real CLI uses the live install + auth probe and shows
  // `checking` until that resolves.
  const statusOf = (a: LaunchAgent): AgentStatus =>
    a.configure ? (orKeySet ? 'ready' : 'signin') : statuses[a.command] ?? 'checking'

  const agents = useMemo(() => {
    const q = query.trim().toLowerCase()
    return LAUNCH_AGENTS.filter((a) => {
      const st = statusOf(a)
      if (filter === 'installed' && (st === 'missing' || st === 'checking')) return false
      if (filter === 'cloud' && a.kind !== 'cloud') return false
      if (filter === 'local' && a.kind !== 'local') return false
      if (q && !(`${a.name} ${a.cli} ${a.model}`.toLowerCase().includes(q))) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter, statuses, orKeySet])

  const recent = sessions.slice(0, 4)
  const commandCount = useMemo(() => getCommands().filter((c) => !c.hidden).length, [])

  const launchAgent = (a: LaunchAgent): void => {
    addPane('ai', undefined, { agentCommand: a.command, label: a.name })
  }

  // Re-probe the real CLI agents (the OpenRouter gateway card has no binary).
  const reprobe = (): Promise<Record<string, AgentRuntimeStatus>> =>
    window.api
      .agentStatuses(LAUNCH_AGENTS.filter((a) => !a.configure).map((a) => a.command))
      .then((next) => {
        setStatuses(next)
        return next
      })

  // Install a missing agent's CLI, then re-probe + notify (in-app toast AND an OS
  // notification) so the card flips to its real state and the user hears about it
  // even if they switched away during the (sometimes slow) install.
  const startInstall = (a: LaunchAgent): void => {
    if (!a.install) return
    setInstalling((prev) => new Set(prev).add(a.command))
    void window.api
      .installAgent(a.install)
      .then(async (res) => {
        if (!res.ok) {
          toast(`Couldn't install ${a.name}: ${res.error ?? 'failed'}`, 'error')
          void window.api.notify(`${a.name} install failed`, res.error ?? 'The install command failed.')
          return
        }
        const next = await reprobe()
        const onPath = !!next[a.command] && next[a.command] !== 'missing'
        toast(onPath ? `${a.name} installed` : `${a.name} installed — restart to use it`, 'ok')
        void window.api.notify(
          `${a.name} installed`,
          onPath
            ? `${a.name} is installed and ready to use in URterminal.`
            : `${a.name} is installed — restart URterminal to start using it.`
        )
      })
      .catch((e: Error) => toast(`Couldn't install ${a.name}: ${e.message}`, 'error'))
      .finally(() =>
        setInstalling((prev) => {
          const n = new Set(prev)
          n.delete(a.command)
          return n
        })
      )
  }

  // A card click resolves to the right action for its state.
  const activate = (a: LaunchAgent): void => {
    if (a.configure) {
      // OpenRouter has its own config home (key + model) — open that, not Settings.
      setShowOpenRouter(true)
      return
    }
    if (statusOf(a) === 'missing') {
      if (a.install) startInstall(a)
      return
    }
    launchAgent(a)
  }

  const openShell = (spec: ShellSpec): void => {
    addPane('shell', undefined, { shell: spec.file, shellArgs: spec.args, label: spec.label })
  }
  const restoreSession = (s: SavedSession): void => {
    void restore(s.id)
    toast(`Restored: ${s.name}`, 'ok')
  }

  return (
    <div className="launch-console">
      <div className="lc-inner">
        {/* ---- hero ---- */}
        <header className="lc-hero">
          <div className="lc-brand">
            <img className="lc-app-icon" src={logoPng} alt="URterminal" draggable={false} />
            <div className="lc-brand-text">
              <div className="lc-title">URterminal</div>
              <div className="lc-subtitle">AI agent &amp; shell workspace</div>
            </div>
            <div className="lc-status-pill">
              <span className="lc-live-dot" />
              <b>Ready</b>
              <span className="sep">·</span>
              {totalPanes} pane{totalPanes !== 1 ? 's' : ''}
              <span className="sep">·</span>
              idle
            </div>
          </div>

          <div className="lc-actions">
            <button
              className="lc-btn shell"
              onClick={() => runCommand('pane.newShell')}
              title="New shell pane"
            >
              <TerminalSquare size={15} />
              New shell
              <Keys keys={newShellKeys} />
            </button>
            <button
              className="lc-btn agent"
              onClick={() => runCommand('pane.newAi')}
              title="New agent pane"
            >
              <Sparkles size={15} />
              New agent
              <Keys keys={newAgentKeys} />
            </button>
          </div>
        </header>

        {/* ---- agents ---- */}
        <section className="lc-section">
          <div className="lc-section-head">
            <div className="lc-sh-left">
              <h2>Agents</h2>
              <span className="lc-count">{LAUNCH_AGENTS.length} available</span>
            </div>
            <div className="lc-sh-right">
              <div className="lc-search">
                <Search size={14} />
                <input
                  ref={searchRef}
                  value={query}
                  placeholder="Search agents…"
                  spellCheck={false}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                />
                {!query && <kbd>/</kbd>}
              </div>
              <div className="lc-filters">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    className={clsx('lc-filter', filter === f.id && 'active')}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lc-grid">
            {agents.map((a, i) => (
              <AgentCard
                key={a.command}
                a={a}
                index={i}
                status={statusOf(a)}
                installing={installing.has(a.command)}
                onActivate={() => activate(a)}
              />
            ))}
            {agents.length === 0 && (
              <div className="lc-grid-empty">No agents match “{query}”.</div>
            )}
          </div>
        </section>

        {/* ---- recent sessions + shells ---- */}
        <section className="lc-bottom">
          <div className="lc-panel">
            <div className="lc-panel-head">
              <span className="ttl">
                <Clock size={13} /> Recent sessions
              </span>
              {recent.length > 0 && (
                <button className="lc-panel-link" onClick={() => restoreSession(recent[0])}>
                  restore a workspace
                </button>
              )}
            </div>
            <div className="lc-panel-body">
              {recent.length === 0 && <div className="lc-panel-empty">No saved sessions yet.</div>}
              {recent.map((s) => (
                <button key={s.id} className="lc-srow" onClick={() => restoreSession(s)}>
                  <span className="lc-thumb">
                    <MiniLayout node={s.layout} />
                  </span>
                  <span className="lc-srow-main">
                    <span className="lc-srow-title">{s.name}</span>
                    <span className="lc-srow-sub">{sessionDesc(s)}</span>
                  </span>
                  <span className="lc-srow-meta">
                    <span className="lc-srow-panes">
                      {countLeaves(s.layout) || s.paneCount} pane
                      {(countLeaves(s.layout) || s.paneCount) !== 1 ? 's' : ''}
                    </span>
                    <span className="lc-srow-ago">{relTime(s.savedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="lc-panel">
            <div className="lc-panel-head">
              <span className="ttl">
                <TerminalSquare size={13} /> Shells &amp; WSL
              </span>
              <span className="lc-panel-meta">{shells.length} detected</span>
            </div>
            <div className="lc-panel-body">
              {shells.map((spec) => {
                const m = shellRowMeta(spec)
                return (
                  <button
                    key={spec.id}
                    className="lc-shrow"
                    title={`Open ${m.name} — or press ${m.key}`}
                    onClick={() => openShell(spec)}
                  >
                    <span className="lc-shrow-icon">
                      <ShellLogo shell={spec.file} args={spec.args} size={16} />
                    </span>
                    <span className="lc-shrow-main">
                      <span className="lc-shrow-name">
                        {m.name}
                        {m.tag && <span className="lc-shrow-tag">{m.tag}</span>}
                      </span>
                      <span className="lc-shrow-sub">{m.sub}</span>
                    </span>
                    <kbd className="lc-shrow-key">{m.key}</kbd>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* ---- footer ---- */}
        <footer className="lc-foot">
          <div className="lc-foot-hints">
            <span>
              <LayoutGrid size={13} /> Split &amp; tile up to 9 panes
            </span>
            <span className="lc-foot-sep" />
            <span>
              <CornerDownRight size={13} /> Orchestrate a goal across agents
            </span>
            <span className="lc-foot-sep" />
            <span>
              <Send size={13} /> Link any pane to Telegram
            </span>
          </div>
          <button className="lc-foot-cmd" onClick={toggleCommandPalette}>
            <CommandIcon size={13} /> all {commandCount} commands
            <Keys keys={['^', '⇧', 'K']} />
          </button>
        </footer>
      </div>
    </div>
  )
}
