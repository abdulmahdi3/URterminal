import { createHash } from 'crypto'
import { resolve } from 'path'

/**
 * Stable per-project id used to group transcripts (and, in later slices, the
 * distilled memory/skills) by working directory. Kept in its own module — with
 * NO Electron import — so the turn-assembly logic that needs it stays unit
 * testable without booting the app.
 *
 * `realpath` would be ideal (collapses symlinks/worktrees), but it touches the
 * filesystem and can throw for a cwd that no longer exists; `resolve` + a
 * platform-aware case fold is a safe, synchronous approximation.
 */
export function projectHash(cwd: string): string {
  const base = cwd || process.cwd()
  const norm = process.platform === 'win32' ? resolve(base).toLowerCase() : resolve(base)
  return createHash('sha1').update(norm).digest('hex').slice(0, 12)
}
