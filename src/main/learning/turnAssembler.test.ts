import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TurnAssembler } from './turnAssembler'
import type { LearningConfig, TurnRecord } from './store'

const cfg =
  (o: Partial<LearningConfig> = {}) =>
  (): LearningConfig =>
    ({ turnIdleMs: 1000, maxTurnBytes: 262144, scrubExtraPatterns: [], ...o }) as LearningConfig

function make(
  out: TurnRecord[],
  overrides: Partial<LearningConfig> = {}
): TurnAssembler {
  return new TurnAssembler('pane1', 'sess1', 'claude', '/proj', cfg(overrides), (r) => out.push(r))
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('TurnAssembler', () => {
  it('flushes an agent turn after the idle gap', () => {
    const out: TurnRecord[] = []
    const a = make(out)
    a.output('hello world')
    expect(out).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    expect(out).toHaveLength(1)
    expect(out[0].agent.text).toBe('hello world')
    expect(out[0].user).toBeNull()
    expect(out[0].channel).toBe('ansi-scrape')
    expect(out[0].turnIndex).toBe(0)
  })

  it('pairs a submitted prompt with the output that follows it', () => {
    const out: TurnRecord[] = []
    const a = make(out)
    a.userTurn('run the tests', 111)
    a.output('all tests passed')
    vi.advanceTimersByTime(1000)
    expect(out).toHaveLength(1)
    expect(out[0].user?.text).toBe('run the tests')
    expect(out[0].user?.ts).toBe(111)
    expect(out[0].agent.text).toBe('all tests passed')
  })

  it('a new prompt closes the previous (agent-only) turn', () => {
    const out: TurnRecord[] = []
    const a = make(out)
    a.output('boot banner')
    a.userTurn('run the tests', 222)
    expect(out).toHaveLength(1)
    expect(out[0].user).toBeNull()
    expect(out[0].agent.text).toBe('boot banner')
    a.output('done')
    vi.advanceTimersByTime(1000)
    expect(out).toHaveLength(2)
    expect(out[1].user?.text).toBe('run the tests')
    expect(out[1].turnIndex).toBe(1)
  })

  it('strips ANSI before assembling', () => {
    const out: TurnRecord[] = []
    const a = make(out)
    a.output('\x1b[32mgreen\x1b[0m text')
    vi.advanceTimersByTime(1000)
    expect(out[0].agent.text).toBe('green text')
  })

  it('scrubs secrets before emitting', () => {
    const out: TurnRecord[] = []
    const a = make(out)
    a.output('here is sk-' + 'Z9y8X7w6'.repeat(3))
    vi.advanceTimersByTime(1000)
    expect(out[0].agent.text).not.toContain('sk-Z9y8')
    expect(out[0].agent.text).toContain('redacted')
    expect(out[0].scrubbed).toBe(true)
  })

  it('bounds the buffer and flags truncation', () => {
    const out: TurnRecord[] = []
    const a = make(out, { maxTurnBytes: 4096 })
    a.output('x'.repeat(5000))
    vi.advanceTimersByTime(1000)
    expect(out[0].truncated).toBe(true)
    expect(out[0].agent.text.length).toBe(4096)
  })

  it('flushes remaining content on end()', () => {
    const out: TurnRecord[] = []
    const a = make(out)
    a.userTurn('q', 1)
    a.output('partial answer')
    a.end()
    expect(out).toHaveLength(1)
    expect(out[0].agent.exitMarker).toBe('exit')
  })

  it('emits nothing for an empty/whitespace-only turn', () => {
    const out: TurnRecord[] = []
    const a = make(out)
    a.output('   \n  ')
    vi.advanceTimersByTime(1000)
    expect(out).toHaveLength(0)
  })
})
