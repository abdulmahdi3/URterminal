import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Sparkles,
  TerminalSquare,
  Command as CommandIcon,
  Plus,
  Layers,
  Network,
  KanbanSquare,
  DoorOpen,
  GitBranch,
  History,
  Settings,
  Palette,
  Pin,
  PinOff
} from 'lucide-react'
import { useWorkspaces } from '@renderer/store/workspaces'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'
import { useSidebar } from '@renderer/store/sidebar'
import { useShortcuts, effectiveCombo } from '@renderer/store/shortcuts'
import { getAgents, getAvailableAgents, refreshAgentAvailability } from '@renderer/lib/agents'
import { getCommands, runCommand } from '@renderer/lib/commands'
import { AgentLogo } from './brandIcons'
import logoPng from '@renderer/assets/logo.png'

/** Format a real shortcut combo ("Ctrl+Shift+5") into compact symbols ("⌃⇧5"). */
function fmtCombo(combo: string | undefined): string {
  if (!combo) return ''
  const map: Record<string, string> = {
    Ctrl: '⌃',
    Shift: '⇧',
    Alt: '⌥',
    Meta: '⌘',
    Enter: '⏎',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→'
  }
  return combo
    .split('+')
    .map((p) => map[p] ?? p)
    .join('')
}

/** One rail row: a centred icon (collapsed) that reveals a label + trailing meta on expand. */
function Row({
  icon,
  label,
  meta,
  active,
  accent,
  title,
  onClick,
  onAux
}: {
  icon: JSX.Element
  label: string
  meta?: JSX.Element | string
  active?: boolean
  accent?: boolean
  title?: string
  onClick?: () => void
  onAux?: () => void
}): JSX.Element {
  return (
    <button
      className={clsx('sb-row', active && 'active', accent && 'accent')}
      title={title ?? label}
      onClick={onClick}
      onAuxClick={(e) => {
        if (e.button === 1 && onAux) {
          e.preventDefault()
          onAux()
        }
      }}
    >
      <span className="sb-ico">{icon}</span>
      <span className="sb-label">{label}</span>
      {meta != null && <span className="sb-meta">{meta}</span>}
    </button>
  )
}

function Section({ title, count }: { title: string; count?: number }): JSX.Element {
  return (
    <div className="sb-section">
      <span className="sb-section-title">{title}</span>
      {count != null && <span className="sb-section-count">{count}</span>}
    </div>
  )
}

export default function Sidebar(): JSX.Element {
  const pinned = useSidebar((s) => s.pinned)
  const togglePinned = useSidebar((s) => s.togglePinned)

  const list = useWorkspaces((s) => s.list)
  const activeId = useWorkspaces((s) => s.activeId)
  const badges = useWorkspaces((s) => s.badges)
  const switchTo = useWorkspaces((s) => s.switchTo)
  const addWorkspace = useWorkspaces((s) => s.add)
  const rename = useWorkspaces((s) => s.rename)

  const addPane = useWorkspace((s) => s.addPane)
  const livePaneCount = useWorkspace((s) => Object.keys(s.panes).length)

  const setShowBridge = useUi((s) => s.setShowBridge)
  const setShowTasks = useUi((s) => s.setShowTasks)
  const setShowRooms = useUi((s) => s.setShowRooms)
  const setShowTimeline = useUi((s) => s.setShowTimeline)
  const toggleSessionSearch = useUi((s) => s.toggleSessionSearch)
  const toggleCommandPalette = useUi((s) => s.toggleCommandPalette)
  const openSettings = useUi((s) => s.openSettings)
  const cycleAppTheme = useUi((s) => s.cycleAppTheme)
  const appTheme = useUi((s) => s.appTheme)

  const custom = useShortcuts((s) => s.custom)

  const [agents, setAgents] = useState(getAgents())
  const [available, setAvailable] = useState<Set<string>>(getAvailableAgents())
  useEffect(() => {
    void refreshAgentAvailability().then((s) => {
      setAgents([...getAgents()])
      setAvailable(new Set(s))
    })
  }, [])

  // Real shortcut hints, kept in sync with the command registry + any rebinds.
  const sc = useMemo(() => {
    const m = new Map<string, string | undefined>()
    for (const c of getCommands()) m.set(c.id, c.shortcut)
    const eff = (id: string): string => fmtCombo(effectiveCombo(custom, id, m.get(id)))
    return {
      newAi: eff('pane.newAi'),
      newShell: eff('pane.newShell'),
      palette: '⌃⇧K'
    }
  }, [custom])

  // Agents that are actually installed (real). Fall back to the cloud flagships
  // before discovery resolves, so the rail is never empty.
  const agentRows = useMemo(() => {
    const installed = agents.filter((a) => available.has(a.id))
    const base = installed.length ? installed : agents.slice(0, 4)
    return base.slice(0, 6)
  }, [agents, available])

  const readyCount = agents.filter((a) => available.has(a.id)).length
  const totalBadges = Object.values(badges).reduce((n, b) => n + (b ?? 0), 0)

  // Total panes across all workspaces (active is live; others are snapshots).
  const totalPanes = useMemo(() => {
    let n = livePaneCount
    for (const w of list) if (w.id !== activeId) n += Object.keys(w.panes ?? {}).length
    return n
  }, [livePaneCount, list, activeId])

  return (
    <aside className={clsx('sidebar', pinned && 'pinned')}>
      <div className="sidebar-rail">
        {/* brand + pin toggle */}
        <div className="sb-brand">
          <img className="sb-logo" src={logoPng} alt="" draggable={false} />
          <span className="sb-brand-name">URterminal</span>
          <button
            className={clsx('sb-pin', pinned && 'on')}
            title={pinned ? 'Unpin rail (Ctrl+B)' : 'Pin rail open (Ctrl+B)'}
            onClick={togglePinned}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        </div>

        <div className="sb-scroll">
          {/* create */}
          <div className="sb-group">
            <Row
              icon={<Sparkles size={18} />}
              label="New agent"
              accent
              meta={<kbd className="sb-kbd">{sc.newAi}</kbd>}
              title="New agent pane"
              onClick={() => runCommand('pane.newAi')}
            />
            <Row
              icon={<TerminalSquare size={18} />}
              label="New shell"
              meta={<kbd className="sb-kbd">{sc.newShell}</kbd>}
              title="New shell pane"
              onClick={() => runCommand('pane.newShell')}
            />
            <Row
              icon={<CommandIcon size={18} />}
              label="Command palette"
              meta={<kbd className="sb-kbd">{sc.palette}</kbd>}
              title="Command palette"
              onClick={toggleCommandPalette}
            />
          </div>

          {/* workspaces */}
          <Section title="Workspaces" count={list.length} />
          <div className="sb-group">
            {list.map((w, i) => {
              const isActive = w.id === activeId
              const badge = badges[w.id] ?? 0
              const paneN = isActive ? livePaneCount : Object.keys(w.panes ?? {}).length
              return (
                <Row
                  key={w.id}
                  icon={<span className="sb-ws-num">{i + 1}</span>}
                  label={w.name}
                  active={isActive}
                  title={`${w.name} — ${paneN} pane${paneN !== 1 ? 's' : ''}`}
                  meta={
                    badge > 0 ? (
                      <span className="sb-dot-badge">{badge > 9 ? '9+' : badge}</span>
                    ) : paneN > 0 ? (
                      <span className="sb-count">{paneN}</span>
                    ) : undefined
                  }
                  onClick={() => switchTo(w.id)}
                  onAux={isActive ? () => rename(w.id, w.name) : undefined}
                />
              )
            })}
            <Row
              icon={<Plus size={18} />}
              label="New workspace"
              title="New workspace"
              onClick={addWorkspace}
            />
          </div>

          {/* agents */}
          <Section title="Agents" count={readyCount || agentRows.length} />
          <div className="sb-group">
            {agentRows.map((a) => {
              const ready = available.has(a.id)
              return (
                <Row
                  key={a.id}
                  icon={<AgentLogo command={a.id} size={18} />}
                  label={a.label}
                  title={ready ? `New ${a.label} pane` : `${a.label} — not installed`}
                  meta={<span className={clsx('sb-status', ready ? 'ok' : 'off')} />}
                  onClick={() => addPane('ai', undefined, { agentCommand: a.id, label: a.label })}
                />
              )
            })}
          </div>

          {/* workspace tools */}
          <Section title="Workspace" />
          <div className="sb-group">
            <Row icon={<Network size={18} />} label="BridgeMemory" onClick={() => setShowBridge(true)} />
            <Row icon={<KanbanSquare size={18} />} label="Task board" onClick={() => setShowTasks(true)} />
            <Row icon={<DoorOpen size={18} />} label="Rooms" onClick={() => setShowRooms(true)} />
            <Row icon={<GitBranch size={18} />} label="Build timeline" onClick={() => setShowTimeline(true)} />
            <Row icon={<History size={18} />} label="Search history" onClick={toggleSessionSearch} />
          </div>
        </div>

        {/* footer */}
        <div className="sb-foot">
          <Row
            icon={<Layers size={18} />}
            label="Panes open"
            meta={<span className="sb-count">{totalPanes}</span>}
            title={`${totalPanes} pane${totalPanes !== 1 ? 's' : ''} open · ${totalBadges} finished`}
          />
          <Row
            icon={<Palette size={18} />}
            label="Theme"
            meta={<span className="sb-theme-name">{appTheme}</span>}
            title="Cycle theme"
            onClick={cycleAppTheme}
          />
          <Row
            icon={<Settings size={18} />}
            label="Settings"
            title="Settings (Ctrl+,)"
            onClick={() => openSettings()}
          />
        </div>
      </div>
    </aside>
  )
}
