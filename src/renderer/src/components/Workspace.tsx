import { forwardRef, useState } from 'react'
import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import type { MosaicNode } from 'react-mosaic-component'
import { Bot, Terminal, SquareDashed, Send, Columns2, Rows2, Maximize2, Minimize2, X } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'
import PaneView from './PaneView'
import 'react-mosaic-component/react-mosaic-component.css'

function PaneIcon({ paneId, size = 14 }: { paneId: string; size?: number }): JSX.Element {
  const type = useWorkspace((s) => s.panes[paneId]?.type)
  if (type === 'ai') return <Bot size={size} className="pane-icon ai" />
  if (type === 'shell') return <Terminal size={size} className="pane-icon shell" />
  return <SquareDashed size={size} className="pane-icon" />
}

function PaneStatus({ paneId }: { paneId: string }): JSX.Element | null {
  const pane = useWorkspace((s) => s.panes[paneId])
  if (!pane) return null
  if (pane.type === 'ai') {
    return pane.agent?.ptyId ? (
      <span className="pane-status streaming">
        <span className="pulse" /> live
      </span>
    ) : null
  }
  if (pane.type === 'shell' && pane.shell?.shell) {
    const name = pane.shell.shell.split(/[\\/]/).pop()?.replace(/\.exe$/i, '')
    return <span className="pane-status">{name}</span>
  }
  return null
}

/**
 * Slim, custom replacement for the default mosaic toolbar (also the drag handle).
 * Must forward a ref to a native element: react-mosaic attaches the React-DnD
 * drag-source ref to whatever `renderToolbar` returns.
 */
const PaneHeader = forwardRef<HTMLDivElement, { paneId: string }>(function PaneHeader(
  { paneId },
  ref
): JSX.Element {
  const title = useWorkspace((s) => s.panes[paneId]?.title ?? paneId)
  const linked = useWorkspace((s) => !!s.panes[paneId]?.telegramChatId)
  const activePaneId = useWorkspace((s) => s.activePaneId)
  const updatePane = useWorkspace((s) => s.updatePane)
  const duplicatePane = useWorkspace((s) => s.duplicatePane)
  const removePane = useWorkspace((s) => s.removePane)
  const setActive = useWorkspace((s) => s.setActive)
  const setLinkingPaneId = useUi((s) => s.setLinkingPaneId)
  const toggleZoom = useUi((s) => s.toggleZoom)
  const zoomed = useUi((s) => s.zoomedPaneId === paneId)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  const commit = (): void => {
    const v = draft.trim()
    if (v) updatePane(paneId, { title: v })
    setEditing(false)
  }
  const startEdit = (): void => {
    setDraft(title)
    setEditing(true)
  }

  const close = (): void => {
    window.api.linkPaneToTelegram(paneId, null)
    removePane(paneId)
  }

  const stop = (e: React.MouseEvent): void => e.stopPropagation()

  return (
    <div
      ref={ref}
      className={clsx('pane-header', activePaneId === paneId && 'active')}
      onMouseDown={() => setActive(paneId)}
      onAuxClick={(e) => {
        // middle-click anywhere on the header (like a browser tab) closes it
        if (e.button === 1) {
          e.preventDefault()
          close()
        }
      }}
    >
      <PaneIcon paneId={paneId} />
      {editing ? (
        <input
          className="pane-title-edit"
          autoFocus
          value={draft}
          onMouseDown={stop}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="pane-title" title="Double-click to rename" onDoubleClick={startEdit}>
          {title}
        </span>
      )}
      <PaneStatus paneId={paneId} />
      <div className="pane-header-spacer" />
      <div className="pane-controls" onMouseDown={stop}>
        <button
          className={clsx('icon-btn', linked && 'linked')}
          title="Link to Telegram"
          onClick={() => setLinkingPaneId(paneId)}
        >
          <Send size={13} />
        </button>
        <button
          className="icon-btn"
          title="Split right (duplicate session)"
          onClick={() => duplicatePane(paneId, 'row')}
        >
          <Columns2 size={13} />
        </button>
        <button
          className="icon-btn"
          title="Split down (duplicate session)"
          onClick={() => duplicatePane(paneId, 'column')}
        >
          <Rows2 size={13} />
        </button>
        <button
          className="icon-btn"
          title={zoomed ? 'Restore (Ctrl+Shift+Enter)' : 'Maximize (Ctrl+Shift+Enter)'}
          onClick={() => toggleZoom(paneId)}
        >
          {zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button className="icon-btn danger" title="Close (Ctrl+W)" onClick={close}>
          <X size={13} />
        </button>
      </div>
    </div>
  )
})

export default function Workspace(): JSX.Element {
  const layout = useWorkspace((s) => s.layout)
  const setLayout = useWorkspace((s) => s.setLayout)
  const panes = useWorkspace((s) => s.panes)
  const addPane = useWorkspace((s) => s.addPane)
  const zoomedPaneId = useUi((s) => s.zoomedPaneId)
  const setZoomedPaneId = useUi((s) => s.setZoomedPaneId)

  if (layout === null) {
    return (
      <div className="workspace-empty">
        <Bot size={34} strokeWidth={1.4} className="empty-glyph" />
        <p>Spin up a pane to get started.</p>
        <div className="empty-pane-actions">
          <button className="btn primary" onClick={() => addPane('ai')}>
            + Agent
          </button>
          <button className="btn" onClick={() => addPane('shell')}>
            + Shell
          </button>
        </div>
        <span className="empty-hint">
          Press <kbd>Ctrl</kbd>+<kbd>K</kbd> for the command palette
        </span>
      </div>
    )
  }

  // Zoom: render only the focused pane, full-bleed.
  if (zoomedPaneId && panes[zoomedPaneId]) {
    return (
      <div className="zoom-host">
        <div className="zoom-pane">
          <PaneHeader paneId={zoomedPaneId} />
          <div className="zoom-body">
            <PaneView paneId={zoomedPaneId} />
          </div>
        </div>
        <button className="zoom-exit btn sm" onClick={() => setZoomedPaneId(null)}>
          Exit zoom · Esc
        </button>
      </div>
    )
  }

  return (
    <Mosaic<string>
      className="mosaic-uregant"
      value={layout}
      onChange={(node: MosaicNode<string> | null) => setLayout(node)}
      renderTile={(id, path) => (
        <MosaicWindow<string>
          path={path}
          title={panes[id]?.title ?? id}
          renderToolbar={() => (
            <div className="pane-header-host">
              <PaneHeader paneId={id} />
            </div>
          )}
        >
          <PaneView paneId={id} />
        </MosaicWindow>
      )}
    />
  )
}
