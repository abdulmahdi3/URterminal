import { useEffect, useMemo, useState } from 'react'
import { Network } from 'lucide-react'
import clsx from 'clsx'
import logoPng from '@renderer/assets/logo.png'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import { useUi } from '@renderer/store/ui'
import { getAgents, getAvailableAgents, refreshAgentAvailability } from '@renderer/lib/agents'
import { getShellSpecs, refreshWslDistros, type ShellSpec } from '@renderer/lib/shells'
import { AgentLogo, ShellLogo } from './brandIcons'
import LayoutPicker from './LayoutPicker'

/**
 * Top strip: the app logo, agent + shell quick-launch icons, and the pane-layout
 * picker pinned to the right beside the window controls. Workspaces, sessions,
 * SSH and notes now live in the sidebar. Dropping dragged panes on the empty
 * drag region moves them into a brand-new workspace.
 */
export default function TitleBar(): JSX.Element {
  const addPane = useWorkspace((s) => s.addPane)
  const panes = useWorkspace((s) => s.panes)
  const paneCount = Object.keys(panes).length
  const atMax = paneCount >= 9
  const list = useWorkspaces((s) => s.list)
  const movePanesToNew = useWorkspaces((s) => s.movePanesToNew)
  const draggingPaneIds = useUi((s) => s.draggingPaneIds)
  const setDraggingPanes = useUi((s) => s.setDraggingPanes)
  const setShowSshPrompt = useUi((s) => s.setShowSshPrompt)

  // Installed agents + all shells (incl. WSL distros), detected asynchronously.
  const [agents, setAgents] = useState(getAgents())
  const [available, setAvailable] = useState<Set<string>>(getAvailableAgents())
  const [shells, setShells] = useState<ShellSpec[]>(getShellSpecs())
  useEffect(() => {
    void refreshAgentAvailability().then((s) => {
      setAgents([...getAgents()])
      setAvailable(new Set(s))
    })
    void refreshWslDistros().then(() => setShells(getShellSpecs()))
  }, [])

  // Agent CLIs currently running in a pane (active workspace + background
  // snapshots) — these stay visible even if their CLI isn't detected on PATH.
  const activeAgentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const p of Object.values(panes)) if (p.agent?.command) ids.add(p.agent.command)
    for (const w of list)
      for (const p of Object.values(w.panes ?? {})) if (p.agent?.command) ids.add(p.agent.command)
    return ids
  }, [panes, list])
  // Only show agents that are installed or currently in use. Until detection
  // finishes (available is empty) show all, so the bar never starts out blank.
  const agentList =
    available.size === 0
      ? agents
      : agents.filter((a) => available.has(a.id) || activeAgentIds.has(a.id))

  return (
    <header
      className="titlebar"
      // Catch-all: dropping dragged panes on the empty title-bar space moves them
      // into a brand-new workspace.
      onDragOver={(e) => {
        if (!draggingPaneIds) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        if (!draggingPaneIds) return
        e.preventDefault()
        movePanesToNew(draggingPaneIds)
        setDraggingPanes(null)
      }}
    >
      <div
        className="titlebar-left"
        data-nodrag
        // The buttons group is NOT a new-workspace drop target — swallow drops so
        // dropping on/near a button doesn't spawn a workspace.
        onDragOver={(e) => {
          if (!draggingPaneIds) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'none'
        }}
        onDrop={(e) => {
          if (!draggingPaneIds) return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {/* Brand */}
        <img className="brand-logo-img" src={logoPng} alt="URterminal" draggable={false} />

        <div className="titlebar-sep" />

        {/* Installed agents — one icon each, opens a new pane of that agent */}
        {agentList.map((a) => {
          const unavailable = available.size > 0 && !available.has(a.id)
          return (
            <button
              key={a.id}
              className={clsx('icon-btn agent-icon-btn', unavailable && 'unavailable')}
              title={
                atMax
                  ? 'Max 9 panes reached'
                  : unavailable
                    ? `${a.label} — not installed (opens setup)`
                    : `New ${a.label} pane`
              }
              disabled={atMax}
              onClick={() => addPane('ai', undefined, { agentCommand: a.id, label: a.label })}
            >
              <AgentLogo command={a.id} size={15} />
            </button>
          )
        })}

        <div className="titlebar-sep" />

        {/* Shells + WSL distros — one icon each, opens a new shell pane.
            (Admin PowerShell is offered in the launch console, not here.) */}
        {shells
          .filter((spec) => spec.id !== 'powershell-admin')
          .map((spec) => (
            <button
              key={spec.id}
              className="icon-btn agent-icon-btn"
              title={atMax ? 'Max 9 panes reached' : `New ${spec.label}`}
              disabled={atMax}
              onClick={() =>
                addPane('shell', undefined, {
                  shell: spec.file,
                  shellArgs: spec.args,
                  label: spec.label
                })
              }
            >
              <ShellLogo shell={spec.file} args={spec.args} size={15} />
            </button>
          ))}

        {/* SSH — opens a prompt pre-filled with the last host, Enter to connect */}
        <button
          className="icon-btn agent-icon-btn"
          title="SSH connect…"
          onClick={() => setShowSshPrompt(true)}
        >
          <Network size={15} />
        </button>
      </div>

      <div className={clsx('titlebar-drag', draggingPaneIds && 'drop-zone')} />

      {/* Pane layout picker, pinned to the right beside the window controls */}
      <div className="titlebar-right" data-nodrag>
        <LayoutPicker />
      </div>
    </header>
  )
}
