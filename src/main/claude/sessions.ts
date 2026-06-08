import { homedir } from 'os'
import { join } from 'path'
import { open, readdir, stat } from 'fs/promises'
import type { ClaudeSessionInfo } from '@shared/types'

/**
 * Reads Claude Code's own per-conversation transcripts so URterminal can:
 *   1. decide, on restore, whether a pane's pinned `--session-id` still exists on
 *      disk (resume it) or not (re-create it) — see the renderer's restore path;
 *   2. label each saved chat in the sessions menu by its real subject.
 *
 * Claude stores every conversation at
 *   <config>/projects/<encoded-cwd>/<session-id>.jsonl
 * where <config> is ~/.claude (or $CLAUDE_CONFIG_DIR) and <encoded-cwd> is the
 * absolute working dir with every non-alphanumeric char replaced by '-'. We never
 * rely on that encoding though — we locate a session purely by its uuid filename,
 * scanning the (handful of) project folders, so a cwd-encoding mismatch can't
 * make a chat "disappear".
 */

/** Session ids are uuids; be strict so a crafted id can't escape the projects dir. */
const SAFE_ID = /^[a-zA-Z0-9-]+$/

/** Root that holds one folder per project: <config>/projects. */
function projectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  return join(base, 'projects')
}

/** Locate `<id>.jsonl` under any project folder; null if there's no such conversation. */
async function findSessionFile(sessionId: string): Promise<string | null> {
  if (!SAFE_ID.test(sessionId)) return null
  const root = projectsDir()
  let dirs: string[]
  try {
    dirs = await readdir(root)
  } catch {
    return null // no ~/.claude/projects yet
  }
  const file = `${sessionId}.jsonl`
  for (const d of dirs) {
    const full = join(root, d, file)
    try {
      await stat(full)
      return full
    } catch {
      /* not in this project folder — keep looking */
    }
  }
  return null
}

/** Read the first `bytes` of a file as complete UTF-8 lines (drops a trailing partial). */
async function readHeadLines(path: string, bytes = 131_072): Promise<string[]> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n')
    if (bytesRead === bytes) lines.pop() // last line may be truncated
    return lines
  } finally {
    await fh.close()
  }
}

/** Pull readable text out of a `user` record's message content (string or blocks). */
function userText(rec: Record<string, unknown>): string | undefined {
  const msg = rec.message as { content?: unknown } | undefined
  const content = msg?.content
  let text: string | undefined
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    const block = content.find(
      (b): b is { text: string } =>
        !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string'
    )
    text = block?.text
  }
  if (!text) return undefined
  const trimmed = text.trim()
  // skip slash-command / caveat wrapper meta — it's not something the user typed
  if (/^<(local-command|command-|user-)/.test(trimmed) || trimmed.startsWith('[Request interrupted'))
    return undefined
  const oneLine = trimmed.replace(/\s+/g, ' ').trim()
  if (!oneLine) return undefined
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine
}

/** Derive a subject + cwd from a session's head lines: aiTitle, else first real prompt. */
function deriveTitle(lines: string[]): { title?: string; cwd?: string } {
  let title: string | undefined
  let firstUser: string | undefined
  let cwd: string | undefined
  for (const line of lines) {
    if (!line.trim()) continue
    let rec: Record<string, unknown>
    try {
      rec = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (!cwd && typeof rec.cwd === 'string') cwd = rec.cwd
    if (typeof rec.aiTitle === 'string' && rec.aiTitle.trim()) {
      title = rec.aiTitle.trim()
      break // Claude's own subject — best title, stop here
    }
    if (!firstUser && rec.type === 'user') firstUser = userText(rec)
  }
  return { title: title ?? firstUser, cwd }
}

/** Existence + subject title for a pinned Claude conversation, or {exists:false}. */
export async function claudeSessionInfo(sessionId: string): Promise<ClaudeSessionInfo> {
  const path = await findSessionFile(sessionId)
  if (!path) return { exists: false }
  let updatedAt: number | undefined
  try {
    updatedAt = (await stat(path)).mtimeMs
  } catch {
    /* file vanished between find and stat — still report it existed */
  }
  let title: string | undefined
  let cwd: string | undefined
  try {
    const derived = deriveTitle(await readHeadLines(path))
    title = derived.title
    cwd = derived.cwd
  } catch {
    /* unreadable → no title, but it exists */
  }
  return { exists: true, title, cwd, updatedAt }
}
