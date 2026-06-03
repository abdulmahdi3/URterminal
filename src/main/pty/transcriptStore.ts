import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, unlinkSync, renameSync } from 'fs'

/**
 * Complete per-pane terminal history, kept independent of xterm's in-memory
 * scrollback so a session can be restored at full fidelity days later.
 *
 * Every byte a pty emits is appended here (in main, so it survives regardless of
 * which workspace is on screen or how small the renderer's scrollback is). Each
 * pane's log is capped to a sane tail so a runaway process can't fill the disk.
 * The renderer's auto-save snapshot only references pane ids — the heavy chat
 * content lives here and is flushed lazily, then synchronously on quit/close.
 */

/** Max characters kept per pane (oldest are dropped on a newline boundary). */
const MAX_CHARS = 1_500_000
/** Debounce for lazy disk flushes while a pane is actively producing output. */
const FLUSH_MS = 2000

interface PaneLog {
  buf: string
  dirty: boolean
  timer: ReturnType<typeof setTimeout> | null
}

export class TranscriptStore {
  private logs = new Map<string, PaneLog>()

  private dir(): string {
    return join(app.getPath('userData'), 'transcripts')
  }

  /** Sanitize a pane id into a safe filename (ids are uuids/slugs, but be strict). */
  private file(paneId: string): string {
    return join(this.dir(), `${paneId.replace(/[^a-zA-Z0-9_-]/g, '')}.log`)
  }

  /** Trim the buffer to the last MAX_CHARS, cutting at a newline so replay never
   *  starts mid-escape-sequence. */
  private cap(s: string): string {
    if (s.length <= MAX_CHARS) return s
    const sliced = s.slice(s.length - MAX_CHARS)
    const nl = sliced.indexOf('\n')
    return nl >= 0 && nl < sliced.length - 1 ? sliced.slice(nl + 1) : sliced
  }

  /** Lazily load a pane's existing on-disk log into memory (once). */
  private ensure(paneId: string): PaneLog {
    let log = this.logs.get(paneId)
    if (log) return log
    let buf = ''
    try {
      const f = this.file(paneId)
      if (existsSync(f)) buf = this.cap(readFileSync(f, 'utf8'))
    } catch {
      /* missing/unreadable → start empty */
    }
    log = { buf, dirty: false, timer: null }
    this.logs.set(paneId, log)
    return log
  }

  /** Append a raw output chunk to a pane's history (loads prior history first). */
  append(paneId: string, data: string): void {
    if (!data) return
    const log = this.ensure(paneId)
    log.buf = this.cap(log.buf + data)
    log.dirty = true
    if (!log.timer) log.timer = setTimeout(() => this.persist(paneId), FLUSH_MS)
  }

  /** Replace a pane's history outright (used when seeding a restored pane so its
   *  future captures include the replayed transcript). Persists immediately. */
  prime(paneId: string, text: string): void {
    const log = this.ensure(paneId)
    log.buf = this.cap(text)
    log.dirty = true
    this.persist(paneId)
  }

  /** The full retained history for a pane (memory, falling back to disk). */
  read(paneId: string): string {
    return this.ensure(paneId).buf
  }

  /** Clear a pane's recorded history (in memory and on disk). */
  reset(paneId: string): void {
    const log = this.ensure(paneId)
    log.buf = ''
    log.dirty = false
    if (log.timer) {
      clearTimeout(log.timer)
      log.timer = null
    }
    try {
      const f = this.file(paneId)
      if (existsSync(f)) unlinkSync(f)
    } catch {
      /* already gone */
    }
  }

  /** Write a single pane's log to disk if it changed (atomic temp+rename). */
  persist(paneId: string): void {
    const log = this.logs.get(paneId)
    if (!log) return
    if (log.timer) {
      clearTimeout(log.timer)
      log.timer = null
    }
    if (!log.dirty) return
    try {
      mkdirSync(this.dir(), { recursive: true })
      const f = this.file(paneId)
      const tmp = `${f}.tmp`
      writeFileSync(tmp, log.buf, 'utf8')
      renameSync(tmp, f)
      log.dirty = false
    } catch {
      /* disk errors are non-fatal */
    }
  }

  /** Flush every dirty pane log synchronously (called on window close / quit). */
  persistAll(): void {
    for (const id of this.logs.keys()) this.persist(id)
  }

  /** Forget a pane's history entirely (called when the user closes the pane). */
  remove(paneId: string): void {
    const log = this.logs.get(paneId)
    if (log?.timer) clearTimeout(log.timer)
    this.logs.delete(paneId)
    try {
      const f = this.file(paneId)
      if (existsSync(f)) unlinkSync(f)
    } catch {
      /* already gone */
    }
  }

  /** Delete every on-disk log whose pane id isn't in `keep` (crash-orphan cleanup). */
  pruneExcept(keep: string[]): void {
    const keepFiles = new Set(keep.map((id) => `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.log`))
    try {
      for (const name of readdirSync(this.dir())) {
        if (name.endsWith('.log') && !keepFiles.has(name)) {
          try {
            unlinkSync(join(this.dir(), name))
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* dir missing → nothing to prune */
    }
  }
}
