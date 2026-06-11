import { homedir } from 'os'
import { join } from 'path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  readdirSync
} from 'fs'

/**
 * URterminal launches several `claude` panes at once (notably on session
 * restore). Each `claude` process rewrites its global config + account store at
 * ~/.claude.json on startup; when those read-modify-write cycles overlap they
 * interleave and truncate the file, leaving invalid JSON. The NEXT launch then
 * reads a corrupt file, every Claude pane shows "configuration file ... contains
 * invalid JSON", and the "Reset with default configuration" option wipes the
 * stored account — forcing the user to sign in again. (Confirmed on disk:
 * Claude's own `.claude.json.corrupted.<ts>` backups arrive in same-millisecond
 * pairs/triples — the signature of concurrent writers.)
 *
 * We defend on two fronts, both centralized at the single spawn choke point:
 *   1. ensureClaudeConfigHealthy() — before a claude pane starts, if
 *      ~/.claude.json is unparseable we silently restore the newest *valid*
 *      backup Claude itself keeps under ~/.claude/backups, so login + config
 *      survive and the user never sees the error.
 *   2. prepareClaudeSpawn() — serialize claude starts a few hundred ms apart so
 *      their initial config writes don't overlap in the first place.
 *
 * Everything here is best-effort and never throws: a guard failure must never
 * block or crash a pane spawn.
 */

/** ~/.claude.json (config+account) and the dir of Claude's own timestamped backups. */
export interface ClaudePaths {
  config: string
  backupsDir: string
}

/** Default locations, honoring CLAUDE_CONFIG_DIR like the rest of the app. */
export function claudePaths(): ClaudePaths {
  const cfgDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (cfgDir) return { config: join(cfgDir, '.claude.json'), backupsDir: join(cfgDir, 'backups') }
  const home = homedir()
  return { config: join(home, '.claude.json'), backupsDir: join(home, '.claude', 'backups') }
}

/** A config is healthy only if it is non-empty and parses to a JSON object. */
function isValidConfig(text: string): boolean {
  if (!text.trim()) return false
  try {
    const v = JSON.parse(text)
    return !!v && typeof v === 'object'
  } catch {
    return false
  }
}

/** Newest backup whose contents are valid JSON (skips truncated ones), or null. */
function newestValidBackup(backupsDir: string): { path: string; content: string } | null {
  let names: string[]
  try {
    names = readdirSync(backupsDir)
  } catch {
    return null // no backups dir yet
  }
  const backups = names
    .map((n) => {
      const m = /^\.claude\.json\.backup\.(\d+)$/.exec(n)
      return m ? { name: n, ts: Number(m[1]) } : null
    })
    .filter((b): b is { name: string; ts: number } => b !== null)
    .sort((a, b) => b.ts - a.ts) // newest first
  for (const b of backups) {
    const path = join(backupsDir, b.name)
    try {
      const content = readFileSync(path, 'utf8')
      if (isValidConfig(content)) return { path, content }
    } catch {
      /* unreadable backup — try the next-newest */
    }
  }
  return null
}

/** Write via temp + rename so we never add our own partial/torn write. */
function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.urt-tmp-${process.pid}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}

export type HealthResult =
  | { status: 'ok' } // already valid — untouched
  | { status: 'absent' } // first run — nothing to heal
  | { status: 'repaired'; from: string } // restored from a backup
  | { status: 'corrupt-no-backup' } // corrupt but no valid backup to use
  | { status: 'error' } // guard itself failed (swallowed)

/**
 * If ~/.claude.json is corrupt, restore the newest valid backup in place
 * (preserving login + config). No-op when the file is valid or absent. Never
 * touches a healthy file — that would risk introducing our own write race.
 */
export function ensureClaudeConfigHealthy(paths: ClaudePaths = claudePaths()): HealthResult {
  try {
    if (!existsSync(paths.config)) return { status: 'absent' }
    let live: string
    try {
      live = readFileSync(paths.config, 'utf8')
    } catch {
      return { status: 'error' }
    }
    if (isValidConfig(live)) return { status: 'ok' }

    const backup = newestValidBackup(paths.backupsDir)
    if (!backup) return { status: 'corrupt-no-backup' }

    // Keep the corrupt file aside for inspection (best-effort), then restore.
    try {
      copyFileSync(paths.config, `${paths.config}.urterminal-corrupt`)
    } catch {
      /* non-fatal */
    }
    atomicWrite(paths.config, backup.content)
    return { status: 'repaired', from: backup.path }
  } catch {
    return { status: 'error' }
  }
}

/** True for `claude`, `claude.exe/.cmd/.bat`, or an absolute path ending in it. */
export function isClaudeCommand(command?: string): boolean {
  if (!command) return false
  const base = command
    .trim()
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(exe|cmd|bat)$/i, '')
    .toLowerCase()
  return base === 'claude'
}

// Spacing between consecutive claude starts. Claude finishes its initial
// ~/.claude.json read-modify-write well within this window, so staggering by
// this much keeps two starts from overlapping on the file. Half a second is
// imperceptible on restore (panes simply appear a beat apart).
export const CLAUDE_SPAWN_STAGGER_MS = 500

let claudeChain: Promise<void> = Promise.resolve()

/**
 * Gate a pane spawn. For a `claude` command: wait until any prior claude start's
 * stagger window has elapsed, then heal ~/.claude.json right before this one
 * reads it. Non-claude commands resolve immediately. Never rejects, so the
 * spawn always proceeds.
 */
export function prepareClaudeSpawn(
  command?: string,
  staggerMs: number = CLAUDE_SPAWN_STAGGER_MS
): Promise<void> {
  if (!isClaudeCommand(command)) return Promise.resolve()
  const prior = claudeChain
  let release!: () => void
  claudeChain = new Promise<void>((r) => {
    release = r
  })
  return prior.then(() => {
    try {
      ensureClaudeConfigHealthy()
    } catch {
      /* a guard failure must never block a spawn */
    }
    // Hold the gate so the next claude starts only after this one has settled.
    setTimeout(release, Math.max(0, staggerMs))
  })
}

/** Reset the spawn-serialization chain. Test-only. */
export function __resetClaudeChain(): void {
  claudeChain = Promise.resolve()
}
