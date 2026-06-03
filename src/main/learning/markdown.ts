import { scrub } from './scrub'

/**
 * Serialize / parse the learning layer's memory + skill files. Format mirrors
 * the user's existing ~/.claude memory files: a YAML-ish frontmatter block
 * delimited by `---`, then a markdown body.
 *
 * We deliberately DON'T pull in a YAML dependency — the field set is small and
 * fully under our control (scalars, and inline string/number arrays), so a
 * minimal, dependency-free, fully-tested (de)serializer is safer and lighter.
 */

export interface MemoryEntry {
  title: string
  slug: string
  kind: 'memory'
  scope: 'project' | 'global'
  agentScope: string // 'all' | a specific agentId
  project: string // projectHash, or '' for global
  sourceAgents: string[]
  confidence: number
  hits: number
  created: string // YYYY-MM-DD
  updated: string
  lastSeen: string
  evidence: string[] // turnIds
  supersedes: string[]
  body: string
}

export interface SkillEntry {
  name: string
  slug: string
  kind: 'skill'
  scope: 'project' | 'global'
  description: string
  agents: string[]
  trigger: string
  project: string
  confidence: number
  hits: number
  created: string
  updated: string
  evidence: string[]
  body: string
}

type Scalar = string | number | boolean
type FieldVal = Scalar | string[] | number[]

function needsQuote(s: string): boolean {
  return /[:#\n]/.test(s) || s.trim() !== s || s === ''
}

function encodeScalar(v: Scalar): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return needsQuote(v) ? JSON.stringify(v) : v
}

function encodeVal(v: FieldVal): string {
  if (Array.isArray(v)) return `[${v.map((x) => encodeScalar(x)).join(', ')}]`
  return encodeScalar(v)
}

/** Build a frontmatter+body document from an ordered field map. */
export function toFrontmatter(fields: Array<[string, FieldVal]>, body: string): string {
  const lines = fields.map(([k, v]) => `${k}: ${encodeVal(v)}`)
  return `---\n${lines.join('\n')}\n---\n${body.replace(/\s+$/, '')}\n`
}

function decodeScalar(raw: string): Scalar {
  const s = raw.trim()
  if (s === 'true') return true
  if (s === 'false') return false
  if (s !== '' && !Number.isNaN(Number(s)) && /^-?\d/.test(s)) return Number(s)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try {
      return JSON.parse(s.replace(/^'|'$/g, '"'))
    } catch {
      return s.slice(1, -1)
    }
  }
  return s
}

function decodeVal(raw: string): FieldVal {
  const s = raw.trim()
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((x) => decodeScalar(x) as string)
  }
  return decodeScalar(s)
}

/** Parse a frontmatter doc into { fields, body }. Tolerates a missing block. */
export function fromFrontmatter(text: string): { fields: Record<string, FieldVal>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!m) return { fields: {}, body: text }
  const fields: Record<string, FieldVal> = {}
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    fields[line.slice(0, idx).trim()] = decodeVal(line.slice(idx + 1))
  }
  return { fields, body: m[2] ?? '' }
}

const asStr = (v: FieldVal | undefined, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v))
const asNum = (v: FieldVal | undefined, d = 0): number => (typeof v === 'number' ? v : Number(v) || d)
const asArr = (v: FieldVal | undefined): string[] =>
  Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)]

export function serializeMemory(e: MemoryEntry): string {
  return toFrontmatter(
    [
      ['title', e.title],
      ['slug', e.slug],
      ['kind', 'memory'],
      ['scope', e.scope],
      ['agentScope', e.agentScope],
      ['project', e.project],
      ['source_agents', e.sourceAgents],
      ['confidence', e.confidence],
      ['hits', e.hits],
      ['created', e.created],
      ['updated', e.updated],
      ['lastSeen', e.lastSeen],
      ['evidence', e.evidence],
      ['supersedes', e.supersedes]
    ],
    e.body
  )
}

export function parseMemory(text: string): MemoryEntry {
  const { fields: f, body } = fromFrontmatter(text)
  return {
    title: asStr(f.title),
    slug: asStr(f.slug),
    kind: 'memory',
    scope: asStr(f.scope, 'project') === 'global' ? 'global' : 'project',
    agentScope: asStr(f.agentScope, 'all'),
    project: asStr(f.project),
    sourceAgents: asArr(f.source_agents),
    confidence: asNum(f.confidence),
    hits: asNum(f.hits),
    created: asStr(f.created),
    updated: asStr(f.updated),
    lastSeen: asStr(f.lastSeen),
    evidence: asArr(f.evidence),
    supersedes: asArr(f.supersedes),
    body: body.trim()
  }
}

export function serializeSkill(e: SkillEntry): string {
  return toFrontmatter(
    [
      ['name', e.name],
      ['slug', e.slug],
      ['kind', 'skill'],
      ['scope', e.scope],
      ['description', e.description],
      ['agents', e.agents],
      ['trigger', e.trigger],
      ['project', e.project],
      ['confidence', e.confidence],
      ['hits', e.hits],
      ['created', e.created],
      ['updated', e.updated],
      ['evidence', e.evidence]
    ],
    e.body
  )
}

export function parseSkill(text: string): SkillEntry {
  const { fields: f, body } = fromFrontmatter(text)
  return {
    name: asStr(f.name),
    slug: asStr(f.slug),
    kind: 'skill',
    scope: asStr(f.scope, 'project') === 'global' ? 'global' : 'project',
    description: asStr(f.description),
    agents: asArr(f.agents),
    trigger: asStr(f.trigger),
    project: asStr(f.project),
    confidence: asNum(f.confidence),
    hits: asNum(f.hits),
    created: asStr(f.created),
    updated: asStr(f.updated),
    evidence: asArr(f.evidence),
    body: body.trim()
  }
}

/** YYYY-MM-DD for a timestamp (defaults to now). Injectable for tests. */
export function today(ts: number = Date.now()): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Lowercase, hyphenated, filesystem-safe slug derived from a title. */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'memory'
  )
}

/** Defense-in-depth: re-scrub a generated entry's user-facing text before write. */
export function scrubEntryText(title: string, body: string, extra: string[] = []): { title: string; body: string } {
  return { title: scrub(title, extra), body: scrub(body, extra) }
}
