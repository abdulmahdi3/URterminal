import { describe, it, expect } from 'vitest'
import { runHeuristics, normalizeCommand, editDistance, type Candidate } from './heuristics'
import type { TurnRecord } from './store'

let seq = 0
function turn(p: Partial<TurnRecord> & { agent?: Partial<TurnRecord['agent']> }): TurnRecord {
  seq++
  return {
    v: 1,
    turnId: p.turnId ?? `t${seq}`,
    ts: p.ts ?? seq * 1000,
    paneId: p.paneId ?? 'pane1',
    sessionId: 's1',
    agentId: p.agentId ?? 'claude',
    cwd: p.cwd ?? '/proj',
    projectHash: p.projectHash ?? 'proj0001',
    turnIndex: seq,
    user: p.user === null ? null : (p.user ?? { text: 'do a thing here', ts: seq * 1000 }),
    agent: { text: '', durationMs: 1, exitMarker: 'idle', ...(p.agent ?? {}) },
    channel: 'ansi-scrape',
    scrubbed: true,
    truncated: false
  }
}

const opts = (commandCounts: Record<string, number> = {}) => ({ minChars: 5, commandCounts })

describe('normalizeCommand', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeCommand('  Run   The  TESTS ')).toBe('run the tests')
  })
})

describe('editDistance', () => {
  it('is 0 for identical strings', () => expect(editDistance('abc', 'abc')).toBe(0))
  it('counts single edits', () => expect(editDistance('abc', 'abd')).toBe(1))
  it('handles empty strings', () => expect(editDistance('', 'abc')).toBe(3))
})

describe('runHeuristics', () => {
  it('detects an error followed by a clean fix', () => {
    const turns = [
      turn({ user: { text: 'build it', ts: 1 }, agent: { text: 'Error: missing semicolon', durationMs: 1, exitMarker: 'idle' } }),
      turn({ user: { text: 'fix and rebuild', ts: 2 }, agent: { text: 'Build succeeded', durationMs: 1, exitMarker: 'idle' } })
    ]
    const c = runHeuristics(turns, opts())
    expect(c.some((x) => x.kind === 'error-fix')).toBe(true)
  })

  it('detects an explicit teach instruction', () => {
    const turns = [turn({ user: { text: 'remember that we use pnpm not npm', ts: 1 }, agent: { text: 'ok', durationMs: 1, exitMarker: 'idle' } })]
    const c = runHeuristics(turns, opts())
    expect(c.some((x) => x.kind === 'explicit-teach')).toBe(true)
  })

  it('detects a user correction by pushback phrase', () => {
    const turns = [
      turn({ user: { text: 'use jest', ts: 1 }, agent: { text: 'ok', durationMs: 1, exitMarker: 'idle' } }),
      turn({ user: { text: "no, that's wrong, use vitest", ts: 2 }, agent: { text: 'ok', durationMs: 1, exitMarker: 'idle' } })
    ]
    const c = runHeuristics(turns, opts())
    expect(c.some((x) => x.kind === 'user-correction')).toBe(true)
  })

  it('detects a near-duplicate re-issued command as a correction', () => {
    const turns = [
      turn({ user: { text: 'deploy staging', ts: 1 }, agent: { text: 'done', durationMs: 1, exitMarker: 'idle' } }),
      turn({ user: { text: 'deploy stagin', ts: 2 }, agent: { text: 'done', durationMs: 1, exitMarker: 'idle' } })
    ]
    const c = runHeuristics(turns, opts())
    expect(c.some((x) => x.kind === 'user-correction')).toBe(true)
  })

  it('promotes a command seen enough times to repeated-command', () => {
    const turns = [turn({ user: { text: 'npm run build', ts: 1 }, agent: { text: 'ok done', durationMs: 1, exitMarker: 'idle' } })]
    const c = runHeuristics(turns, opts({ 'npm run build': 2 })) // prior 2 + this = 3
    expect(c.some((x) => x.kind === 'repeated-command')).toBe(true)
  })

  it('flags a brand-new successful command as novel-success', () => {
    const turns = [turn({ user: { text: 'cargo test --all', ts: 1 }, agent: { text: 'test result: ok', durationMs: 1, exitMarker: 'idle' } })]
    const c = runHeuristics(turns, opts())
    expect(c.some((x) => x.kind === 'novel-success')).toBe(true)
  })

  it('does NOT flag novel-success when the command errored', () => {
    const turns = [turn({ user: { text: 'cargo test --all', ts: 1 }, agent: { text: 'error: build failed', durationMs: 1, exitMarker: 'idle' } })]
    const c = runHeuristics(turns, opts())
    expect(c.some((x) => x.kind === 'novel-success')).toBe(false)
  })

  it('skips a turn below the minChars guard', () => {
    const turns = [turn({ user: { text: 'x', ts: 1 }, agent: { text: 'y', durationMs: 1, exitMarker: 'idle' } })]
    const c = runHeuristics(turns, { minChars: 1000, commandCounts: {} })
    expect(c.filter((x) => x.kind === 'novel-success' || x.kind === 'repeated-command')).toHaveLength(0)
  })

  it('produces a stable hash for the same exchange', () => {
    const mk = (): Candidate[] =>
      runHeuristics([turn({ turnId: 'fixed', user: { text: 'remember to lint', ts: 1 }, agent: { text: 'ok', durationMs: 1, exitMarker: 'idle' } })], opts())
    const a = mk().find((x) => x.kind === 'explicit-teach')!
    const b = mk().find((x) => x.kind === 'explicit-teach')!
    expect(a.hash).toBe(b.hash)
  })

  it('returns nothing for an empty buffer', () => {
    expect(runHeuristics([], opts())).toHaveLength(0)
  })
})
