import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync, unlinkSync } from 'fs'
import { join, dirname, isAbsolute } from 'path'
import { parseNote, slugify, type BridgeNote } from '@shared/bridge'

/**
 * BridgeMemory IO: the `.bridgememory/` hub of plain markdown notes that lives
 * next to the repo. Discovered by walking up from a pane's cwd to the repo root,
 * so any sub-directory an agent opens finds the same hub. Local-first and
 * intentionally NOT gitignored — it's a project asset you commit + version.
 */

const HUB = '.bridgememory'

/** Locate the hub dir for a working folder (existing hub → repo root → cwd). */
export function discoverHub(cwd: string): string {
  if (!cwd || !isAbsolute(cwd)) return ''
  let dir = cwd
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, HUB))) return join(dir, HUB)
    if (existsSync(join(dir, '.git'))) return join(dir, HUB) // host at the repo root
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(cwd, HUB)
}

export interface HubInfo {
  dir: string
  exists: boolean
  notes: BridgeNote[]
}

/** Read every note in the hub for `cwd` (empty list if the hub doesn't exist). */
export function listHub(cwd: string): HubInfo {
  const dir = discoverHub(cwd)
  if (!dir) return { dir: '', exists: false, notes: [] }
  if (!existsSync(dir)) return { dir, exists: false, notes: [] }
  const notes: BridgeNote[] = []
  try {
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.md')) continue
      const full = join(dir, name)
      try {
        const content = readFileSync(full, 'utf8')
        const updated = statSync(full).mtimeMs
        notes.push(parseNote(name.replace(/\.md$/i, ''), content, updated))
      } catch {
        /* skip an unreadable note */
      }
    }
  } catch {
    /* unreadable dir */
  }
  notes.sort((a, b) => b.updated - a.updated)
  return { dir, exists: true, notes }
}

export function ensureHub(cwd: string): string {
  const dir = discoverHub(cwd)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function uniqueSlug(dir: string, base: string, allowSlug?: string): string {
  let slug = base || 'note'
  if (slug === allowSlug) return slug
  let n = 2
  while (existsSync(join(dir, slug + '.md')) && slug !== allowSlug) slug = `${base}-${n++}`
  return slug
}

export interface SaveResult {
  ok: boolean
  slug?: string
  error?: string
}

/**
 * Create or update a note. `slug` null → create a new note (slug derived from the
 * title). Returns the final slug. Renames the file if the slug changed.
 */
export function saveNote(cwd: string, slug: string | null, title: string, content: string): SaveResult {
  try {
    const dir = ensureHub(cwd)
    if (!dir) return { ok: false, error: 'This pane has no folder for a memory hub.' }
    const desired = uniqueSlug(dir, slugify(title || slug || 'note'), slug ?? undefined)
    if (slug && slug !== desired && existsSync(join(dir, slug + '.md'))) {
      try {
        renameSync(join(dir, slug + '.md'), join(dir, desired + '.md'))
      } catch {
        /* fall through to a plain write */
      }
    }
    writeFileSync(join(dir, desired + '.md'), content, 'utf8')
    return { ok: true, slug: desired }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function deleteNote(cwd: string, slug: string): boolean {
  try {
    const dir = discoverHub(cwd)
    const path = join(dir, slug + '.md')
    if (existsSync(path)) unlinkSync(path)
    return true
  } catch {
    return false
  }
}
