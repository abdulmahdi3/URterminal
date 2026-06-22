/**
 * Uregant git checkpoint / rollback (UREGANT_PLAN.md §12).
 *
 * checkpoint() snapshots the working tree + index WITHOUT touching it (git stash
 * create) and returns a SHA; rollback() restores tracked files from that SHA.
 * Best-effort safety net for file-mutating runs — untracked files are unaffected.
 */
import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'

function git(args: string, cwd: string): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((res) =>
    exec(`git ${args}`, { cwd, timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (e, o, er) =>
      res({ ok: !e, out: String(o).trim(), err: String(er).trim() })
    )
  )
}

export async function createCheckpoint(cwd: string): Promise<{ ok: boolean; sha?: string; error?: string }> {
  if (!cwd || !existsSync(cwd)) return { ok: false, error: 'cwd not found' }
  const inside = await git('rev-parse --is-inside-work-tree', cwd)
  if (!inside.ok || inside.out !== 'true') return { ok: false, error: 'not a git repository' }
  // capture a snapshot commit without modifying the working tree
  const snap = await git('stash create uregant-checkpoint', cwd)
  if (snap.ok && snap.out) return { ok: true, sha: snap.out }
  // clean tree → nothing to stash; use HEAD as the restore point
  const head = await git('rev-parse HEAD', cwd)
  return head.ok ? { ok: true, sha: head.out } : { ok: false, error: head.err || 'could not snapshot' }
}

export async function restoreCheckpoint(cwd: string, sha: string): Promise<{ ok: boolean; error?: string }> {
  if (!cwd || !existsSync(cwd)) return { ok: false, error: 'cwd not found' }
  if (!sha) return { ok: false, error: 'no checkpoint id' }
  const r = await git(`checkout ${sha} -- .`, cwd)
  return r.ok ? { ok: true } : { ok: false, error: r.err || 'restore failed' }
}
