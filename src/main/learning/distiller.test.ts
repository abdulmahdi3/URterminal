import { describe, it, expect } from 'vitest'
import {
  buildDistillPrompt,
  extractJson,
  parseDistillResponse,
  distill,
  type DistillInput
} from './distiller'
import type { Candidate } from './heuristics'
import type { TurnRecord } from './store'

function turn(id: string, user: string, agent: string): TurnRecord {
  return {
    v: 1,
    turnId: id,
    ts: 1,
    paneId: 'p',
    sessionId: 's',
    agentId: 'claude',
    cwd: '/proj',
    projectHash: 'proj0001',
    turnIndex: 0,
    user: { text: user, ts: 1 },
    agent: { text: agent, durationMs: 1, exitMarker: 'idle' },
    channel: 'ansi-scrape',
    scrubbed: true,
    truncated: false
  }
}

const candidate: Candidate = {
  kind: 'explicit-teach',
  turnIds: ['t1'],
  agentId: 'claude',
  projectHash: 'proj0001',
  cwd: '/proj',
  summary: 'User instruction: use vitest',
  hash: 'h1',
  createdTs: 1
}

const input: DistillInput = {
  candidates: [candidate],
  turns: [turn('t1', 'remember we use vitest', 'understood')],
  index: { memories: [{ slug: 'old', title: 'Old fact', confidence: 0.6 }], skills: [] },
  projectHash: 'proj0001'
}

describe('buildDistillPrompt', () => {
  it('includes existing slugs, the candidate, and the transcript', () => {
    const p = buildDistillPrompt(input)
    expect(p).toContain('old: Old fact')
    expect(p).toContain('use vitest')
    expect(p).toContain('USER: remember we use vitest')
    expect(p).toContain('AGENT (claude): understood')
  })
})

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"ops":[]}')).toEqual({ ops: [] })
  })
  it('parses JSON inside a ```json fence with surrounding prose', () => {
    const raw = 'Here you go:\n```json\n{"ops":[{"op":"noop","kind":"memory","slug":"x"}]}\n```\nDone.'
    expect((extractJson(raw) as { ops: unknown[] }).ops).toHaveLength(1)
  })
  it('returns null on junk', () => {
    expect(extractJson('no json here')).toBeNull()
  })
})

describe('parseDistillResponse', () => {
  it('keeps valid ops and drops invalid ones', () => {
    const raw = JSON.stringify({
      ops: [
        { op: 'add', kind: 'memory', slug: 'a', title: 'A', body: 'body a', confidence: 0.9 },
        { op: 'bogus', kind: 'memory', slug: 'b', title: 'B', body: 'b' },
        { op: 'add', kind: 'memory', slug: '', title: 'no slug', body: 'x' }
      ]
    })
    const ops = parseDistillResponse(raw)
    expect(ops).toHaveLength(1)
    expect(ops[0].slug).toBe('a')
  })

  it('re-scrubs secrets in generated bodies', () => {
    const raw = JSON.stringify({
      ops: [{ op: 'add', kind: 'memory', slug: 'a', title: 'A', body: 'token sk-' + 'Z9y8X7w6'.repeat(3), confidence: 0.8 }]
    })
    const ops = parseDistillResponse(raw)
    expect(ops[0].body).toContain('redacted')
    expect(ops[0].body).not.toContain('sk-Z9y8')
  })

  it('returns [] when there are no ops', () => {
    expect(parseDistillResponse('{"nope":1}')).toEqual([])
  })
})

describe('distill', () => {
  it('runs the injected model and returns parsed ops', async () => {
    let sawSystem = ''
    let sawPrompt = ''
    const runModel = async (system: string, prompt: string): Promise<string> => {
      sawSystem = system
      sawPrompt = prompt
      return '{"ops":[{"op":"add","kind":"memory","slug":"use-vitest","title":"Use vitest","body":"This repo uses vitest","confidence":0.85}]}'
    }
    const ops = await distill(input, runModel)
    expect(sawSystem).toContain('distill')
    expect(sawPrompt).toContain('use vitest')
    expect(ops).toHaveLength(1)
    expect(ops[0].slug).toBe('use-vitest')
  })

  it('short-circuits with no candidates (no model call)', async () => {
    let called = false
    const ops = await distill({ ...input, candidates: [] }, async () => {
      called = true
      return '{}'
    })
    expect(called).toBe(false)
    expect(ops).toEqual([])
  })
})
