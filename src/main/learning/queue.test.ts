import { describe, it, expect } from 'vitest'
import { LearningQueue } from './queue'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('LearningQueue', () => {
  it('runs tasks strictly in submission order', async () => {
    const q = new LearningQueue()
    const order: number[] = []
    const p1 = q.add(async () => {
      await delay(30)
      order.push(1)
    })
    const p2 = q.add(async () => {
      await delay(5)
      order.push(2)
    })
    const p3 = q.add(async () => {
      order.push(3)
    })
    await Promise.all([p1, p2, p3])
    expect(order).toEqual([1, 2, 3])
  })

  it('never overlaps tasks (concurrency 1)', async () => {
    const q = new LearningQueue()
    let active = 0
    let maxActive = 0
    const work = async (): Promise<void> => {
      active++
      maxActive = Math.max(maxActive, active)
      await delay(10)
      active--
    }
    await Promise.all([q.add(work), q.add(work), q.add(work)])
    expect(maxActive).toBe(1)
  })

  it('returns each task result to its caller', async () => {
    const q = new LearningQueue()
    await expect(q.add(async () => 42)).resolves.toBe(42)
  })

  it('isolates a failing task and keeps the chain alive', async () => {
    const q = new LearningQueue()
    const bad = q.add(async () => {
      throw new Error('boom')
    })
    await expect(bad).rejects.toThrow('boom')
    await expect(q.add(async () => 'ok')).resolves.toBe('ok')
  })

  it('tracks pending depth and drains to zero', async () => {
    const q = new LearningQueue()
    q.add(() => delay(10))
    q.add(() => delay(10))
    expect(q.pending).toBe(2)
    await q.idle()
    expect(q.pending).toBe(0)
  })
})
