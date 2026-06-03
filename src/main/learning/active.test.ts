import { describe, it, expect } from 'vitest'
import { buildActivePreamble } from './inject'
import type { MemoryEntry, SkillEntry } from './markdown'

function mem(body: string, conf = 0.8): MemoryEntry {
  return {
    title: body.slice(0, 10),
    slug: body.slice(0, 10),
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

describe('buildActivePreamble', () => {
  it('returns a framed context note from memories', () => {
    const out = buildActivePreamble([mem('use pnpm not npm')], [])
    expect(out).toContain('Relevant learned context')
    expect(out).toContain('use pnpm not npm')
  })

  it('orders by confidence', () => {
    const out = buildActivePreamble([mem('low', 0.2), mem('high', 0.95)], [])
    expect(out.indexOf('high')).toBeLessThan(out.indexOf('low'))
  })

  it('includes skills', () => {
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
      body: ''
    }
    expect(buildActivePreamble([], [skill])).toContain('skill: ship')
  })

  it('returns empty string when there is nothing to inject', () => {
    expect(buildActivePreamble([], [])).toBe('')
  })

  it('respects the char budget', () => {
    const many = Array.from({ length: 100 }, (_, i) => mem(`fact ${i} with some length to it`))
    expect(buildActivePreamble(many, [], 200).length).toBeLessThan(300)
  })
})
