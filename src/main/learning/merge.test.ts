import { describe, it, expect } from 'vitest'
import { applyMemoryOp, normalizeOp, type DistillOp } from './merge'
import type { MemoryEntry } from './markdown'

const NOW = Date.UTC(2026, 4, 31, 12)

function existing(slug: string): MemoryEntry {
  return {
    title: 'old title',
    slug,
    kind: 'memory',
    scope: 'project',
    agentScope: 'all',
    project: 'proj0001',
    sourceAgents: ['claude'],
    confidence: 0.5,
    hits: 1,
    created: '2026-05-01',
    updated: '2026-05-01',
    lastSeen: '2026-05-01',
    evidence: ['t1'],
    supersedes: [],
    body: 'old body'
  }
}

const op = (over: Partial<DistillOp>): DistillOp => ({
  op: 'add',
  kind: 'memory',
  slug: 's1',
  title: 'New title',
  body: 'New body',
  confidence: 0.8,
  ...over
})

describe('applyMemoryOp', () => {
  it('adds a new entry', () => {
    const r = applyMemoryOp([], op({}), { projectHash: 'proj0001', now: NOW })
    expect(r.action).toBe('added')
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].hits).toBe(1)
    expect(r.entries[0].created).toBe('2026-05-31')
  })

  it('updates an existing entry by slug (bumps hits, unions evidence)', () => {
    const r = applyMemoryOp([existing('s1')], op({ op: 'update', evidence: ['t2'] }), {
      projectHash: 'proj0001',
      now: NOW
    })
    expect(r.action).toBe('updated')
    expect(r.entries[0].hits).toBe(2)
    expect(r.entries[0].evidence.sort()).toEqual(['t1', 't2'])
    expect(r.entries[0].confidence).toBe(0.8) // max(0.5, 0.8)
    expect(r.entries[0].body).toBe('New body')
  })

  it('treats an update of an unknown slug as an add', () => {
    const r = applyMemoryOp([existing('other')], op({ op: 'update', slug: 's1' }), {
      projectHash: 'proj0001',
      now: NOW
    })
    expect(r.action).toBe('added')
    expect(r.entries).toHaveLength(2)
  })

  it('folds an add whose slug already exists into an update', () => {
    const r = applyMemoryOp([existing('s1')], op({ op: 'add', slug: 's1' }), {
      projectHash: 'proj0001',
      now: NOW
    })
    expect(r.action).toBe('updated')
    expect(r.entries).toHaveLength(1)
  })

  it('noop leaves the list unchanged', () => {
    const list = [existing('s1')]
    const r = applyMemoryOp(list, op({ op: 'noop' }), { projectHash: 'proj0001', now: NOW })
    expect(r.action).toBe('noop')
    expect(r.entries).toBe(list)
  })

  it('drops entries an add supersedes', () => {
    const r = applyMemoryOp([existing('stale')], op({ supersedes: ['stale'] }), {
      projectHash: 'proj0001',
      now: NOW
    })
    expect(r.entries.find((e) => e.slug === 'stale')).toBeUndefined()
    expect(r.entries.find((e) => e.slug === 's1')).toBeTruthy()
  })
})

describe('normalizeOp', () => {
  it('accepts a well-formed op and clamps confidence', () => {
    const o = normalizeOp({ op: 'add', kind: 'memory', slug: 's', title: 't', body: 'b', confidence: 5 })
    expect(o?.confidence).toBe(1)
  })
  it('rejects unknown op/kind', () => {
    expect(normalizeOp({ op: 'delete', kind: 'memory', slug: 's', title: 't', body: 'b' })).toBeNull()
    expect(normalizeOp({ op: 'add', kind: 'thing', slug: 's', title: 't', body: 'b' })).toBeNull()
  })
  it('rejects add/update missing title or body', () => {
    expect(normalizeOp({ op: 'add', kind: 'memory', slug: 's', title: '', body: 'b' })).toBeNull()
  })
  it('allows a noop without title/body', () => {
    expect(normalizeOp({ op: 'noop', kind: 'memory', slug: 's' })?.op).toBe('noop')
  })
  it('rejects a missing slug', () => {
    expect(normalizeOp({ op: 'add', kind: 'memory', title: 't', body: 'b' })).toBeNull()
  })
})
