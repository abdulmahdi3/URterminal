import { execFile } from 'child_process'
import type { GitStatus } from '@shared/types'

/**
 * Run `git status` in `cwd` and summarize the working tree. Returns null when
 * the folder isn't a git repo, git isn't installed, or the call errors/times
 * out — callers treat null as "no git info" and show nothing.
 *
 * Uses porcelain v1 + `--branch` (stable, easy to parse): the first `##` line
 * carries the branch + ahead/behind, and each following `XY path` line is one
 * changed entry (`??` = untracked; X = staged column, Y = worktree column).
 */
export function getGitStatus(cwd: string): Promise<GitStatus | null> {
  return new Promise((resolve) => {
    if (!cwd) {
      resolve(null)
      return
    }
    execFile(
      'git',
      ['-C', cwd, '--no-optional-locks', 'status', '--porcelain', '--branch'],
      { timeout: 4000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        resolve(parse(stdout))
      }
    )
  })
}

function parse(out: string): GitStatus {
  const lines = out.split('\n')
  let branch = ''
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0

  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('## ')) {
      // e.g. "## main...origin/main [ahead 1, behind 2]" or "## HEAD (no branch)"
      const head = line.slice(3)
      const name = head.split('...')[0].trim()
      branch = name.startsWith('HEAD') ? 'detached' : name
      const ab = head.match(/\[(.*)\]/)?.[1] ?? ''
      ahead = Number(ab.match(/ahead (\d+)/)?.[1] ?? 0)
      behind = Number(ab.match(/behind (\d+)/)?.[1] ?? 0)
      continue
    }
    if (line.startsWith('??')) {
      untracked++
      continue
    }
    const x = line[0]
    const y = line[1]
    if (x && x !== ' ' && x !== '?') staged++
    if (y && y !== ' ' && y !== '?') unstaged++
  }

  return {
    branch,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    dirty: staged > 0 || unstaged > 0 || untracked > 0
  }
}
