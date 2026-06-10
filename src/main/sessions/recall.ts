import { homedir } from 'os'
import { join } from 'path'
import { open, readdir, stat } from 'fs/promises'
import type { SessionHit } from '@shared/types'

/**
 * Cross-session recall: a lightweight full-text index over Claude Code's own
 * conversation logs so the user can search everything they've ever discussed and
 * jump back to the exact session (resume it). Inspired by Hermes' FTS5 session
 * search, but index-in-memory (no native sqlite) keyed by session id.
 *
 * Claude stores each conversation at
 *   <config>/projects/<encoded-cwd>/<session-id>.jsonl
 * one JSON record per line. We extract the human-readable user + assistant text,
 * cap it, and keep it in memory; search is a case-insensitive scan with snippets.
 */

const SAFE_ID = /^[a-zA-Z0-9-]+$/
const MAX_FILES = 400 // most-recent sessions to index
const MAX_READ_BYTES = 400_000 // bytes read per conversation file
const MAX_TEXT = 24_000 // chars of extracted text kept per session
const REFRESH_THROTTLE_MS = 20_000

interface IndexEntry {
  sessionId: string
  title?: string
  cwd?: string
  mtime: number
  /** extracted, original-case conversation text (capped) */
  text: string
}

const index = new Map<string, IndexEntry>()
let lastRefresh = 0
let refreshing: Promise<void> | null = null

function projectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  return join(base, 'projects')
}

/** All `<id>.jsonl` conversation files across every project folder, with mtime. */
async function listSessionFiles(): Promise<{ path: string; sessionId: string; mtime: number }[]> {
  const root = projectsDir()
  let dirs: string[]
  try {
    dirs = await readdir(root)
  } catch {
    return []
  }
  const out: { path: string; sessionId: string; mtime: number }[] = []
  for (const d of dirs) {
    let files: string[]
    try {
      files = await readdir(join(root, d))
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const sessionId = f.slice(0, -6)
      if (!SAFE_ID.test(sessionId)) continue
      const path = join(root, d, f)
      try {
        out.push({ path, sessionId, mtime: (await stat(path)).mtimeMs })
      } catch {
        /* vanished — skip */
      }
    }
  }
  return out
}

/** Read up to `MAX_READ_BYTES` of a file as complete UTF-8 lines. */
async function readHead(path: string): Promise<string[]> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(MAX_READ_BYTES)
    const { bytesRead } = await fh.read(buf, 0, MAX_READ_BYTES, 0)
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n')
    if (bytesRead === MAX_READ_BYTES) lines.pop()
    return lines
  } finally {
    await fh.close()
  }
}

/** Pull text out of a message record's content (string or content blocks). */
function recordText(rec: Record<string, unknown>): string {
  const content = (rec.message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const b of content) {
      if (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text') {
        const t = (b as { text?: unknown }).text
        if (typeof t === 'string') parts.push(t)
      }
    }
    return parts.join(' ')
  }
  return ''
}

/** Extract title + cwd + searchable text from a conversation's lines. */
function extract(lines: string[]): { title?: string; cwd?: string; text: string } {
  let title: string | undefined
  let firstUser: string | undefined
  let cwd: string | undefined
  const chunks: string[] = []
  let total = 0
  for (const line of lines) {
    if (!line.trim() || total >= MAX_TEXT) continue
    let rec: Record<string, unknown>
    try {
      rec = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (!cwd && typeof rec.cwd === 'string') cwd = rec.cwd
    if (!title && typeof rec.aiTitle === 'string' && rec.aiTitle.trim()) title = rec.aiTitle.trim()
    if (rec.type === 'user' || rec.type === 'assistant') {
      const t = recordText(rec).replace(/\s+/g, ' ').trim()
      if (t && !/^<(local-command|command-|user-)/.test(t) && !t.startsWith('[Request interrupted')) {
        if (rec.type === 'user' && !firstUser) firstUser = t
        chunks.push(t)
        total += t.length
      }
    }
  }
  let text = chunks.join('  ¶  ')
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT)
  return { title: title ?? firstUser?.slice(0, 80), cwd, text }
}

/** Incrementally (re)build the index: read only new/changed conversation files. */
async function refresh(force = false): Promise<void> {
  if (!force && Date.now() - lastRefresh < REFRESH_THROTTLE_MS) return
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const files = (await listSessionFiles()).sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES)
      const live = new Set(files.map((f) => f.sessionId))
      for (const id of [...index.keys()]) if (!live.has(id)) index.delete(id) // prune deleted
      for (const f of files) {
        const cached = index.get(f.sessionId)
        if (cached && cached.mtime >= f.mtime) continue // unchanged
        try {
          const { title, cwd, text } = extract(await readHead(f.path))
          index.set(f.sessionId, { sessionId: f.sessionId, title, cwd, mtime: f.mtime, text })
        } catch {
          /* unreadable — skip */
        }
      }
      lastRefresh = Date.now()
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/** ~150-char snippet around the first match, with surrounding context. */
function snippetAround(text: string, at: number, qlen: number): string {
  const start = Math.max(0, at - 70)
  const end = Math.min(text.length, at + qlen + 90)
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = '…' + s
  if (end < text.length) s = s + '…'
  return s
}

/** Warm the index in the background at startup so the first search is instant. */
export function warmSessionIndex(): void {
  void refresh(true)
}

/** Search every indexed conversation for `query`; newest matches first. */
export async function searchSessions(query: string, limit = 50): Promise<SessionHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  await refresh()
  const hits: SessionHit[] = []
  for (const e of index.values()) {
    const hay = e.text.toLowerCase()
    const at = hay.indexOf(q)
    const titleHit = (e.title ?? '').toLowerCase().includes(q)
    if (at < 0 && !titleHit) continue
    hits.push({
      sessionId: e.sessionId,
      title: e.title,
      cwd: e.cwd,
      when: e.mtime,
      snippet: at >= 0 ? snippetAround(e.text, at, q.length) : (e.title ?? '')
    })
  }
  hits.sort((a, b) => b.when - a.when)
  return hits.slice(0, limit)
}
