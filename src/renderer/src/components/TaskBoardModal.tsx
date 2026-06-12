import { useEffect, useState } from 'react'
import { ClipboardList, X, Plus, ChevronLeft, ChevronRight, Rocket, Trash2 } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toasts'
import { seedPrompt } from '@renderer/lib/terminalPool'
import {
  normalizeBoard,
  defaultBoard,
  addCard,
  removeCard,
  moveCard,
  adjacentColumn,
  type TaskBoard,
  type TaskCard
} from '@shared/taskboard'

function activeCwd(): string {
  const s = useWorkspace.getState()
  const p = s.activePaneId ? s.panes[s.activePaneId] : null
  return p?.agent?.cwd || p?.shell?.cwd || p?.stream?.cwd || ''
}

/**
 * Task board — a local-first kanban (`.bridgespace/tasks.json`) that feeds the
 * workroom. Start a card and it launches an agent in the folder, seeded with the
 * task, and moves the card to In progress: Task → Workspace, one click.
 */
export default function TaskBoardModal(): JSX.Element | null {
  const show = useUi((s) => s.showTasks)
  const setShow = useUi((s) => s.setShowTasks)
  const [cwd, setCwd] = useState('')
  const [board, setBoard] = useState<TaskBoard>(defaultBoard())
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!show) return
    const c = activeCwd()
    setCwd(c)
    setDraft('')
    if (c) window.api.bridge.tasksRead(c).then((raw) => setBoard(normalizeBoard(raw))).catch(() => setBoard(defaultBoard()))
    else setBoard(defaultBoard())
  }, [show])

  if (!show) return null
  const close = (): void => setShow(false)

  const persist = (next: TaskBoard): void => {
    setBoard(next)
    if (cwd) void window.api.bridge.tasksWrite(cwd, next)
  }

  const add = (): void => {
    const title = draft.trim()
    if (!title) return
    const id = crypto.randomUUID()
    persist(addCard(board, 'backlog', { id, title, created: Date.now() }))
    setDraft('')
  }

  const start = (card: TaskCard): void => {
    const ws = useWorkspace.getState()
    const id = ws.addPane('ai', undefined, { agentCommand: 'claude', agentCwd: cwd || undefined, label: card.title })
    if (id) {
      const prompt = `Task: ${card.title}${card.notes ? `\n\n${card.notes}` : ''}`
      // type it into the new agent (don't auto-send — let the human steer)
      window.setTimeout(() => seedPrompt(id, prompt, false), 50)
      persist(moveCard(board, card.id, 'doing'))
      toast(`Started “${card.title}”`, 'ok')
      close()
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal taskboard" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="tb-title">
            <ClipboardList size={16} />
            <span>Task board</span>
            {cwd && <span className="tb-cwd" title={cwd}>.bridgespace</span>}
          </div>
          <button className="icon-btn" onClick={close} title="Close">
            <X size={14} />
          </button>
        </div>

        {!cwd && (
          <div className="bridge-hint">
            Focus a pane in a folder — the board is stored in <code>.bridgespace/tasks.json</code> next to that repo.
          </div>
        )}

        <div className="tb-add">
          <input
            className="input"
            placeholder="Add a task…"
            value={draft}
            disabled={!cwd}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <button className="btn primary" onClick={add} disabled={!cwd || !draft.trim()}>
            <Plus size={13} /> Add
          </button>
        </div>

        <div className="tb-columns">
          {board.columns.map((col) => (
            <div key={col.id} className="tb-col">
              <div className="tb-col-head">
                {col.name}
                <span className="tb-col-count">{col.cards.length}</span>
              </div>
              <div className="tb-col-cards">
                {col.cards.map((card) => {
                  const left = adjacentColumn(col.id, -1)
                  const right = adjacentColumn(col.id, 1)
                  return (
                    <div key={card.id} className="tb-card">
                      <div className="tb-card-title">{card.title}</div>
                      <div className="tb-card-actions">
                        <button
                          className="icon-btn"
                          disabled={!left}
                          title="Move left"
                          onClick={() => left && persist(moveCard(board, card.id, left))}
                        >
                          <ChevronLeft size={13} />
                        </button>
                        {col.id !== 'done' && (
                          <button className="icon-btn start" title="Start in a new agent" onClick={() => start(card)}>
                            <Rocket size={13} />
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          disabled={!right}
                          title="Move right"
                          onClick={() => right && persist(moveCard(board, card.id, right))}
                        >
                          <ChevronRight size={13} />
                        </button>
                        <button className="icon-btn del" title="Delete" onClick={() => persist(removeCard(board, card.id))}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
                {col.cards.length === 0 && <div className="tb-col-empty">—</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
