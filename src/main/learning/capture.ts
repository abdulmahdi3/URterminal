import { TurnAssembler } from './turnAssembler'
import { CandidateGate } from './candidates'
import { runDistillForProject, type DistillOutcome } from './distillRunner'
import { getRunModel } from './model'
import { ReviewQueue, commitOp, type PendingOp } from './review'
import { brainIndex } from './brain'
import { appendTurn, getLearningConfig, type LearningConfig, type TurnRecord } from './store'
import type { Candidate } from './heuristics'
import type { DistillOp } from './merge'

// Drop a turn marker that's an exact duplicate of the previous one for the same
// pane within this window — defends against a mirrored renderer double-delivering
// the same submitted prompt across windows.
const COALESCE_MS = 250

/**
 * The tap that PtyManager calls. Keeps one TurnAssembler per pane, routes raw
 * output plus clean user-turn markers into it, then feeds each completed turn to
 * both the on-disk transcript store and the zero-token candidate gate.
 *
 * Entirely no-op unless the learning layer is enabled AND capture is on, so the
 * hot path (every PTY byte, every keystroke turn) stays cheap when the feature
 * is off — which is the default. Capture lives wholly in the main process, so it
 * sees each pty exactly once regardless of how many windows render it; that is
 * what makes multi-window de-duplication structural rather than something we
 * have to police.
 */
export interface CaptureSink {
  onSessionStart(p: { ptyId: string; paneId: string; agentId: string; cwd: string }): void
  onPtyData(paneId: string, chunk: string): void
  onUserTurn(paneId: string, text: string, ts: number): void
  onSessionEnd(paneId: string): void
}

export class CaptureService implements CaptureSink {
  // Keyed by paneId: at most one live pty per pane, and the renderer turn marker
  // arrives by paneId. A re-spawn in the same pane replaces the assembler.
  private assemblers = new Map<string, TurnAssembler>()
  // Last submitted prompt per pane, for coalescing duplicate markers.
  private lastTurn = new Map<string, { text: string; ts: number }>()
  // Lazily constructed (reads state.json) — only once a turn actually completes.
  private gate: CandidateGate | null = null

  /**
   * @param onCandidates Called with any NEW gate candidates a completed turn
   *   produced, so the IPC layer can broadcast them to the review UI.
   */
  constructor(private readonly onCandidates?: (c: Candidate[]) => void) {}

  private cfg(): LearningConfig {
    return getLearningConfig()
  }

  private active(): boolean {
    const c = this.cfg()
    return c.enabled && c.capture
  }

  /** Persist + gate one completed turn. Wired as the TurnAssembler emit sink. */
  private handleTurn(rec: TurnRecord): void {
    appendTurn(rec)
    try {
      if (!this.gate) this.gate = new CandidateGate()
      const fresh = this.gate.ingest(rec)
      if (fresh.length) this.onCandidates?.(fresh)
    } catch {
      /* gating must never break capture */
    }
  }

  onSessionStart({ ptyId, paneId, agentId, cwd }: { ptyId: string; paneId: string; agentId: string; cwd: string }): void {
    if (!this.active()) return
    // v1: capture only AI-agent panes. Shells/SSH spawn with no agent command,
    // so an empty agentId means "not an agent" — skip it to cut noise + surface.
    if (this.cfg().aiOnly && !agentId) return
    this.assemblers.get(paneId)?.end()
    this.assemblers.set(
      paneId,
      new TurnAssembler(paneId, ptyId, agentId, cwd, () => this.cfg(), (rec) => this.handleTurn(rec))
    )
  }

  onPtyData(paneId: string, chunk: string): void {
    if (!this.active()) return
    this.assemblers.get(paneId)?.output(chunk)
  }

  onUserTurn(paneId: string, text: string, ts: number): void {
    if (!this.active()) return
    const t = text.trim()
    if (!t) return
    const prev = this.lastTurn.get(paneId)
    if (prev && prev.text === t && ts - prev.ts < COALESCE_MS) return
    this.lastTurn.set(paneId, { text: t, ts })
    this.assemblers.get(paneId)?.userTurn(t, ts)
  }

  onSessionEnd(paneId: string): void {
    this.lastTurn.delete(paneId)
    const a = this.assemblers.get(paneId)
    if (!a) return
    a.end()
    this.assemblers.delete(paneId)
  }

  /** Current candidate review queue (for the renderer's learning panel). */
  listCandidates(): Candidate[] {
    try {
      if (!this.gate) this.gate = new CandidateGate()
      return this.gate.pending()
    } catch {
      return []
    }
  }

  private ensureGate(): CandidateGate {
    if (!this.gate) this.gate = new CandidateGate()
    return this.gate
  }

  /**
   * Run a distillation pass (a model call — the only egress point). Requires the
   * separate egress gate `egressAllowed`. Distils the given project, or every
   * project with pending candidates. Returns a summary for the caller to relay.
   */
  async distill(projectHash?: string): Promise<DistillOutcome> {
    const cfg = this.cfg()
    if (!cfg.enabled || !cfg.egressAllowed) {
      throw new Error('Distillation is off — enable learning + the distill (egress) toggle first.')
    }
    const gate = this.ensureGate()
    const review = new ReviewQueue()
    const runModel = getRunModel(cfg)
    const projects = projectHash ? [projectHash] : gate.projectsWithPending()
    const merged: DistillOutcome = { ops: [], applied: 0, queued: [] }
    for (const ph of projects) {
      const r = await runDistillForProject(ph, gate, runModel, cfg, review)
      merged.ops.push(...r.ops)
      merged.applied += r.applied
      merged.queued.push(...r.queued)
    }
    return merged
  }

  /** Pending distilled ops awaiting the user's approval. */
  listPendingOps(): PendingOp[] {
    try {
      return new ReviewQueue().list()
    } catch {
      return []
    }
  }

  /** Approve a pending op → write it into the brain. */
  approveOp(id: string): boolean {
    return new ReviewQueue().approve(id)
  }

  /** Reject (discard) a pending op. */
  rejectOp(id: string): void {
    new ReviewQueue().reject(id)
  }

  /** Directly commit an op (used by tests / future auto-approve paths). */
  commit(projectHash: string, op: DistillOp): void {
    commitOp(projectHash, op)
  }

  /** The current brain index for a scope (memories + skills), for the UI. */
  brain(projectHash: string | null): ReturnType<typeof brainIndex> {
    return brainIndex(projectHash)
  }
}
