import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { learningRoot, type TurnRecord } from './store'
import { runHeuristics, normalizeCommand, type Candidate } from './heuristics'

/**
 * The distillation gate's persistent brain-stem: it buffers recent turns per
 * project, runs the zero-token heuristics on every new turn, dedups the results,
 * and keeps a pending queue of candidates in `state.json` for later review /
 * distillation. Nothing here calls a model — it is purely "what WOULD be worth
 * learning", made observable before a single token is spent.
 *
 *   {userData}/learning/state.json
 *     { version, pending: Candidate[], commandCounts: { [projectHash]: { [cmd]: n } } }
 */

const STATE_VERSION = 1
const BUFFER_PER_PROJECT = 30 // recent turns kept in memory for cross-turn rules
const MAX_PENDING = 300 // cap the review queue (drop oldest)
const MAX_CMDS_PER_PROJECT = 500 // cap command-frequency memory
const MIN_CHARS = 40 // skip trivially short exchanges

interface LearnState {
  version: number
  pending: Candidate[]
  commandCounts: Record<string, Record<string, number>>
}

function statePath(): string {
  return join(learningRoot(), 'state.json')
}

function emptyState(): LearnState {
  return { version: STATE_VERSION, pending: [], commandCounts: {} }
}

export class CandidateGate {
  private state: LearnState
  private buffers = new Map<string, TurnRecord[]>() // keyed by projectHash
  private seen = new Set<string>()

  constructor() {
    this.state = this.load()
    for (const c of this.state.pending) this.seen.add(c.hash)
  }

  private load(): LearnState {
    try {
      const raw = JSON.parse(readFileSync(statePath(), 'utf8')) as LearnState
      return { ...emptyState(), ...raw }
    } catch {
      return emptyState()
    }
  }

  private save(): void {
    try {
      const dir = learningRoot()
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(statePath(), JSON.stringify(this.state), 'utf8')
    } catch {
      /* gate state is best-effort — never crash on a write */
    }
  }

  /**
   * Ingest one completed turn. Returns any NEW candidates it produced (already
   * added to the pending queue + persisted). Caller broadcasts them to the UI.
   */
  ingest(rec: TurnRecord): Candidate[] {
    const ph = rec.projectHash
    const buf = this.buffers.get(ph) ?? []
    buf.push(rec)
    if (buf.length > BUFFER_PER_PROJECT) buf.shift()
    this.buffers.set(ph, buf)

    const counts = this.state.commandCounts[ph] ?? {}
    const found = runHeuristics(buf, { minChars: MIN_CHARS, commandCounts: counts })

    // Update command frequency from this turn's command AFTER gating (so the
    // repeat threshold counts prior occurrences, not the current one twice).
    const cmd = rec.user?.text?.trim()
    if (cmd) {
      const norm = normalizeCommand(cmd)
      counts[norm] = (counts[norm] ?? 0) + 1
      // Bound the per-project command map: drop the least-frequent keys.
      const keys = Object.keys(counts)
      if (keys.length > MAX_CMDS_PER_PROJECT) {
        keys
          .sort((a, b) => counts[a] - counts[b])
          .slice(0, keys.length - MAX_CMDS_PER_PROJECT)
          .forEach((k) => delete counts[k])
      }
      this.state.commandCounts[ph] = counts
    }

    const fresh = found.filter((c) => !this.seen.has(c.hash))
    if (fresh.length) {
      for (const c of fresh) this.seen.add(c.hash)
      this.state.pending.push(...fresh)
      if (this.state.pending.length > MAX_PENDING) {
        const dropped = this.state.pending.splice(0, this.state.pending.length - MAX_PENDING)
        for (const d of dropped) this.seen.delete(d.hash)
      }
    }
    this.save()
    return fresh
  }

  /** Forget a pane's buffer on session end (state.json is unaffected). */
  endPane(): void {
    // Buffers are keyed by project, shared across that project's panes, so there
    // is nothing pane-specific to evict here; kept for symmetry with capture.
  }

  /** The current review queue. */
  pending(): Candidate[] {
    return this.state.pending
  }

  /** Counts of pending candidates by heuristic kind (for the status pill). */
  summary(): { total: number; byKind: Record<string, number> } {
    const byKind: Record<string, number> = {}
    for (const c of this.state.pending) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1
    return { total: this.state.pending.length, byKind }
  }
}
