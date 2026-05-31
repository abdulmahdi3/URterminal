import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const dir = mkdtempSync(join(tmpdir(), 'urt-brain-test-'))
  return { app: { getPath: (): string => dir } }
})

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  writeMemory,
  readMemories,
  writeSkill,
  readSkills,
  regenerateIndex,
  brainIndex,
  forgetProject
} from './brain'
import { learningRoot } from './store'
import type { MemoryEntry, SkillEntry } from './markdown'

const PH = 'projbrain1'

function mem(slug: string, conf = 0.8): MemoryEntry {
  return {
    title: `Title ${slug}`,
    slug,
    kind: 'memory',
    scope: 'project',
    agentScope: 'all',
    project: PH,
    sourceAgents: ['claude'],
    confidence: conf,
    hits: 1,
    created: '2026-05-31',
    updated: '2026-05-31',
    lastSeen: '2026-05-31',
    evidence: ['t1'],
    supersedes: [],
    body: `Body for ${slug}`
  }
}

describe('brain memory CRUD', () => {
  it('writes and reads back a memory', () => {
    writeMemory(PH, mem('alpha'))
    const all = readMemories(PH)
    expect(all.find((m) => m.slug === 'alpha')?.title).toBe('Title alpha')
  })

  it('regenerates MEMORY.md sorted by confidence', () => {
    writeMemory(PH, mem('low', 0.3))
    writeMemory(PH, mem('high', 0.95))
    regenerateIndex(PH)
    const idx = readFileSync(join(learningRoot(), 'projects', PH, 'memory', 'MEMORY.md'), 'utf8')
    expect(idx).toContain('# Memory Index')
    expect(idx.indexOf('high.md')).toBeLessThan(idx.indexOf('low.md'))
  })
})

describe('brain skills', () => {
  it('writes a skill as skills/<slug>/SKILL.md and reads it', () => {
    const skill: SkillEntry = {
      name: 'do-thing',
      slug: 'do-thing',
      kind: 'skill',
      scope: 'project',
      description: 'does the thing',
      agents: ['claude'],
      trigger: 'when asked',
      project: PH,
      confidence: 0.9,
      hits: 1,
      created: '2026-05-31',
      updated: '2026-05-31',
      evidence: [],
      body: '## Steps'
    }
    writeSkill(PH, skill)
    expect(existsSync(join(learningRoot(), 'projects', PH, 'skills', 'do-thing', 'SKILL.md'))).toBe(true)
    expect(readSkills(PH).find((s) => s.slug === 'do-thing')?.name).toBe('do-thing')
  })
})

describe('brainIndex + forgetProject', () => {
  it('summarizes memories + skills', () => {
    const idx = brainIndex(PH)
    expect(idx.memories.length).toBeGreaterThan(0)
    expect(idx.skills.length).toBeGreaterThan(0)
  })

  it('forgetProject wipes the project dir', () => {
    forgetProject(PH)
    expect(existsSync(join(learningRoot(), 'projects', PH))).toBe(false)
    expect(readMemories(PH)).toEqual([])
  })
})
