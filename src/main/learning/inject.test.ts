import { describe, it, expect } from 'vitest'
import {
  targetFor,
  renderLearnedBlock,
  upsertManagedBlock,
  ensureGitignoreEntry,
  MANAGED_START,
  MANAGED_END
} from './inject'
import type { MemoryEntry, SkillEntry } from './markdown'

// Pure-function tests only. injectForPane reads the real brain (Electron-backed
// path), so it is exercised in inject.integration.test.ts where Electron is
// mocked to a temp dir.

function mem(slug: string, body: string, conf = 0.8): MemoryEntry {
  return {
    title: slug,
    slug,
    kind: 'memory',
    scope: 'project',
    agentScope: 'all',
    project: 'p',
    sourceAgents: [],
    confidence: conf,
    hits: 1,
    created: '2026-05-31',
    updated: '2026-05-31',
    lastSeen: '2026-05-31',
    evidence: [],
    supersedes: [],
    body
  }
}

describe('targetFor', () => {
  it('maps known agents to their native context files', () => {
    expect(targetFor('claude')).toBe('.claude/CLAUDE.md')
    expect(targetFor('gemini')).toBe('.gemini/GEMINI.md')
    expect(targetFor('copilot')).toBe('.github/copilot-instructions.md')
    expect(targetFor('gh-copilot')).toBe('.github/copilot-instructions.md')
  })
  it('defaults codex/unknown to AGENTS.md (copilot is never mis-defaulted)', () => {
    expect(targetFor('codex')).toBe('AGENTS.md')
    expect(targetFor('some-new-agent')).toBe('AGENTS.md')
  })
  it('strips path + extension', () => {
    expect(targetFor('/usr/bin/claude.exe')).toBe('.claude/CLAUDE.md')
  })
})

describe('renderLearnedBlock', () => {
  it('wraps content in the managed markers, ranked by confidence', () => {
    const block = renderLearnedBlock(
      [mem('a', 'low conf fact', 0.2), mem('b', 'high conf fact', 0.9)],
      []
    )
    expect(block.startsWith(MANAGED_START)).toBe(true)
    expect(block.trimEnd().endsWith(MANAGED_END)).toBe(true)
    expect(block.indexOf('high conf fact')).toBeLessThan(block.indexOf('low conf fact'))
  })
  it('includes a skills index when skills exist', () => {
    const skill: SkillEntry = {
      name: 'ship',
      slug: 'ship',
      kind: 'skill',
      scope: 'project',
      description: 'publish a release',
      agents: [],
      trigger: '',
      project: 'p',
      confidence: 0.9,
      hits: 1,
      created: '2026-05-31',
      updated: '2026-05-31',
      evidence: [],
      body: 'steps'
    }
    const block = renderLearnedBlock([mem('a', 'fact')], [skill])
    expect(block).toContain('Skills available')
    expect(block).toContain('**ship**')
  })
  it('respects the byte budget', () => {
    const many = Array.from({ length: 200 }, (_, i) => mem(`m${i}`, `fact number ${i} with some length`))
    const block = renderLearnedBlock(many, [], 400)
    expect(block.length).toBeLessThan(700)
  })
})

describe('upsertManagedBlock', () => {
  const block = `${MANAGED_START}\nNEW\n${MANAGED_END}`
  it('appends to a file with no existing block, preserving user content', () => {
    const out = upsertManagedBlock('# My notes\nhand-written', block)
    expect(out).toContain('# My notes')
    expect(out).toContain('NEW')
  })
  it('replaces only the managed region on re-injection (idempotent)', () => {
    const first = upsertManagedBlock('user text', block)
    const second = upsertManagedBlock(first, `${MANAGED_START}\nUPDATED\n${MANAGED_END}`)
    expect(second).toContain('user text')
    expect(second).toContain('UPDATED')
    expect(second).not.toContain('NEW')
    expect(second.indexOf(MANAGED_START)).toBe(second.lastIndexOf(MANAGED_START))
  })
  it('writes just the block into an empty file', () => {
    expect(upsertManagedBlock('', block)).toContain('NEW')
  })
})

describe('ensureGitignoreEntry', () => {
  it('adds a missing entry with a header', () => {
    const out = ensureGitignoreEntry('node_modules\n', '.claude/CLAUDE.md')
    expect(out).toContain('.claude/CLAUDE.md')
    expect(out).toContain('# URterminal learning')
  })
  it('is idempotent', () => {
    const once = ensureGitignoreEntry('', 'AGENTS.md')
    const twice = ensureGitignoreEntry(once, 'AGENTS.md')
    expect(twice).toBe(once)
  })
})
