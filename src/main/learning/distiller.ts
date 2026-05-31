import { normalizeOp, type DistillOp } from './merge'
import { scrubEntryText } from './markdown'
import type { Candidate } from './heuristics'
import type { TurnRecord } from './store'
import type { BrainIndex } from './brain'

/**
 * Turns gated candidates + their transcripts into a model PROMPT, and parses the
 * model's JSON-diff RESPONSE back into validated, re-scrubbed ops. Both halves
 * are pure and Electron-free; the actual model invocation is injected, so this
 * module is fully unit-testable without spending a token.
 *
 * The model is asked for a DIFF (add/update/noop ops against the existing brain
 * index), never free prose — so merging is deterministic and the brain stays
 * small. It is explicitly told the input is already secret-scrubbed and must not
 * reproduce secrets, file paths, or one-off values: only durable, generalizable
 * learnings.
 */

export interface DistillInput {
  candidates: Candidate[]
  turns: TurnRecord[] // the turns referenced by the candidates' turnIds
  index: BrainIndex
  projectHash: string
}

export const DISTILL_SYSTEM = [
  'You distill durable engineering knowledge from a developer\'s terminal sessions',
  'with AI coding agents. Input is ALREADY secret-scrubbed; never reproduce secrets,',
  'tokens, absolute paths, or one-off values. Extract only DURABLE, GENERALIZABLE',
  'facts (project conventions, recurring fixes) and reusable SKILLS (repeatable',
  'procedures). Return ONLY JSON: {"ops":[{op,kind,slug,title,body,confidence,',
  'agentScope,scope,evidence,supersedes}]}. op is add|update|noop; kind is',
  'memory|skill; confidence 0..1; reference existing slugs to update/supersede',
  'instead of duplicating. Prefer noop over a low-value memory.'
].join(' ')

function turnsById(turns: TurnRecord[]): Map<string, TurnRecord> {
  const m = new Map<string, TurnRecord>()
  for (const t of turns) m.set(t.turnId, t)
  return m
}

/** Build the user prompt for one distillation batch. */
export function buildDistillPrompt(input: DistillInput): string {
  const byId = turnsById(input.turns)
  const parts: string[] = []

  parts.push('## Existing memory (slugs you may update/supersede)')
  if (input.index.memories.length) {
    for (const m of input.index.memories) {
      parts.push(`- ${m.slug}: ${m.title} (confidence ${m.confidence.toFixed(2)})`)
    }
  } else parts.push('(none yet)')

  parts.push('\n## Existing skills')
  parts.push(input.index.skills.length ? input.index.skills.map((s) => `- ${s.slug}: ${s.name}`).join('\n') : '(none yet)')

  parts.push('\n## Candidate exchanges to distill')
  let n = 0
  for (const c of input.candidates) {
    n++
    parts.push(`\n### Candidate ${n} — ${c.kind}: ${c.summary}`)
    for (const id of c.turnIds) {
      const t = byId.get(id)
      if (!t) continue
      if (t.user?.text) parts.push(`USER: ${t.user.text}`)
      if (t.agent.text) parts.push(`AGENT (${t.agentId}): ${t.agent.text.slice(0, 2000)}`)
    }
  }

  parts.push('\nReturn the JSON diff now.')
  return parts.join('\n')
}

/** Extract the first JSON object from a model reply (tolerates ``` fences/prose). */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  const candidate = fence ? fence[1] : trimmed
  // find the outermost {...}
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/** Parse + validate + re-scrub a model reply into usable ops. */
export function parseDistillResponse(raw: string, scrubExtra: string[] = []): DistillOp[] {
  const obj = extractJson(raw) as { ops?: unknown[] } | null
  if (!obj || !Array.isArray(obj.ops)) return []
  const out: DistillOp[] = []
  for (const r of obj.ops) {
    const op = normalizeOp(r)
    if (!op) continue
    // Defense in depth: re-scrub generated text before it can be stored.
    const { title, body } = scrubEntryText(op.title, op.body, scrubExtra)
    out.push({ ...op, title, body })
  }
  return out
}

/** A model runner: prompt in, raw text out. Injected so it can be mocked. */
export type RunModel = (system: string, prompt: string) => Promise<string>

/** Run one distillation batch through an injected model and return the ops. */
export async function distill(
  input: DistillInput,
  runModel: RunModel,
  scrubExtra: string[] = []
): Promise<DistillOp[]> {
  if (!input.candidates.length) return []
  const prompt = buildDistillPrompt(input)
  const raw = await runModel(DISTILL_SYSTEM, prompt)
  return parseDistillResponse(raw, scrubExtra)
}
