/**
 * Task board — a local-first kanban that feeds the workroom. Tasks live in
 * `.bridgespace/tasks.json` next to the repo (commit it, like the memory hub);
 * starting a card launches an agent in the folder seeded with the task. This is
 * the pure core (board ops + load/normalize), shared by main (IO) and renderer.
 */

export interface TaskCard {
  id: string
  title: string
  notes?: string
  created: number
}

export interface TaskColumn {
  id: string
  name: string
  cards: TaskCard[]
}

export interface TaskBoard {
  columns: TaskColumn[]
}

export const COLUMNS: { id: string; name: string }[] = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'doing', name: 'In progress' },
  { id: 'done', name: 'Done' }
]

export function defaultBoard(): TaskBoard {
  return { columns: COLUMNS.map((c) => ({ id: c.id, name: c.name, cards: [] })) }
}

/** Coerce arbitrary loaded JSON into a valid board (always the 3 columns). */
export function normalizeBoard(raw: unknown): TaskBoard {
  const board = defaultBoard()
  const cols = (raw as TaskBoard | null)?.columns
  if (!Array.isArray(cols)) return board
  for (const col of board.columns) {
    const found = cols.find((c) => c && c.id === col.id)
    if (!found || !Array.isArray(found.cards)) continue
    col.cards = found.cards
      .filter((c) => c && typeof c.title === 'string')
      .map((c) => ({
        id: typeof c.id === 'string' && c.id ? c.id : `${col.id}-${Math.max(0, col.cards.length)}-${c.title.slice(0, 8)}`,
        title: c.title,
        notes: typeof c.notes === 'string' ? c.notes : undefined,
        created: typeof c.created === 'number' ? c.created : 0
      }))
  }
  return board
}

const map = (board: TaskBoard, fn: (col: TaskColumn) => TaskColumn): TaskBoard => ({
  columns: board.columns.map(fn)
})

export function addCard(board: TaskBoard, columnId: string, card: TaskCard): TaskBoard {
  return map(board, (col) => (col.id === columnId ? { ...col, cards: [card, ...col.cards] } : col))
}

export function removeCard(board: TaskBoard, cardId: string): TaskBoard {
  return map(board, (col) => ({ ...col, cards: col.cards.filter((c) => c.id !== cardId) }))
}

export function updateCard(board: TaskBoard, cardId: string, patch: Partial<TaskCard>): TaskBoard {
  return map(board, (col) => ({
    ...col,
    cards: col.cards.map((c) => (c.id === cardId ? { ...c, ...patch, id: c.id } : c))
  }))
}

export function findCard(board: TaskBoard, cardId: string): { card: TaskCard; columnId: string } | null {
  for (const col of board.columns) {
    const card = col.cards.find((c) => c.id === cardId)
    if (card) return { card, columnId: col.id }
  }
  return null
}

/** Move a card to the head of another column (no-op if already there / unknown). */
export function moveCard(board: TaskBoard, cardId: string, toColumnId: string): TaskBoard {
  const found = findCard(board, cardId)
  if (!found || found.columnId === toColumnId) return board
  if (!board.columns.some((c) => c.id === toColumnId)) return board
  return addCard(removeCard(board, cardId), toColumnId, found.card)
}

/** The column id one step toward "done" (or back), for ←/→ moves. */
export function adjacentColumn(columnId: string, dir: 1 | -1): string | null {
  const i = COLUMNS.findIndex((c) => c.id === columnId)
  const j = i + dir
  return i < 0 || j < 0 || j >= COLUMNS.length ? null : COLUMNS[j].id
}
