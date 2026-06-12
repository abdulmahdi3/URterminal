import { useEffect, useState } from 'react'
import { Boxes, X, ArrowLeft, GitBranch, Network, CheckSquare, Square, Ship, Terminal, Bot } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toasts'
import { ROOMS, SHIP_CHECKS, type RoomBlueprint } from '@renderer/lib/rooms'
import type { GitStatus, BridgeNote } from '@shared/types'

function activeCwd(): string {
  const s = useWorkspace.getState()
  const p = s.activePaneId ? s.panes[s.activePaneId] : null
  return p?.agent?.cwd || p?.shell?.cwd || p?.stream?.cwd || ''
}

/** Open a room's panes (role shells / agents) in the current workspace. */
function enterRoom(b: RoomBlueprint, cwd: string): void {
  const ws = useWorkspace.getState()
  for (const spec of b.panes) {
    if (spec.kind === 'ai') {
      ws.addPane('ai', undefined, { agentCommand: 'claude', agentCwd: cwd || undefined, label: spec.label })
    } else {
      const id = ws.addPane('shell', undefined, { label: spec.label })
      if (id) ws.updatePane(id, { shell: { shell: '', cwd: cwd || undefined }, title: spec.label })
    }
  }
}

const RoleIcon = ({ kind }: { kind: 'shell' | 'ai' }): JSX.Element =>
  kind === 'ai' ? <Bot size={12} /> : <Terminal size={12} />

/**
 * Rooms — focused workspace presets. Command Room lays out role-labeled shells,
 * Swarm Room spins up builder/reviewer/scout agents, and Review Room gathers the
 * git diff, captured notes and a ship checklist so you can decide what ships.
 */
export default function RoomsModal(): JSX.Element | null {
  const show = useUi((s) => s.showRooms)
  const setShow = useUi((s) => s.setShowRooms)
  const [cwd, setCwd] = useState('')
  const [view, setView] = useState<'pick' | 'review'>('pick')
  const [git, setGit] = useState<GitStatus | null>(null)
  const [notes, setNotes] = useState<BridgeNote[]>([])
  const [checks, setChecks] = useState<boolean[]>(() => SHIP_CHECKS.map(() => false))

  useEffect(() => {
    if (!show) return
    const c = activeCwd()
    setCwd(c)
    setView('pick')
  }, [show])

  const loadReview = async (c: string): Promise<void> => {
    setView('review')
    try {
      const saved = JSON.parse(localStorage.getItem(`room-ship:${c}`) || 'null')
      setChecks(Array.isArray(saved) && saved.length === SHIP_CHECKS.length ? saved : SHIP_CHECKS.map(() => false))
    } catch {
      setChecks(SHIP_CHECKS.map(() => false))
    }
    if (c) {
      window.api.gitStatus(c).then(setGit).catch(() => setGit(null))
      window.api.bridge.list(c).then((r) => setNotes(r.notes.slice(0, 6))).catch(() => setNotes([]))
    }
  }

  if (!show) return null
  const close = (): void => setShow(false)

  const open = (b: RoomBlueprint): void => {
    if (b.id === 'review') {
      void loadReview(cwd)
      return
    }
    enterRoom(b, cwd)
    toast(`${b.name} ready`, 'ok')
    close()
  }

  const toggleCheck = (i: number): void => {
    const next = checks.map((v, j) => (j === i ? !v : v))
    setChecks(next)
    try {
      localStorage.setItem(`room-ship:${cwd}`, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }
  const ready = checks.every(Boolean)

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal rooms" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="rooms-title">
            {view === 'review' ? (
              <button className="icon-btn" onClick={() => setView('pick')} title="Back">
                <ArrowLeft size={15} />
              </button>
            ) : (
              <Boxes size={16} />
            )}
            <span>{view === 'review' ? 'Review Room' : 'Rooms'}</span>
          </div>
          <button className="icon-btn" onClick={close} title="Close">
            <X size={14} />
          </button>
        </div>

        {view === 'pick' ? (
          <div className="modal-body rooms-grid">
            {ROOMS.map((r) => (
              <div key={r.id} className="room-card">
                <div className="room-card-name">{r.name}</div>
                <div className="room-card-tag">{r.tagline}</div>
                <div className="room-card-roles">
                  {r.roles.map((role) => (
                    <div key={role.label} className="room-role">
                      {r.panes.length ? (
                        <RoleIcon kind={r.panes.find((p) => p.label === role.label)?.kind ?? 'shell'} />
                      ) : (
                        <span className="room-role-dot" />
                      )}
                      <span className="room-role-label">{role.label}</span>
                      <span className="room-role-hint">{role.hint}</span>
                    </div>
                  ))}
                </div>
                <button className="btn primary room-enter" onClick={() => open(r)}>
                  {r.id === 'review' ? 'Open panel' : 'Enter room'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="modal-body rooms-review">
            {!cwd && <div className="bridge-hint">Focus a pane in a folder to see its review context.</div>}
            <div className="rr-section">
              <div className="rr-head">
                <GitBranch size={13} /> Files changed
              </div>
              {git ? (
                <div className="rr-git">
                  <span className="rr-branch">{git.branch}</span>
                  {git.ahead > 0 && <span className="rr-chip">↑{git.ahead}</span>}
                  {git.behind > 0 && <span className="rr-chip">↓{git.behind}</span>}
                  <span className="rr-chip staged">+{git.staged} staged</span>
                  <span className="rr-chip unstaged">~{git.unstaged} changed</span>
                  <span className="rr-chip untracked">?{git.untracked} new</span>
                </div>
              ) : (
                <div className="rr-empty">{cwd ? 'Not a git repo (or clean).' : '—'}</div>
              )}
            </div>

            <div className="rr-section">
              <div className="rr-head">
                <Network size={13} /> Notes captured
              </div>
              {notes.length ? (
                <div className="rr-notes">
                  {notes.map((n) => (
                    <button key={n.slug} className="rr-note" onClick={() => useUi.getState().setShowBridge(true)}>
                      {n.title}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rr-empty">No BridgeMemory notes yet.</div>
              )}
            </div>

            <div className="rr-section">
              <div className="rr-head">
                <Ship size={13} /> Ship decision
              </div>
              <div className="rr-checks">
                {SHIP_CHECKS.map((label, i) => (
                  <button key={label} className="rr-check" onClick={() => toggleCheck(i)}>
                    {checks[i] ? <CheckSquare size={14} className="on" /> : <Square size={14} />}
                    {label}
                  </button>
                ))}
              </div>
              <div className={`rr-verdict ${ready ? 'go' : ''}`}>
                {ready ? '✓ Ready to ship' : `${checks.filter(Boolean).length}/${SHIP_CHECKS.length} checks`}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
