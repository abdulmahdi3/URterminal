import { distill, type RunModel } from './distiller'
import { brainIndex } from './brain'
import { commitOp, ReviewQueue, type PendingOp } from './review'
import { readTurnsForProject, type LearningConfig } from './store'
import type { CandidateGate } from './candidates'
import type { DistillOp } from './merge'

/**
 * Coordinates one distillation pass for a project: pull the gated candidates,
 * fetch their transcripts, run the (injected) model, then route the resulting
 * ops by policy — auto-approve high-confidence ops straight into the brain when
 * the user opted in, otherwise queue them for review. Finally consume the
 * candidates so they aren't distilled again.
 *
 * `runModel` is injected (real adapter in production, a stub in tests), so this
 * coordinator is unit-testable without spending a token.
 */
export interface DistillOutcome {
  ops: DistillOp[]
  applied: number
  queued: PendingOp[]
}

export async function runDistillForProject(
  projectHash: string,
  gate: CandidateGate,
  runModel: RunModel,
  cfg: LearningConfig,
  review: ReviewQueue = new ReviewQueue(),
  now: number = Date.now()
): Promise<DistillOutcome> {
  const candidates = gate.pending().filter((c) => c.projectHash === projectHash)
  if (!candidates.length) return { ops: [], applied: 0, queued: [] }

  const turns = readTurnsForProject(projectHash)
  const ops = await distill(
    { candidates, turns, index: brainIndex(projectHash), projectHash },
    runModel,
    cfg.scrubExtraPatterns
  )

  let applied = 0
  const toQueue: DistillOp[] = []
  const minConf = (cfg as { autoApproveMinConfidence?: number }).autoApproveMinConfidence ?? 0.75
  for (const op of ops) {
    if (op.op === 'noop') continue
    if (cfg.autoApprove && op.confidence >= minConf) {
      commitOp(projectHash, op, now)
      applied++
    } else {
      toQueue.push(op)
    }
  }
  const queued = review.enqueue(projectHash, toQueue)

  // These candidates have been distilled — don't reconsider them.
  gate.consume(candidates.map((c) => c.hash))

  return { ops, applied, queued }
}
