/**
 * Uregant worktree isolation + merge (Phase 4, OC2). For an isolated parallel
 * run, each agent works in its OWN git worktree on its own branch, so concurrent
 * agents never clobber each other's files. Merge commits each worktree's WIP and
 * merges its branch back into the base branch, reporting conflicts (then aborts so
 * the user resolves manually). Cleanup removes the worktrees + branches.
 *
 * The git plumbing here is the verifiable substance; agent execution reuses panes.
 */
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { existsSync } from 'node:fs'
import type { UrWorktree, UrMergeResult } from '@shared/uregant'
import { runCommand } from './exec'

function git(args: string, cwd: string, timeoutMs = 60_000): ReturnType<typeof runCommand> {
  return runCommand({ command: `git ${args}`, cwd, timeoutMs })
}

const slug = (s: string): string => s.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()

export async function createWorktrees(
  cwd: string,
  labels: string[],
  stamp: number
): Promise<{ ok: boolean; worktrees: UrWorktree[]; error?: string }> {
  if (!cwd || !existsSync(cwd)) return { ok: false, worktrees: [], error: 'No folder.' }
  const inside = await git('rev-parse --is-inside-work-tree', cwd)
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { ok: false, worktrees: [], error: 'Not a git repository.' }
  }
  const base = join(tmpdir(), 'uregant-worktrees', `${basename(cwd)}-${stamp}`)
  const worktrees: UrWorktree[] = []
  for (let i = 0; i < labels.length; i++) {
    const label = slug(labels[i]) || `step${i + 1}`
    const branch = `uregant/${label}-${stamp}-${i + 1}`
    const path = join(base, `${label}-${i + 1}`)
    const res = await git(`worktree add -b ${branch} "${path}"`, cwd)
    if (!res.ok) {
      await cleanupWorktrees(cwd, worktrees) // roll back partial creation
      return { ok: false, worktrees: [], error: (res.stderr || res.error || 'git worktree add failed').slice(0, 300) }
    }
    worktrees.push({ path, branch, label })
  }
  return { ok: true, worktrees }
}

/** Commit each worktree's WIP on its branch, then merge it into the base branch. */
export async function mergeWorktrees(cwd: string, worktrees: UrWorktree[]): Promise<UrMergeResult[]> {
  const out: UrMergeResult[] = []
  for (const w of worktrees) {
    // commit any uncommitted work in the worktree (empty commit set → harmless failure)
    await runCommand({ command: 'git add -A', cwd: w.path, timeoutMs: 60_000 })
    await runCommand({ command: `git commit -m "uregant: ${w.label}"`, cwd: w.path, timeoutMs: 60_000 })

    const res = await git(`merge --no-ff -m "uregant merge ${w.label}" ${w.branch}`, cwd)
    if (res.ok) {
      out.push({ branch: w.branch, label: w.label, ok: true, conflicts: [] })
      continue
    }
    const conf = await git('diff --name-only --diff-filter=U', cwd)
    const conflicts = conf.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    await git('merge --abort', cwd) // leave the tree clean; user resolves manually
    out.push({
      branch: w.branch,
      label: w.label,
      ok: false,
      conflicts,
      error: conflicts.length ? 'merge conflicts' : (res.stderr || 'merge failed').slice(0, 200)
    })
  }
  return out
}

export async function cleanupWorktrees(cwd: string, worktrees: UrWorktree[]): Promise<void> {
  for (const w of worktrees) {
    await git(`worktree remove --force "${w.path}"`, cwd)
    await git(`branch -D ${w.branch}`, cwd)
  }
}
