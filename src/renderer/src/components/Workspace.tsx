import { forwardRef, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import type { MosaicNode } from 'react-mosaic-component'
import { getLeaves, moveLeafToEdge, type DropEdge } from '@renderer/lib/mosaicTree'
import { confirmPaneClose } from '@renderer/lib/paneClose'

/** Minimum percentage either side of a split may occupy (prevents tiny panes). */
const MIN_SPLIT_PCT = 20

function clampSplits(node: MosaicNode<string> | null): MosaicNode<string> | null {
  if (node === null || typeof node === 'string') return node
  const pct = node.splitPercentage ?? 50
  return {
    ...node,
    splitPercentage: Math.max(MIN_SPLIT_PCT, Math.min(100 - MIN_SPLIT_PCT, pct)),
    first: clampSplits(node.first) as MosaicNode<string>,
    second: clampSplits(node.second) as MosaicNode<string>
  }
}
import { Bot, Terminal, SquareDashed, Send, Columns2, Rows2, X, History, Copy, StickyNote, Radio, Share2, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useBroadcastStore } from '@renderer/store/broadcast'
import { usePaneStatus, type PaneStatus } from '@renderer/store/paneStatus'
import { useUi } from '@renderer/store/ui'
import { useTokens } from '@renderer/store/tokens'
import { useClaudeUsage, formatResetIn } from '@renderer/store/claudeUsage'
import { useSessions } from '@renderer/store/sessions'
import { toast } from '@renderer/store/toasts'
import { getFullText, getScreenText } from '@renderer/lib/terminalPool'
import { answerBlocks } from '@renderer/hooks/useChainForwarding'
import { getAgents, getAvailableAgents, refreshAgentAvailability } from '@renderer/lib/agents'
import { getShellSpecs, refreshWslDistros, type ShellSpec } from '@renderer/lib/shells'
import PaneView from './PaneView'
import { AgentLogo, ShellLogo } from './brandIcons'
import 'react-mosaic-component/react-mosaic-component.css'

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const STATUS_LABEL: Record<PaneStatus, string> = {
  working: 'Working',
  awaiting: 'Awaiting',
  idle: 'Idle'
}

function PaneIcon({ paneId, size = 14 }: { paneId: string; size?: number }): JSX.Element {
  const type = useWorkspace((s) => s.panes[paneId]?.type)
  const command = useWorkspace((s) => s.panes[paneId]?.agent?.command)
  const shell = useWorkspace((s) => s.panes[paneId]?.shell?.shell)
  const args = useWorkspace((s) => s.panes[paneId]?.shell?.args)
  const status = usePaneStatus((s) => s.status[paneId]) ?? 'idle'
  // AI panes: the logo itself carries the turn status as a colored glow
  // (Working = blue, Awaiting = orange, Idle = green) — replaces the old dot.
  if (type === 'ai')
    return (
      <span className="pane-logo" title={`Agent: ${STATUS_LABEL[status]}`}>
        <AgentLogo command={command ?? 'claude'} size={size} />
      </span>
    )
  if (type === 'shell') return <ShellLogo shell={shell} args={args} size={size} />
  return <SquareDashed size={size} className="pane-icon" />
}

function PaneStatus({ paneId }: { paneId: string }): JSX.Element | null {
  const pane = useWorkspace((s) => s.panes[paneId])
  if (!pane) return null
  if (pane.type === 'shell') {
    if (!pane.shell?.ptyId) return <span className="pane-loading" title="Connecting…" />
    const name = pane.shell.shell.split(/[\\/]/).pop()?.replace(/\.exe$/i, '')
    return <span className="pane-status">{name}</span>
  }
  return null
}

const EMPTY_IDS: string[] = []

/**
 * A header button whose popover is portalled to <body>, so it isn't clipped by
 * the mosaic window's `overflow: hidden` (which made the old in-pane popovers
 * render behind neighbouring panes). Supports hover- or click-triggering.
 */
function HeaderPopover({
  icon,
  title,
  active,
  hover,
  badge,
  render
}: {
  icon: JSX.Element
  title: string
  active?: boolean
  hover?: boolean
  /** small count shown over the button (e.g. open to-do items) */
  badge?: number
  render: (close: () => void) => JSX.Element
}): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number>(0)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })

  const place = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }
  const openNow = (): void => {
    window.clearTimeout(closeTimer.current)
    place()
    setOpen(true)
  }
  const closeSoon = (): void => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 160)
  }
  const close = (): void => setOpen(false)

  useEffect(() => {
    if (!open || hover) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, hover])

  const stop = (e: React.MouseEvent): void => e.stopPropagation()

  return (
    <>
      <button
        ref={btnRef}
        className={clsx('icon-btn', (open || active) && 'active')}
        title={title}
        onMouseDown={stop}
        onClick={hover ? undefined : () => (open ? close() : openNow())}
        onMouseEnter={hover ? openNow : undefined}
        onMouseLeave={hover ? closeSoon : undefined}
      >
        {icon}
        {badge ? <span className="header-popover-badge">{badge > 9 ? '9+' : badge}</span> : null}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="header-popover"
            style={{ top: pos.top, right: pos.right }}
            onMouseDown={stop}
            onMouseEnter={hover ? openNow : undefined}
            onMouseLeave={hover ? closeSoon : undefined}
          >
            {render(close)}
          </div>,
          document.body
        )}
    </>
  )
}

/** A target action set for one section of the connect menu (pipe or broadcast). */
interface ConnSection {
  label: string
  selected: string[]
  onToggle: (id: string) => void
  onAll: (ids: string[]) => void
  onClear: () => void
}

/**
 * Single header button combining "pipe output to…" and "broadcast input to…".
 * One popover, two labeled sections — both pick from the other panes in the
 * workspace, so they're merged behind one Share2 icon (with a total count dot).
 */
function PaneConnectMenu({
  selfId,
  sections
}: {
  selfId: string
  sections: ConnSection[]
}): JSX.Element {
  const layout = useWorkspace((s) => s.layout)
  const panes = useWorkspace((s) => s.panes)
  const leaves = getLeaves(layout)
  const others = leaves.filter((id) => id !== selfId)
  const total = sections.reduce((n, s) => n + s.selected.length, 0)

  return (
    <HeaderPopover
      icon={
        <span className="pane-conn-trigger">
          <Share2 size={13} />
          {total > 0 && <span className="pane-conn-dot">{total}</span>}
        </span>
      }
      title="Connect panes — pipe output / broadcast input"
      active={total > 0}
      hover
      render={() => (
        <div className="pane-conn">
          {others.length === 0 ? (
            <div className="pane-conn-empty">No other panes</div>
          ) : (
            sections.map((sec) => {
              const allOn = others.every((id) => sec.selected.includes(id))
              return (
                <div className="pane-conn-section" key={sec.label}>
                  <div className="pane-conn-head">{sec.label}</div>
                  <button
                    className={clsx('pane-conn-row', allOn && 'on')}
                    onClick={() => (allOn ? sec.onClear() : sec.onAll(others))}
                  >
                    <span className="pane-conn-check">{allOn ? '✓' : ''}</span>
                    <span className="pane-conn-name">All panes</span>
                  </button>
                  {others.map((id) => {
                    const on = sec.selected.includes(id)
                    return (
                      <button
                        key={id}
                        className={clsx('pane-conn-row', on && 'on')}
                        onClick={() => sec.onToggle(id)}
                      >
                        <span className="pane-conn-check">{on ? '✓' : ''}</span>
                        <span className="pane-conn-num">{leaves.indexOf(id) + 1}</span>
                        <span className="pane-conn-name">{panes[id]?.title ?? id}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      )}
    />
  )
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
  const paneType = useWorkspace((s) => s.panes[paneId]?.type)
  const layout = useWorkspace((s) => s.layout)
  const paneCount = useWorkspace((s) => Object.keys(s.panes).length)
  const leaves = getLeaves(layout)
  const paneNum = leaves.indexOf(paneId) + 1  // 1-based; 0 = not in layout yet
  const agentCwd = useWorkspace((s) => s.panes[paneId]?.agent?.cwd)
  const agentCommand = useWorkspace((s) => s.panes[paneId]?.agent?.command)
  const shellCwd = useWorkspace((s) => s.panes[paneId]?.shell?.cwd)
  const agentStatus = usePaneStatus((s) => s.status[paneId]) ?? 'idle'
  const isActive = useTokens((s) => !!s.activePanes[paneId])
  // Account-global Claude usage (real `/usage` numbers) — shown only in claude panes.
  const isClaude = agentCommand === 'claude'
  const claudeUsage = useClaudeUsage((s) => (isClaude && s.ok ? s : null))
  const broadcastOn = useBroadcastStore((s) => s.enabled)
  const isBroadcastSource = useWorkspace((s) => s.activePaneId === paneId)
  const isBroadcastMember = useBroadcastStore((s) => s.members.includes(paneId))
  const inBroadcast = broadcastOn && (isBroadcastSource || isBroadcastMember)
  const updatePane = useWorkspace((s) => s.updatePane)
  const duplicatePane = useWorkspace((s) => s.duplicatePane)
  const removePane = useWorkspace((s) => s.removePane)
  const openTerminalHere = useWorkspace((s) => s.openTerminalHere)
  const openAgentHere = useWorkspace((s) => s.openAgentHere)
  const setActive = useWorkspace((s) => s.setActive)
  const togglePaneSelected = useWorkspace((s) => s.togglePaneSelected)
  const selected = useWorkspace((s) => s.selectedPaneIds.includes(paneId))
  const setLinkingPaneId = useUi((s) => s.setLinkingPaneId)
  const setDraggingPanes = useUi((s) => s.setDraggingPanes)
  const toggleZoom = useUi((s) => s.toggleZoom)

  const notes = useWorkspace((s) => s.panes[paneId]?.notes)
  const todos = useWorkspace((s) => s.panes[paneId]?.todos)
  const pipeTargets = useWorkspace((s) => s.panes[paneId]?.pipeTargets) ?? EMPTY_IDS
  const togglePipeTarget = useWorkspace((s) => s.togglePipeTarget)
  const setPipeTargets = useWorkspace((s) => s.setPipeTargets)
  const broadcastMembers = useBroadcastStore((s) => s.members)
  const toggleBroadcastMember = useBroadcastStore((s) => s.toggleMember)
  const setBroadcastMembers = useBroadcastStore((s) => s.setMembers)
  const setBroadcastEnabled = useBroadcastStore((s) => s.setEnabled)
  const hasOtherPanes = leaves.length >= 2
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [todoDraft, setTodoDraft] = useState('')

  // ---- pane to-do list helpers (stored on the pane, persisted with it) ----
  const addTodo = (): void => {
    const text = todoDraft.trim()
    if (!text) return
    const item = { id: crypto.randomUUID(), text, done: false }
    updatePane(paneId, { todos: [...(todos ?? []), item] })
    setTodoDraft('')
  }
  const toggleTodo = (id: string): void =>
    updatePane(paneId, {
      todos: (todos ?? []).map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    })
  const removeTodo = (id: string): void => {
    const next = (todos ?? []).filter((t) => t.id !== id)
    updatePane(paneId, { todos: next.length ? next : undefined })
  }
  const openTodos = (todos ?? []).filter((t) => !t.done).length

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
    void (async () => {
      if (!(await confirmPaneClose(paneId))) return
      window.api.linkPaneToTelegram(paneId, null)
      removePane(paneId)
    })()
  }

  // Copy the agent's last answer block to the clipboard. Falls back to the
  // visible screen text for agents whose output isn't in ● answer blocks.
  const copyLastResult = (): void => {
    const blocks = answerBlocks(getFullText(paneId))
    const last = blocks.length ? blocks[blocks.length - 1] : getScreenText(paneId).trim()
    if (!last) {
      toast('No result to copy yet', 'info')
      return
    }
    void navigator.clipboard
      .writeText(last)
      .then(() => toast('Copied last result', 'ok'))
      .catch(() => toast('Copy failed', 'error'))
  }

  const stop = (e: React.MouseEvent): void => e.stopPropagation()

  return (
    <div
      ref={ref}
      className={clsx('pane-header', activePaneId === paneId && 'active', selected && 'selected')}
      // The header is always a native drag source for moving panes across
      // workspaces (react-mosaic's own header drag is disabled — see
      // draggable={false} on MosaicWindow — so native drops on the title bar /
      // tabs fire reliably). Dragging an unselected pane moves just that one;
      // dragging a selected pane moves the whole selection. Disabled while
      // renaming so text selection in the title input still works.
      draggable={!editing}
      onDragStart={(e) => {
        e.stopPropagation()
        const sel = useWorkspace.getState().selectedPaneIds
        const ids = sel.includes(paneId) ? sel : [paneId]
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', `${ids.length} pane${ids.length !== 1 ? 's' : ''}`)
        setDraggingPanes(ids)
      }}
      onDragEnd={() => setDraggingPanes(null)}
      onMouseDown={() => setActive(paneId)}
      // double-click the header's empty space to maximize the pane, again to restore
      onDoubleClick={() => toggleZoom(paneId)}
      // right-click toggles the pane into the group-move selection
      onContextMenu={(e) => {
        e.preventDefault()
        togglePaneSelected(paneId)
      }}
      onAuxClick={(e) => {
        // middle-click anywhere on the header (like a browser tab) closes it
        if (e.button === 1) {
          e.preventDefault()
          close()
        }
      }}
    >
      {paneCount >= 2 && paneNum > 0 && (
        <span
          className={clsx('pane-num', paneType === 'ai' && `is-${agentStatus}`)}
          title={paneType === 'ai' ? `Pane ${paneNum} · ${STATUS_LABEL[agentStatus]}` : `Pane ${paneNum}`}
        >
          {paneNum}
        </span>
      )}
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
        // Hide the title for AI panes whose name is just the agent command
        // (the logo already identifies the agent). Custom-renamed panes still show.
        (paneType !== 'ai' || title !== agentCommand) && (
          <span
            className="pane-title"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation()
              startEdit()
            }}
          >
            {title}
          </span>
        )
      )}
      {paneType === 'ai' && agentCwd && (
        <>
          <span
            className={clsx('pane-cwd', 'clickable', isActive && 'active')}
            title={`Open folder\n${agentCwd}`}
            onClick={(e) => {
              e.stopPropagation()
              void window.api.openPath(agentCwd)
            }}
          >
            {agentCwd}
          </span>
          {claudeUsage?.fiveHour && (
            <span
              className={clsx(
                'pane-usage',
                claudeUsage.fiveHour.percent >= 80 && 'high',
                claudeUsage.fiveHour.percent >= 95 && 'over'
              )}
              title={
                `Claude 5-hour usage: ${claudeUsage.fiveHour.percent}% · resets in ${formatResetIn(claudeUsage.fiveHour.resetInMs)}` +
                (claudeUsage.sevenDay
                  ? `\n7-day usage: ${claudeUsage.sevenDay.percent}% · resets in ${formatResetIn(claudeUsage.sevenDay.resetInMs)}`
                  : '')
              }
            >
              {claudeUsage.fiveHour.percent}% · {formatResetIn(claudeUsage.fiveHour.resetInMs)}
            </span>
          )}
        </>
      )}
      {inBroadcast && (
        <span
          className="pane-broadcast-tag"
          title={isBroadcastSource ? 'Broadcast source' : 'Receives broadcast input'}
        >
          <Radio size={11} />
          {isBroadcastSource ? 'src' : 'bc'}
        </span>
      )}
      <PaneStatus paneId={paneId} />
      <div className="pane-header-spacer" />
      <div className="pane-controls" onMouseDown={stop} onDoubleClick={stop}>
        <HeaderPopover
          icon={
            <StickyNote
              size={13}
              style={notes || todos?.length ? { color: 'var(--accent)' } : undefined}
            />
          }
          title={notes || todos?.length ? 'Notes & to-do' : 'Add a note or to-do'}
          active={!!notes || !!todos?.length}
          badge={openTodos || undefined}
          render={() => (
            <div className="pane-notes">
              <textarea
                className="pane-notes-text"
                rows={5}
                placeholder="Notes for this pane…"
                value={notes ?? ''}
                onChange={(e) => updatePane(paneId, { notes: e.target.value || undefined })}
              />

              <div className="pane-todos">
                {(todos ?? []).map((t) => (
                  <div key={t.id} className={clsx('pane-todo', t.done && 'done')}>
                    <input
                      type="checkbox"
                      className="pane-todo-check"
                      checked={t.done}
                      onChange={() => toggleTodo(t.id)}
                    />
                    <span className="pane-todo-text" onClick={() => toggleTodo(t.id)}>
                      {t.text}
                    </span>
                    <button
                      className="icon-btn pane-todo-del"
                      title="Remove item"
                      onClick={() => removeTodo(t.id)}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <div className="pane-todo-add">
                  <input
                    className="pane-todo-input"
                    placeholder="Add a to-do…"
                    value={todoDraft}
                    onChange={(e) => setTodoDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addTodo()
                    }}
                  />
                  <button className="icon-btn" title="Add to-do" onClick={addTodo}>
                    <Plus size={12} />
                  </button>
                </div>
              </div>

              <span className="pane-notes-hint">Saved automatically</span>
            </div>
          )}
        />
        {hasOtherPanes && (
          <PaneConnectMenu
            selfId={paneId}
            sections={[
              {
                label: 'Pipe output to…',
                selected: pipeTargets,
                onToggle: (id) => togglePipeTarget(paneId, id),
                onAll: (ids) => setPipeTargets(paneId, ids),
                onClear: () => setPipeTargets(paneId, [])
              },
              {
                label: 'Broadcast input to…',
                selected: broadcastMembers.filter((m) => m !== paneId),
                onToggle: (id) => {
                  toggleBroadcastMember(id)
                  setBroadcastEnabled(true)
                },
                onAll: (ids) => {
                  setBroadcastMembers(ids)
                  setBroadcastEnabled(true)
                },
                onClear: () => {
                  setBroadcastMembers([])
                  setBroadcastEnabled(false)
                }
              }
            ]}
          />
        )}
        {paneType === 'ai' && agentCwd && (
          <button
            className="icon-btn"
            title="Copy last result"
            onClick={copyLastResult}
          >
            <Copy size={13} />
          </button>
        )}
        {paneType === 'ai' && agentCwd && (
          <button
            className="icon-btn"
            title={`Open terminal here · Ctrl+Shift+O\n${agentCwd}`}
            onClick={() => openTerminalHere(paneId)}
          >
            <Terminal size={13} />
          </button>
        )}
        {paneType === 'shell' && (
          <button
            className="icon-btn"
            title={`Open agent in this folder${shellCwd ? `\n${shellCwd}` : ' (home)'}`}
            onClick={() => openAgentHere(paneId)}
          >
            <Bot size={13} />
          </button>
        )}
        <button
          className={clsx('icon-btn', linked && 'linked')}
          title="Link to Telegram"
          onClick={() => setLinkingPaneId(paneId)}
        >
          <Send size={13} />
        </button>
        <button
          className="icon-btn"
          title={paneCount >= 9 ? 'Max 9 panes reached' : 'Split right (duplicate session)'}
          disabled={paneCount >= 9}
          onClick={() => duplicatePane(paneId, 'row')}
        >
          <Columns2 size={13} />
        </button>
        <button
          className="icon-btn"
          title={paneCount >= 9 ? 'Max 9 panes reached' : 'Split down (duplicate session)'}
          disabled={paneCount >= 9}
          onClick={() => duplicatePane(paneId, 'column')}
        >
          <Rows2 size={13} />
        </button>
        <button className="icon-btn danger" title="Close (Ctrl+W)" onClick={close}>
          <X size={13} />
        </button>
      </div>
    </div>
  )
})

/**
 * Edge drop zones overlaid on each pane while another pane is being dragged
 * within the same workspace. Dropping on an edge slots the dragged pane in
 * next to this one in the layout (top/bottom → column split, left/right → row
 * split). React-mosaic's own drag is disabled because the pane header is our
 * native cross-workspace drag source — these zones replace its intra-workspace
 * drop behaviour. Cross-workspace title-bar drops still work because they
 * sit outside this overlay.
 */
function InPaneDropZones({ paneId }: { paneId: string }): JSX.Element | null {
  const draggingPaneIds = useUi((s) => s.draggingPaneIds)
  const setDraggingPanes = useUi((s) => s.setDraggingPanes)
  const layout = useWorkspace((s) => s.layout)
  const setLayout = useWorkspace((s) => s.setLayout)
  const [hover, setHover] = useState<DropEdge | null>(null)
  if (!draggingPaneIds || draggingPaneIds.length === 0) return null
  // Don't show on a pane that's itself being dragged (or whose group is being dragged).
  if (draggingPaneIds.includes(paneId)) return null

  // Pick the edge whose perpendicular distance from the cursor is smallest:
  // top/bottom use vertical distance, left/right use horizontal — so each edge
  // owns the full-length band closest to it (corners broken by whichever axis
  // the cursor is nearer to).
  const edgeFromEvent = (e: React.DragEvent): DropEdge => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const dTop = y
    const dBottom = r.height - y
    const dLeft = x
    const dRight = r.width - x
    const min = Math.min(dTop, dBottom, dLeft, dRight)
    if (min === dTop) return 'top'
    if (min === dBottom) return 'bottom'
    if (min === dLeft) return 'left'
    return 'right'
  }

  return (
    <div
      className="pane-drop-overlay"
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        const next = edgeFromEvent(e)
        if (next !== hover) setHover(next)
      }}
      onDragLeave={() => setHover(null)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const edge = edgeFromEvent(e)
        setHover(null)
        const draggedId = draggingPaneIds.find((id) => id !== paneId)
        if (draggedId) setLayout(moveLeafToEdge(layout, draggedId, paneId, edge))
        setDraggingPanes(null)
      }}
    >
      {hover && <div className={clsx('pane-drop-preview', hover)} />}
    </div>
  )
}

export default function Workspace(): JSX.Element {
  const layout = useWorkspace((s) => s.layout)
  const setLayout = useWorkspace((s) => s.setLayout)
  const panes = useWorkspace((s) => s.panes)
  const addPane = useWorkspace((s) => s.addPane)
  const zoomedPaneId = useUi((s) => s.zoomedPaneId)
  const setZoomedPaneId = useUi((s) => s.setZoomedPaneId)
  const sessions = useSessions((s) => s.sessions)
  const restore = useSessions((s) => s.restore)

  // Device-installed agents + shells/WSL distros, detected asynchronously.
  const [agents, setAgents] = useState(getAgents())
  const [availAgents, setAvailAgents] = useState<Set<string>>(getAvailableAgents())
  const [shellSpecs, setShellSpecs] = useState<ShellSpec[]>(getShellSpecs())
  useEffect(() => {
    void refreshAgentAvailability().then((s) => {
      setAgents([...getAgents()])
      setAvailAgents(new Set(s))
    })
    void refreshWslDistros().then(() => setShellSpecs(getShellSpecs()))
  }, [])

  if (layout === null) {
    const recentSessions = sessions.slice(0, 4)
    const agentList = agents // show all; uninstalled render greyed for discoverability
    return (
      <div className="workspace-empty">
        <div className="empty-hero">
          <div className="empty-icon-wrap">
            <Bot size={28} strokeWidth={1.3} />
          </div>
          <h2 className="empty-title">URterminal</h2>
          <p className="empty-sub">AI agent + shell workspace</p>
        </div>
        <div className="empty-actions">
          <button className="empty-action-card agent" onClick={() => addPane('ai')}>
            <Bot size={18} strokeWidth={1.4} className="eac-icon" />
            <span className="eac-label">Agent</span>
            <span className="eac-hint">Claude Code session</span>
            <span className="eac-key">Ctrl+Shift+A</span>
          </button>
          <button className="empty-action-card shell" onClick={() => addPane('shell')}>
            <Terminal size={18} strokeWidth={1.4} className="eac-icon" />
            <span className="eac-label">Shell</span>
            <span className="eac-hint">Interactive terminal</span>
            <span className="eac-key">Ctrl+Shift+S</span>
          </button>
        </div>

        <div className="empty-discover">
          <div className="empty-disc-group">
            <div className="empty-disc-title">Agents on this device</div>
            <div className="empty-chips">
              {agentList.map((a) => {
                const unavailable = availAgents.size > 0 && !availAgents.has(a.id)
                return (
                  <button
                    key={a.id}
                    className={clsx('empty-chip', unavailable && 'unavailable')}
                    title={unavailable ? `${a.label} — not installed (opens setup)` : `New ${a.label} pane`}
                    onClick={() => addPane('ai', undefined, { agentCommand: a.id, label: a.label })}
                  >
                    <AgentLogo command={a.id} size={15} />
                    {a.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="empty-disc-group">
            <div className="empty-disc-title">Shells &amp; WSL distros</div>
            <div className="empty-chips">
              {shellSpecs.map((spec) => (
                <button
                  key={spec.id}
                  className="empty-chip"
                  title={`New ${spec.label}`}
                  onClick={() =>
                    addPane('shell', undefined, {
                      shell: spec.file,
                      shellArgs: spec.args,
                      label: spec.label
                    })
                  }
                >
                  <ShellLogo shell={spec.file} args={spec.args} size={15} />
                  {spec.label}
                </button>
              ))}
            </div>
          </div>

          <div className="empty-disc-group">
            <div className="empty-disc-title">Things you can do</div>
            <ul className="empty-tips">
              <li>Split & tile up to 9 panes — drag borders to resize</li>
              <li>Link any pane to Telegram, or screenshot it with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd></li>
              <li>Open an agent in a shell's folder (and vice-versa) from the pane header</li>
              <li>Save & restore whole workspaces as sessions</li>
            </ul>
          </div>
        </div>

        {recentSessions.length > 0 && (
          <div className="empty-sessions">
            <div className="es-header">
              <History size={13} />
              <span>Recent sessions</span>
            </div>
            <div className="es-list">
              {recentSessions.map(s => (
                <button
                  key={s.id}
                  className="es-row"
                  onClick={() => { restore(s.id); toast(`Restored: ${s.name}`, 'ok') }}
                >
                  <span className="es-name">{s.name}</span>
                  <span className="es-meta">{s.paneCount} pane{s.paneCount !== 1 ? 's' : ''} · {relTime(s.savedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="empty-footer">
          <span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> command palette</span>
        </div>
      </div>
    )
  }

  // Zoom: render only the focused pane, full-bleed.
  if (zoomedPaneId && panes[zoomedPaneId]) {
    return (
      <div className="zoom-host">
        <div className="zoom-pane">
          <PaneHeader paneId={zoomedPaneId} />
          <div className="zoom-body pane-capture" data-pane-id={zoomedPaneId}>
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
      className="mosaic-urterminal"
      value={layout}
      onChange={(node: MosaicNode<string> | null) => setLayout(clampSplits(node))}
      renderTile={(id, path) => (
        <MosaicWindow<string>
          path={path}
          title={panes[id]?.title ?? id}
          // Disable react-mosaic's header drag — the pane header is our own
          // native cross-workspace drag source instead, so native drops on the
          // title bar / workspace tabs fire without react-dnd intercepting them.
          draggable={false}
          renderToolbar={() => (
            <div className="pane-header-host">
              <PaneHeader paneId={id} />
            </div>
          )}
        >
          <div className="pane-capture" data-pane-id={id}>
            <PaneView paneId={id} />
            <InPaneDropZones paneId={id} />
          </div>
        </MosaicWindow>
      )}
    />
  )
}
