import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const dir = mkdtempSync(join(tmpdir(), 'urt-inject-int-'))
  return { app: { getPath: (): string => dir } }
})

import { join, isAbsolute } from 'path'
import { injectForPane, MANAGED_START, type InjectIO } from './inject'
import { writeMemory } from './brain'
import type { MemoryEntry } from './markdown'

const PH = 'projinject1'
// An OS-appropriate absolute cwd so isAbsolute() holds on both Windows + POSIX.
const CWD = isAbsolute('/abs/proj') ? '/abs/proj' : join(process.cwd(), 'abs', 'proj')

function mem(slug: string, body: string): MemoryEntry {
  return {
    title: slug,
    slug,
    kind: 'memory',
    scope: 'project',
    agentScope: 'all',
    project: PH,
    sourceAgents: [],
    confidence: 0.9,
    hits: 1,
    created: '2026-05-31',
    updated: '2026-05-31',
    lastSeen: '2026-05-31',
    evidence: [],
    supersedes: [],
    body
  }
}

/** In-memory IO so we exercise the real brain read but not the real FS/git. */
function fakeIO(tracked = new Set<string>()): InjectIO & { files: Record<string, string> } {
  const files: Record<string, string> = {}
  return {
    files,
    read: (p) => (p in files ? files[p] : null),
    write: (p, c) => {
      files[p] = c
    },
    ensureDir: () => {},
    isTracked: (_cwd, rel) => tracked.has(rel)
  }
}

describe('injectForPane (real brain)', () => {
  it('renders approved memories into the agent context file + gitignore', () => {
    writeMemory(PH, mem('use-pnpm', 'This repo uses pnpm, never npm'))
    const io = fakeIO()
    const res = injectForPane({ cwd: CWD, agentId: 'claude', projectHash: PH }, io)
    expect(res.status).toBe('written')
    expect(res.file).toBe('.claude/CLAUDE.md')

    const ctx = io.files[join(CWD, '.claude/CLAUDE.md')]
    expect(ctx).toBeTruthy()
    expect(ctx).toContain(MANAGED_START)
    expect(ctx).toContain('This repo uses pnpm, never npm')

    const gi = io.files[join(CWD, '.gitignore')]
    expect(gi).toContain('.claude/CLAUDE.md')
  })

  it('is idempotent across repeated injections (single managed block)', () => {
    const io = fakeIO()
    injectForPane({ cwd: CWD, agentId: 'claude', projectHash: PH }, io)
    injectForPane({ cwd: CWD, agentId: 'claude', projectHash: PH }, io)
    const ctx = io.files[join(CWD, '.claude/CLAUDE.md')]
    expect(ctx.split(MANAGED_START).length - 1).toBe(1)
  })

  it('skips a git-tracked target untouched', () => {
    const io = fakeIO(new Set(['.claude/CLAUDE.md']))
    const res = injectForPane({ cwd: CWD, agentId: 'claude', projectHash: PH }, io)
    expect(res.status).toBe('skipped-tracked')
    expect(Object.keys(io.files)).toHaveLength(0)
  })

  it('returns skipped-empty when the project has no learnings', () => {
    const res = injectForPane({ cwd: CWD, agentId: 'claude', projectHash: 'empty-project-xyz' }, fakeIO())
    expect(res.status).toBe('skipped-empty')
  })

  it('returns no-cwd for a relative/empty cwd', () => {
    expect(injectForPane({ cwd: '', agentId: 'claude', projectHash: PH }, fakeIO()).status).toBe('no-cwd')
    expect(injectForPane({ cwd: 'rel/path', agentId: 'claude', projectHash: PH }, fakeIO()).status).toBe('no-cwd')
  })
})
