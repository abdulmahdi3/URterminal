import { today } from './markdown'
import type { MemoryEntry } from './markdown'

/**
 * Reconcile a distilled memory operation against the existing brain. The model
 * returns add/update/noop ops keyed by slug; we MERGE rather than blind-append:
 *
 *   - add    -> insert a new entry (or, if the slug already exists, fold into it)
 *   - update -> revise the existing entry's body/confidence, bump hits + dates,
 *               union evidence; if the slug is unknown, treat as add
 *   - noop   -> nothing (the model decided the existing memory already covers it)
 *
 * This keeps the brain small and high-signal and prevents a repeated learning
 * from spawning duplicate files. Pure + Electron-free for testability.
 */

export interface DistillOp {
  op: 'add' | 'update' | 'noop'
  kind: 'memory' | 'skill'
  slug: string
  title: string
  body: string
  confidence: number
  agentScope?: string
  scope?: 'project' | 'global'
  evidence?: string[]
  supersedes?: string[]
  sourceAgents?: string[]
}

export interface MergeResult {
  entries: MemoryEntry[]
  action: 'added' | 'updated' | 'noop'
  slug: string
}

const uniq = (a: string[]): string[] => [...new Set(a.filter(Boolean))]

/** Apply one op to a memory list, returning the new list + what happened. */
export function applyMemoryOp(
  existing: MemoryEntry[],
  op: DistillOp,
  ctx: { projectHash: string; now?: number }
): MergeResult {
  const day = today(ctx.now)
  if (op.op === 'noop') return { entries: existing, action: 'noop', slug: op.slug }

  const idx = existing.findIndex((e) => e.slug === op.slug)
  const scope = op.scope ?? 'project'

  if (op.op === 'update' && idx >= 0) {
    const prev = existing[idx]
    const merged: MemoryEntry = {
      ...prev,
      title: op.title || prev.title,
      body: op.body || prev.body,
      confidence: Math.max(prev.confidence, op.confidence),
      hits: prev.hits + 1,
      updated: day,
      lastSeen: day,
      evidence: uniq([...prev.evidence, ...(op.evidence ?? [])]),
      supersedes: uniq([...prev.supersedes, ...(op.supersedes ?? [])]),
      sourceAgents: uniq([...prev.sourceAgents, ...(op.sourceAgents ?? [])])
    }
    const next = existing.slice()
    next[idx] = merged
    return { entries: next, action: 'updated', slug: op.slug }
  }

  // add (or update whose slug doesn't exist yet). If the slug collides, fold in.
  if (idx >= 0) return applyMemoryOp(existing, { ...op, op: 'update' }, ctx)

  const entry: MemoryEntry = {
    title: op.title,
    slug: op.slug,
    kind: 'memory',
    scope,
    agentScope: op.agentScope ?? 'all',
    project: scope === 'global' ? '' : ctx.projectHash,
    sourceAgents: uniq(op.sourceAgents ?? []),
    confidence: op.confidence,
    hits: 1,
    created: day,
    updated: day,
    lastSeen: day,
    evidence: uniq(op.evidence ?? []),
    supersedes: uniq(op.supersedes ?? []),
    body: op.body
  }
  // Drop anything this entry explicitly supersedes.
  const pruned = entry.supersedes.length
    ? existing.filter((e) => !entry.supersedes.includes(e.slug))
    : existing
  return { entries: [...pruned, entry], action: 'added', slug: op.slug }
}

/** Validate + normalize a raw op (e.g. from a model). Returns null if unusable. */
export function normalizeOp(raw: unknown): DistillOp | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const op = o.op
  const kind = o.kind
  if (op !== 'add' && op !== 'update' && op !== 'noop') return null
  if (kind !== 'memory' && kind !== 'skill') return null
  const slug = typeof o.slug === 'string' ? o.slug.trim() : ''
  if (!slug) return null
  const title = typeof o.title === 'string' ? o.title : ''
  const body = typeof o.body === 'string' ? o.body : ''
  if (op !== 'noop' && (!title || !body)) return null
  let confidence = typeof o.confidence === 'number' ? o.confidence : 0.5
  confidence = Math.max(0, Math.min(1, confidence))
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  return {
    op,
    kind,
    slug,
    title,
    body,
    confidence,
    agentScope: typeof o.agentScope === 'string' ? o.agentScope : 'all',
    scope: o.scope === 'global' ? 'global' : 'project',
    evidence: strArr(o.evidence),
    supersedes: strArr(o.supersedes),
    sourceAgents: strArr(o.sourceAgents)
  }
}
