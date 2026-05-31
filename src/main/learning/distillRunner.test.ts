import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const dir = mkdtempSync(join(tmpdir(), 'urt-runner-test-'))
  return { app: { getPath: (): string => dir } }
})

import { runDistillForProject } from './distillRunner'
import { CandidateGate } from './candidates'
import { ReviewQueue } from './review'
import { readMemories } from './brain'
import { setLearningConfig, getLearningConfig, type TurnRecord, type LearningConfig } from './store'

const PH = 'projrunner1'

function ingestTeach(gate: CandidateGate): TurnRecord {
  const rec: TurnRecord = {
    v: 1,
    turnId: 'tr1',
    ts: Date.now(),
    paneId: 'p',
    sessionId: 's',
    agentId: 'claude',
    cwd: '/proj',
    projectHash: PH,
    turnIndex: 0,
    user: { text: 'remember that this repo always deploys with make ship', ts: Date.now() },
    agent: { text: 'understood, noted for the future', durationMs: 1, exitMarker: 'idle' },
    channel: 'ansi-scrape',
    scrubbed: true,
    truncated: false
  }
  gate.ingest(rec)
  return rec
}

const fakeModel = (json: string) => async () => json

describe('runDistillForProject', () => {
  it('queues ops for review by default (autoApprove off)', async () => {
    const gate = new CandidateGate()
    ingestTeach(gate)
    const review = new ReviewQueue()
    const cfg = getLearningConfig()
    const out = await runDistillForProject(
      PH,
      gate,
      fakeModel('{"ops":[{"op":"add","kind":"memory","slug":"deploy-make-ship","title":"Deploy with make ship","body":"This repo deploys via make ship","confidence":0.9}]}'),
      cfg,
      review
    )
    expect(out.ops).toHaveLength(1)
    expect(out.applied).toBe(0)
    expect(out.queued).toHaveLength(1)
    // nothing written to the brain yet
    expect(readMemories(PH).some((m) => m.slug === 'deploy-make-ship')).toBe(false)
    // candidate consumed so it won't be re-distilled
    expect(gate.pending().some((c) => c.projectHash === PH)).toBe(false)
  })

  it('auto-applies high-confidence ops when autoApprove is on', async () => {
    const gate = new CandidateGate()
    ingestTeach(gate)
    const cfg: LearningConfig = { ...getLearningConfig(), autoApprove: true, autoApproveMinConfidence: 0.75 }
    const out = await runDistillForProject(
      PH,
      gate,
      fakeModel('{"ops":[{"op":"add","kind":"memory","slug":"auto-fact","title":"Auto fact","body":"Learned automatically","confidence":0.95}]}'),
      cfg,
      new ReviewQueue()
    )
    expect(out.applied).toBe(1)
    expect(readMemories(PH).some((m) => m.slug === 'auto-fact')).toBe(true)
  })

  it('does nothing when there are no candidates', async () => {
    const gate = new CandidateGate()
    let called = false
    const out = await runDistillForProject(
      'emptyproj',
      gate,
      async () => {
        called = true
        return '{}'
      },
      getLearningConfig(),
      new ReviewQueue()
    )
    expect(called).toBe(false)
    expect(out.ops).toEqual([])
  })
})

// keep setLearningConfig referenced (used to reset cached config if needed)
void setLearningConfig
