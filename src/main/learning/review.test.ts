import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const dir = mkdtempSync(join(tmpdir(), 'urt-review-test-'))
  return { app: { getPath: (): string => dir } }
})

import { ReviewQueue, commitOp } from './review'
import { readMemories, readSkills } from './brain'
import type { DistillOp } from './merge'

const PH = 'projreview1'
const memOp = (slug: string): DistillOp => ({
  op: 'add',
  kind: 'memory',
  slug,
  title: `Mem ${slug}`,
  body: `Body ${slug}`,
  confidence: 0.8
})

describe('ReviewQueue', () => {
  it('enqueues non-noop ops and lists them', () => {
    const q = new ReviewQueue()
    const created = q.enqueue(PH, [memOp('a'), { ...memOp('b'), op: 'noop' }])
    expect(created).toHaveLength(1)
    expect(q.list().some((p) => p.op.slug === 'a')).toBe(true)
  })

  it('approve() writes the memory into the brain and removes it from review', () => {
    const q = new ReviewQueue()
    const [p] = q.enqueue(PH, [memOp('approved-one')])
    expect(q.approve(p.id)).toBe(true)
    expect(q.list().find((x) => x.id === p.id)).toBeUndefined()
    expect(readMemories(PH).some((m) => m.slug === 'approved-one')).toBe(true)
  })

  it('reject() discards without writing', () => {
    const q = new ReviewQueue()
    const [p] = q.enqueue(PH, [memOp('rejected-one')])
    q.reject(p.id)
    expect(q.list().find((x) => x.id === p.id)).toBeUndefined()
    expect(readMemories(PH).some((m) => m.slug === 'rejected-one')).toBe(false)
  })

  it('persists across instances', () => {
    const q1 = new ReviewQueue()
    q1.enqueue(PH, [memOp('persisted')])
    const q2 = new ReviewQueue()
    expect(q2.list().some((p) => p.op.slug === 'persisted')).toBe(true)
  })
})

describe('commitOp', () => {
  it('writes a skill op as a skill file', () => {
    commitOp(PH, {
      op: 'add',
      kind: 'skill',
      slug: 'ship-it',
      title: 'ship-it',
      body: 'Build and publish',
      confidence: 0.9
    })
    expect(readSkills(PH).some((s) => s.slug === 'ship-it')).toBe(true)
  })
})
