import { createHash } from 'crypto'
import type { TurnRecord } from './store'

/**
 * The zero-token distillation gate. Before ANY model is ever called (a later
 * slice), captured turns are run through these pure, deterministic heuristics to
 * decide which exchanges are even worth distilling. Turns that hit no heuristic
 * are dropped here and never cost a token.
 *
 * Everything in this file is side-effect-free and Electron-free so it is fully
 * unit-testable; the caller (the Gate) owns buffering, persistence and dedup.
 */

export type HeuristicKind =
  | 'error-fix' // an errored turn later followed by a clean one (a fix)
  | 'user-correction' // the user pushed back / corrected the agent
  | 'repeated-command' // a command issued enough times to be worth a skill
  | 'explicit-teach' // the user explicitly stated a durable preference/rule
  | 'novel-success' // a not-seen-before command that completed without error

/** A cluster of turns worth distilling, with WHY and a stable idempotency hash. */
export interface Candidate {
  kind: HeuristicKind
  turnIds: string[]
  agentId: string
  projectHash: string
  cwd: string
  /** One-line, human-readable reason — shown in the review queue. */
  summary: string
  /** Stable content hash so the same exchange is never queued twice. */
  hash: string
  createdTs: number
}

export interface GateOptions {
  /** Skip a turn whose combined user+agent text is shorter than this. */
  minChars: number
  /** Prior occurrence count of each normalized command in this project. */
  commandCounts: Record<string, number>
  /** Times a command must be seen (incl. priors) to become a repeated-command. */
  repeatThreshold?: number
}

const ERROR_RE =
  /\b(error|errors|exception|traceback|fatal|failed|failure|cannot|command not found|no such file|segfault|panic|unhandled|non-zero exit|\bFAIL\b)\b/i
const CORRECTION_RE = /^(no|nope|actually|wait|stop|undo|that'?s wrong|don'?t|do not|not quite)\b/i
const TEACH_RE = /\b(remember (?:that|to)|from now on|always|never|note that|keep in mind|please always|make sure to)\b/i

/** Normalize a command/prompt for counting + hashing (case/space-insensitive). */
export function normalizeCommand(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function hasError(t: TurnRecord): boolean {
  return ERROR_RE.test(t.agent.text)
}

function hashKey(kind: HeuristicKind, projectHash: string, key: string): string {
  return createHash('sha1').update(`${kind}|${projectHash}|${normalizeCommand(key)}`).digest('hex').slice(0, 16)
}

/** Levenshtein distance, capped — used to spot a user re-issuing a near-dup command. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let cur = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

function firstErrorLine(text: string): string {
  for (const line of text.split('\n')) if (ERROR_RE.test(line)) return line.trim()
  return text.slice(0, 80)
}

/**
 * Run all heuristics over a per-project buffer of recent turns and return every
 * candidate found. The caller dedups the result against already-seen hashes, so
 * returning the same candidate across calls is harmless.
 */
export function runHeuristics(turns: TurnRecord[], opts: GateOptions): Candidate[] {
  const out: Candidate[] = []
  if (!turns.length) return out
  const repeatThreshold = opts.repeatThreshold ?? 3

  const push = (kind: HeuristicKind, key: string, turnIds: string[], summary: string): void => {
    const ref = turns[turns.length - 1]
    out.push({
      kind,
      turnIds,
      agentId: ref.agentId,
      projectHash: ref.projectHash,
      cwd: ref.cwd,
      summary,
      hash: hashKey(kind, ref.projectHash, key),
      createdTs: ref.ts
    })
  }

  const long = (t: TurnRecord): boolean =>
    (t.user?.text.length ?? 0) + t.agent.text.length >= opts.minChars

  // error -> fix: an errored turn followed (same pane) by a later clean turn.
  for (let i = 0; i < turns.length; i++) {
    if (!hasError(turns[i])) continue
    for (let j = i + 1; j < turns.length; j++) {
      if (turns[j].paneId !== turns[i].paneId) continue
      if (!hasError(turns[j]) && turns[j].agent.text.trim()) {
        push(
          'error-fix',
          firstErrorLine(turns[i].agent.text),
          [turns[i].turnId, turns[j].turnId],
          `Recovered from: ${firstErrorLine(turns[i].agent.text).slice(0, 60)}`
        )
        break
      }
    }
  }

  for (let i = 0; i < turns.length; i++) {
    const u = turns[i].user?.text?.trim()
    if (!u) continue

    // explicit teach: the user stated a durable rule/preference.
    if (TEACH_RE.test(u)) {
      push('explicit-teach', u, [turns[i].turnId], `User instruction: ${u.slice(0, 60)}`)
    }

    // user correction: pushback phrase, or a near-dup of the previous command.
    let corrected = CORRECTION_RE.test(u)
    if (!corrected && i > 0) {
      const prevU = turns[i - 1].user?.text?.trim()
      if (prevU && prevU !== u && Math.max(prevU.length, u.length) > 4) {
        const d = editDistance(normalizeCommand(prevU), normalizeCommand(u))
        if (d > 0 && d <= 2) corrected = true
      }
    }
    if (corrected) {
      const ids = i > 0 ? [turns[i - 1].turnId, turns[i].turnId] : [turns[i].turnId]
      push('user-correction', u, ids, `User corrected the agent: ${u.slice(0, 60)}`)
    }
  }

  // repeated-command / novel-success: judged on the most recent turn's command.
  const last = turns[turns.length - 1]
  const lastCmd = last.user?.text?.trim()
  if (lastCmd && long(last)) {
    const norm = normalizeCommand(lastCmd)
    const total = (opts.commandCounts[norm] ?? 0) + 1
    if (total >= repeatThreshold) {
      push('repeated-command', norm, [last.turnId], `Repeated ${total}×: ${lastCmd.slice(0, 60)}`)
    } else if (total === 1 && !hasError(last) && last.agent.text.trim()) {
      push('novel-success', norm, [last.turnId], `New successful flow: ${lastCmd.slice(0, 60)}`)
    }
  }

  return out
}
