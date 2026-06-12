import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { discoverRoot } from './store'

/**
 * Task-board IO: the kanban lives in `.bridgespace/tasks.json` at the project
 * root (a sibling of the `.bridgememory/` hub) — local-first and committable.
 * The board shape is validated in the renderer (normalizeBoard); here we just
 * read/write the JSON.
 */
function tasksFile(cwd: string): string {
  const root = discoverRoot(cwd)
  return root ? join(root, '.bridgespace', 'tasks.json') : ''
}

export function readTasks(cwd: string): unknown {
  const file = tasksFile(cwd)
  if (!file || !existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function writeTasks(cwd: string, board: unknown): { ok: boolean; error?: string } {
  const file = tasksFile(cwd)
  if (!file) return { ok: false, error: 'This pane has no folder.' }
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(board, null, 2), 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
