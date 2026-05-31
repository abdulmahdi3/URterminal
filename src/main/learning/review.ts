import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { learningRoot } from './store'
import { applyMemoryOp, type DistillOp } from './merge'
import { readMemories, writeMemories, writeSkill, regenerateIndex } from './brain'
import { slugify, today, type SkillEntry } from './markdown'

/**
 * The review-before-store queue. Distilled ops land here first; nothing touches
 * the agent-facing brain until the user approves (the chosen default —
 * autoApprove can short-circuit). Persisted to {learningRoot}/review.json so a
 * pending op survives a restart.
 */

export interface PendingOp {
  id: string
  projectHash: string
  op: DistillOp
  createdTs: number
}

interface ReviewState {
  version: number
  ops: PendingOp[]
}

function reviewPath(): string {
  return join(learningRoot(), 'review.json')
}

function load(): ReviewState {
  try {
    const raw = JSON.parse(readFileSync(reviewPath(), 'utf8')) as ReviewState
    return { version: 1, ops: Array.isArray(raw.ops) ? raw.ops : [] }
  } catch {
    return { version: 1, ops: [] }
  }
}

function save(state: ReviewState): void {
  try {
    const dir = learningRoot()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(reviewPath(), JSON.stringify(state), 'utf8')
  } catch {
    /* best-effort */
  }
}

export class ReviewQueue {
  private state: ReviewState
  constructor() {
    this.state = load()
  }

  /** Queue distilled ops for review; returns the created pending entries. */
  enqueue(projectHash: string, ops: DistillOp[]): PendingOp[] {
    const created = ops
      .filter((op) => op.op !== 'noop')
      .map((op) => ({ id: randomUUID(), projectHash, op, createdTs: Date.now() }))
    if (created.length) {
      this.state.ops.push(...created)
      save(this.state)
    }
    return created
  }

  list(): PendingOp[] {
    return this.state.ops
  }

  reject(id: string): void {
    this.state.ops = this.state.ops.filter((p) => p.id !== id)
    save(this.state)
  }

  /** Approve one pending op: merge it into the brain + write to disk. */
  approve(id: string, now: number = Date.now()): boolean {
    const idx = this.state.ops.findIndex((p) => p.id === id)
    if (idx < 0) return false
    const pending = this.state.ops[idx]
    commitOp(pending.projectHash, pending.op, now)
    this.state.ops.splice(idx, 1)
    save(this.state)
    return true
  }
}

/** Write one op straight into the brain (used by approve + autoApprove). */
export function commitOp(projectHash: string, op: DistillOp, now: number = Date.now()): void {
  const scope = op.scope === 'global' ? null : projectHash
  if (op.kind === 'skill') {
    const slug = op.slug || slugify(op.title)
    const skill: SkillEntry = {
      name: op.title,
      slug,
      kind: 'skill',
      scope: op.scope === 'global' ? 'global' : 'project',
      description: op.body.split('\n')[0].slice(0, 120),
      agents: op.agentScope && op.agentScope !== 'all' ? [op.agentScope] : [],
      trigger: '',
      project: scope ?? '',
      confidence: op.confidence,
      hits: 1,
      created: today(now),
      updated: today(now),
      evidence: op.evidence ?? [],
      body: op.body
    }
    writeSkill(scope, skill)
    return
  }
  const existing = readMemories(scope)
  const { entries } = applyMemoryOp(existing, op, { projectHash, now })
  writeMemories(scope, entries)
  regenerateIndex(scope)
}
