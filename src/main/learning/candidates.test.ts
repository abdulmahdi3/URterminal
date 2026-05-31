import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const dir = mkdtempSync(join(tmpdir(), 'urt-gate-test-'))
  return { app: { getPath: (): string => dir } }
})

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { CandidateGate } from './candidates'
import { learningRoot, type TurnRecord } from './store'

let seq = 0
function turn(user: string, agent: string, ph = 'projA'): TurnRecord {
  seq++
  return {
    v: 1,
    turnId: `t${seq}`,
    ts: seq * 1000,
    paneId: 'pane1',
    sessionId: 's1',
    agentId: 'claude',
    cwd: '/proj',
    projectHash: ph,
    turnIndex: seq,
    user: { text: user, ts: seq * 1000 },
    agent: { text: agent, durationMs: 1, exitMarker: 'idle' },
    channel: 'ansi-scrape',
    scrubbed: true,
    truncated: false
  }
}

describe('CandidateGate', () => {
  it('ingests a teach turn and returns a fresh candidate', () => {
    const g = new CandidateGate()
    const fresh = g.ingest(turn('remember that we deploy with make ship', 'ok, noted'))
    expect(fresh.some((c) => c.kind === 'explicit-teach')).toBe(true)
    expect(g.pending().length).toBeGreaterThan(0)
  })

  it('does not re-add the same exchange twice (idempotent by hash)', () => {
    const g = new CandidateGate()
    const a = g.ingest(turn('always run lint before commit', 'ok'))
    const before = g.pending().length
    const b = g.ingest(turn('always run lint before commit', 'ok'))
    expect(a.length).toBeGreaterThan(0)
    expect(b.filter((c) => c.kind === 'explicit-teach')).toHaveLength(0)
    expect(g.pending().length).toBe(before)
  })

  it('counts repeats across ingests and promotes to repeated-command', () => {
    // Text must clear the gate's MIN_CHARS guard to be eligible for the
    // repeated/novel command heuristics.
    const u = 'npm run build for the whole project'
    const a = 'the build completed successfully with no errors'
    const g = new CandidateGate()
    g.ingest(turn(u, a))
    g.ingest(turn(u, a))
    const third = g.ingest(turn(u, a))
    expect(third.some((c) => c.kind === 'repeated-command')).toBe(true)
  })

  it('persists pending candidates to state.json', () => {
    const g = new CandidateGate()
    g.ingest(turn('from now on use tabs not spaces', 'understood'))
    const p = join(learningRoot(), 'state.json')
    expect(existsSync(p)).toBe(true)
    const state = JSON.parse(readFileSync(p, 'utf8'))
    expect(state.pending.length).toBeGreaterThan(0)
  })

  it('reloads persisted state in a new instance (no duplicate re-add)', () => {
    const g1 = new CandidateGate()
    g1.ingest(turn('never force push to main', 'agreed'))
    const count = g1.pending().filter((c) => c.kind === 'explicit-teach').length
    const g2 = new CandidateGate()
    // same exchange should already be known → not added again
    const again = g2.ingest(turn('never force push to main', 'agreed'))
    expect(again.filter((c) => c.kind === 'explicit-teach')).toHaveLength(0)
    expect(g2.pending().filter((c) => c.kind === 'explicit-teach').length).toBe(count)
  })

  it('summary() groups pending by kind', () => {
    const g = new CandidateGate()
    g.ingest(turn('remember to bump the version', 'ok'))
    const s = g.summary()
    expect(s.total).toBeGreaterThan(0)
    expect(Object.keys(s.byKind).length).toBeGreaterThan(0)
  })
})
