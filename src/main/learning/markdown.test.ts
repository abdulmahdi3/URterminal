import { describe, it, expect } from 'vitest'
import {
  serializeMemory,
  parseMemory,
  serializeSkill,
  parseSkill,
  toFrontmatter,
  fromFrontmatter,
  slugify,
  today,
  scrubEntryText,
  type MemoryEntry,
  type SkillEntry
} from './markdown'

const mem: MemoryEntry = {
  title: 'Tests run via vitest',
  slug: 'tests-via-vitest',
  kind: 'memory',
  scope: 'project',
  agentScope: 'all',
  project: 'proj0001',
  sourceAgents: ['claude', 'codex'],
  confidence: 0.82,
  hits: 3,
  created: '2026-05-31',
  updated: '2026-05-31',
  lastSeen: '2026-05-31',
  evidence: ['t1', 't2'],
  supersedes: [],
  body: 'This repo runs tests with `npm test` → vitest.'
}

describe('frontmatter', () => {
  it('round-trips scalars and arrays', () => {
    const doc = toFrontmatter(
      [
        ['a', 'hello'],
        ['n', 42],
        ['b', true],
        ['list', ['x', 'y']]
      ],
      'body here'
    )
    const { fields, body } = fromFrontmatter(doc)
    expect(fields.a).toBe('hello')
    expect(fields.n).toBe(42)
    expect(fields.b).toBe(true)
    expect(fields.list).toEqual(['x', 'y'])
    expect(body.trim()).toBe('body here')
  })

  it('quotes values containing colons', () => {
    const doc = toFrontmatter([['t', 'a: b']], 'x')
    expect(fromFrontmatter(doc).fields.t).toBe('a: b')
  })

  it('tolerates a doc with no frontmatter', () => {
    const { fields, body } = fromFrontmatter('just text')
    expect(fields).toEqual({})
    expect(body).toBe('just text')
  })
})

describe('memory (de)serialization', () => {
  it('round-trips a memory entry', () => {
    const back = parseMemory(serializeMemory(mem))
    expect(back).toEqual(mem)
  })

  it('emits the expected frontmatter keys', () => {
    const text = serializeMemory(mem)
    expect(text).toContain('kind: memory')
    expect(text).toContain('source_agents: [claude, codex]')
    expect(text).toContain('confidence: 0.82')
  })
})

describe('skill (de)serialization', () => {
  it('round-trips a skill entry', () => {
    const skill: SkillEntry = {
      name: 'ship-release',
      slug: 'ship-release',
      kind: 'skill',
      scope: 'project',
      description: 'Build + publish the Windows setup.exe',
      agents: ['claude'],
      trigger: 'when cutting a release',
      project: 'proj0001',
      confidence: 0.9,
      hits: 2,
      created: '2026-05-31',
      updated: '2026-05-31',
      evidence: ['t9'],
      body: '## Steps\n1. bump version'
    }
    expect(parseSkill(serializeSkill(skill))).toEqual(skill)
  })
})

describe('helpers', () => {
  it('slugify makes a safe slug', () => {
    expect(slugify('Run The Tests!')).toBe('run-the-tests')
    expect(slugify('')).toBe('memory')
  })
  it('today formats YYYY-MM-DD', () => {
    expect(today(Date.UTC(2026, 4, 31, 12))).toMatch(/^2026-05-31$/)
  })
  it('scrubEntryText redacts secrets in generated text', () => {
    const { body } = scrubEntryText('t', 'key sk-' + 'A1b2C3d4'.repeat(3))
    expect(body).toContain('redacted')
  })
})
