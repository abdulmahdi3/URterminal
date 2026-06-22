import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Plus,
  X,
  Settings,
  NotebookPen,
  Command as CommandIcon
} from 'lucide-react'
import { useWorkspaces, type WorkspaceEntry } from '@renderer/store/workspaces'
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

/**
 * A workspace entry in the sidebar. Beyond switch-on-click it is a drag target:
 * dropping the panes currently being dragged onto a (non-active) workspace moves
 * them into it. It can be closed via a middle-click, or via a × button that
 * replaces the workspace number after 3s of hover — both route through the
 * store's `remove`, which confirms first if an agent is mid-turn. Double-click
 * renames it inline.
 */
function WorkspaceRow({
  w,
  index,
  isActive,
  paneCount,
  badge,
  canClose,
  dropTarget,
  setDropTarget,
  dragging
}: {
  w: WorkspaceEntry
  index: number
  isActive: boolean
  paneCount: number
  badge: number
  canClose: boolean
  dropTarget: string | null
  setDropTarget: (t: string | null) => void
  dragging: string[] | null
}): JSX.Element {
  const switchTo = useWorkspaces((s) => s.switchTo)
  const rename = useWorkspaces((s) => s.rename)
  const remove = useWorkspaces((s) => s.remove)
  const movePanesTo = useWorkspaces((s) => s.movePanesTo)
  const setDraggingPanes = useUi((s) => s.setDraggingPanes)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(w.name)
  // The × only appears after the cursor has rested on the row for 2s, so a
  // quick pass over the workspaces never flashes close buttons.
  const [closeReady, setCloseReady] = useState(false)
  const hoverTimer = useRef<number | null>(null)
  const clearHoverTimer = (): void => {
    if (hoverTimer.current != null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }
  useEffect(() => clearHoverTimer, [])

  const isDropInto = dragging != null && !isActive && dropTarget === w.id

  const commit = (): void => {
    const v = draft.trim()
    if (v && v !== w.name) rename(w.id, v)
    setEditing(false)
  }

  return (
    <div
      className={clsx(
        'sb-row sb-ws-row',
        isActive && 'active',
        isDropInto && 'drop-into',
        closeReady && 'close-ready'
      )}
      title={`${w.name} — ${paneCount} pane${paneCount !== 1 ? 's' : ''}`}
      onClick={() => {
        if (!editing) switchTo(w.id)
      }}
      onDoubleClick={() => {
        setDraft(w.name)
        setEditing(true)
      }}
      onMouseEnter={() => {
        if (!canClose) return
        clearHoverTimer()
        hoverTimer.current = window.setTimeout(() => setCloseReady(true), 2000)
      }}
      onMouseLeave={() => {
        clearHoverTimer()
        setCloseReady(false)
      }}
      onAuxClick={(e) => {
        // middle-click closes the workspace (like a browser tab)
        if (e.button === 1 && canClose) {
          e.preventDefault()
          remove(w.id)
        }
      }}
      onDragOver={(e) => {
        if (!dragging) return
        e.preventDefault()
        e.stopPropagation()
        if (isActive) {
          // can't move panes into the workspace they already live in
          e.dataTransfer.dropEffect = 'none'
          setDropTarget(null)
        } else {
          e.dataTransfer.dropEffect = 'move'
          setDropTarget(w.id)
        }
      }}
      onDrop={(e) => {
        if (!dragging) return
        e.preventDefault()
        e.stopPropagation()
        if (!isActive) movePanesTo(dragging, w.id)
        setDropTarget(null)
        setDraggingPanes(null)
      }}
    >
      {/* number + close share the same slot — the × fades in over the number */}
      <span className="sb-ico">
        <span className="sb-ws-num">{index + 1}</span>
        {canClose && !editing && (
          <button
            className="sb-ws-close"
            title="Close workspace"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              remove(w.id)
            }}
          >
            <X size={12} />
          </button>
        )}
      </span>
      {editing ? (
        <input
          className="sb-ws-rename"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="sb-label">{w.name}</span>
      )}
      {!editing &&
        (badge > 0 ? (
          <span className="sb-meta">
            <span className="sb-dot-badge">{badge > 9 ? '9+' : badge}</span>
          </span>
        ) : paneCount > 0 ? (
          <span className="sb-meta">
            <span className="sb-count">{paneCount}</span>
          </span>
        ) : null)}
    </div>
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
  const addWorkspace = useWorkspaces((s) => s.add)
  const movePanesToNew = useWorkspaces((s) => s.movePanesToNew)

  const livePaneCount = useWorkspace((s) => Object.keys(s.panes).length)

  const draggingPaneIds = useUi((s) => s.draggingPaneIds)
  const setDraggingPanes = useUi((s) => s.setDraggingPanes)

  const toggleNotes = useUi((s) => s.toggleNotes)
  const toggleCommandPalette = useUi((s) => s.toggleCommandPalette)
  const openSettings = useUi((s) => s.openSettings)

  // Which workspace (or 'new' for the empty drop area) the dragged panes are
  // hovering. Cleared whenever a drag ends (handled globally on `dragend`).
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  useEffect(() => {
    if (!draggingPaneIds) setDropTarget(null)
  }, [draggingPaneIds])

  const canClose = list.length > 1

  return (
    <aside className={clsx('sidebar', pinned && 'pinned')}>
      <div className="sidebar-rail">
        <div className="sb-scroll">
          {/* workspaces — drop a dragged pane on empty space to spin up a new one,
              or onto an existing row to move it there */}
          <Section title="Workspaces" count={list.length} />
          <div
            className={clsx('sb-group sb-ws-group', dropTarget === 'new' && 'drop-new')}
            onDragOver={(e) => {
              if (!draggingPaneIds) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropTarget('new')
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
            }}
            onDrop={(e) => {
              if (!draggingPaneIds) return
              e.preventDefault()
              movePanesToNew(draggingPaneIds)
              setDropTarget(null)
              setDraggingPanes(null)
            }}
          >
            {list.map((w, i) => {
              const isActive = w.id === activeId
              const paneN = isActive ? livePaneCount : Object.keys(w.panes ?? {}).length
              return (
                <WorkspaceRow
                  key={w.id}
                  w={w}
                  index={i}
                  isActive={isActive}
                  paneCount={paneN}
                  badge={badges[w.id] ?? 0}
                  canClose={canClose}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
                  dragging={draggingPaneIds}
                />
              )
            })}
            <Row
              icon={<Plus size={18} />}
              label={draggingPaneIds ? 'Drop here for a new workspace' : 'New workspace'}
              title="New workspace"
              onClick={addWorkspace}
            />
          </div>

          {/* tools */}
          <Section title="Tools" />
          <div className="sb-group">
            <SessionsMenu />
            <Row icon={<NotebookPen size={18} />} label="Notes" onClick={toggleNotes} />
          </div>
        </div>

        {/* footer */}
        <div className="sb-foot">
          <Row
            icon={<CommandIcon size={18} />}
            label="Command palette"
            title="Command palette (Ctrl+Shift+K)"
            onClick={toggleCommandPalette}
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
