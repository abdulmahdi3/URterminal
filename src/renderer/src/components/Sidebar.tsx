import clsx from 'clsx'
import {
  Plus,
  Network,
  KanbanSquare,
  DoorOpen,
  GitBranch,
  History,
  Settings,
  Server,
  NotebookPen
} from 'lucide-react'
import { useWorkspaces } from '@renderer/store/workspaces'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'
import { useSidebar } from '@renderer/store/sidebar'
import SessionsMenu from './SessionsMenu'

/** One rail row: a centred icon (collapsed) that reveals a label + trailing meta on expand. */
function Row({
  icon,
  label,
  meta,
  active,
  title,
  onClick,
  onAux
}: {
  icon: JSX.Element
  label: string
  meta?: JSX.Element | string
  active?: boolean
  title?: string
  onClick?: () => void
  onAux?: () => void
}): JSX.Element {
  return (
    <button
      className={clsx('sb-row', active && 'active')}
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

  const list = useWorkspaces((s) => s.list)
  const activeId = useWorkspaces((s) => s.activeId)
  const badges = useWorkspaces((s) => s.badges)
  const switchTo = useWorkspaces((s) => s.switchTo)
  const addWorkspace = useWorkspaces((s) => s.add)
  const rename = useWorkspaces((s) => s.rename)

  const livePaneCount = useWorkspace((s) => Object.keys(s.panes).length)

  const setShowBridge = useUi((s) => s.setShowBridge)
  const setShowTasks = useUi((s) => s.setShowTasks)
  const setShowRooms = useUi((s) => s.setShowRooms)
  const setShowTimeline = useUi((s) => s.setShowTimeline)
  const toggleSessionSearch = useUi((s) => s.toggleSessionSearch)
  const setShowSshPrompt = useUi((s) => s.setShowSshPrompt)
  const toggleNotes = useUi((s) => s.toggleNotes)
  const openSettings = useUi((s) => s.openSettings)

  return (
    <aside className={clsx('sidebar', pinned && 'pinned')}>
      <div className="sidebar-rail">
        <div className="sb-scroll">
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

          {/* tools */}
          <Section title="Tools" />
          <div className="sb-group">
            <SessionsMenu />
            <Row icon={<Network size={18} />} label="BridgeMemory" onClick={() => setShowBridge(true)} />
            <Row icon={<KanbanSquare size={18} />} label="Task board" onClick={() => setShowTasks(true)} />
            <Row icon={<DoorOpen size={18} />} label="Rooms" onClick={() => setShowRooms(true)} />
            <Row icon={<GitBranch size={18} />} label="Build timeline" onClick={() => setShowTimeline(true)} />
            <Row icon={<History size={18} />} label="Search history" onClick={toggleSessionSearch} />
            <Row icon={<Server size={18} />} label="SSH connect" title="SSH connect…" onClick={() => setShowSshPrompt(true)} />
            <Row icon={<NotebookPen size={18} />} label="Notes" onClick={toggleNotes} />
          </div>
        </div>

        {/* footer */}
        <div className="sb-foot">
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
