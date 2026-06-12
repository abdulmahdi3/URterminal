/**
 * BridgeMemory — a local-first, wikilinked knowledge graph that lives in a
 * `.bridgememory/` folder next to the repo. Plain markdown notes connected by
 * `[[wikilinks]]`; every agent in the room reads + writes the same hub.
 *
 * This module is the PURE core (parse / graph / search / suggest), shared by the
 * main process (IO + IPC + the MCP server) and the renderer (the graph view), so
 * it carries no fs/DOM imports and is fully unit-tested.
 */

export interface BridgeNote {
  /** filename without `.md` — the stable id */
  slug: string
  title: string
  tags: string[]
  /** normalized outbound wikilink target slugs (deduped) */
  links: string[]
  /** first line(s) of the body, for previews */
  excerpt: string
  /** full file content (markdown, incl. any frontmatter) — for the editor */
  content: string
  /** mtime ms (set by the IO layer; 0 in pure contexts) */
  updated: number
}

export interface BridgeNode {
  slug: string
  title: string
  tags: string[]
  /** a link target that has no note file yet */
  ghost?: boolean
  /** outbound + inbound link count (graph weight) */
  degree: number
}

export interface BridgeEdge {
  source: string
  target: string
}

export interface BridgeGraphData {
  nodes: BridgeNode[]
  edges: BridgeEdge[]
}

/** Lowercase, hyphenated, filesystem-safe slug. */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'note'
  )
}

/** Normalize a raw wikilink target ("Auth Pattern#sec|alias") → a note slug. */
export function linkSlug(raw: string): string {
  const target = raw.split('|')[0].split('#')[0].trim()
  return slugify(target)
}

/** Every `[[target]]` in `text`, normalized to slugs and deduped (in order). */
export function extractWikilinks(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\[\[([^\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const slug = linkSlug(m[1])
    if (slug && !seen.has(slug)) {
      seen.add(slug)
      out.push(slug)
    }
  }
  return out
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

/** Pull `title:` / `tags:` from a frontmatter block (best-effort, dependency-free). */
function readFrontmatter(content: string): { title?: string; tags: string[]; body: string } {
  const m = FM_RE.exec(content)
  if (!m) return { tags: [], body: content }
  let title: string | undefined
  let tags: string[] = []
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const val = line.slice(idx + 1).trim()
    if (key === 'title') title = val.replace(/^["']|["']$/g, '')
    else if (key === 'tags') {
      tags = val
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, ''))
        .filter(Boolean)
    }
  }
  return { title, tags, body: m[2] ?? '' }
}

/** Inline `#tag` mentions in the body (excludes markdown headings `# `). */
function inlineTags(body: string): string[] {
  const out: string[] = []
  const re = /(^|\s)#([a-z0-9][\w-]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) out.push(m[2].toLowerCase())
  return out
}

/** First non-empty, non-heading line of the body, trimmed to ~160 chars. */
function makeExcerpt(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('---')) continue
    return line.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').slice(0, 160)
  }
  return ''
}

/** Parse one note file into a structured BridgeNote. */
export function parseNote(slug: string, content: string, updated = 0): BridgeNote {
  const fm = readFrontmatter(content)
  const headingTitle = (/^#\s+(.+)$/m.exec(fm.body)?.[1] || '').trim()
  const title = fm.title || headingTitle || slug.replace(/-/g, ' ')
  const tags = Array.from(new Set([...fm.tags, ...inlineTags(fm.body)]))
  return {
    slug,
    title,
    tags,
    links: extractWikilinks(fm.body),
    excerpt: makeExcerpt(fm.body),
    content,
    updated
  }
}

/** Build the note graph. Outbound links resolve to a note by slug, or to a slug
 *  derived from a title; unresolved targets become `ghost` nodes. */
export function buildGraph(notes: BridgeNote[]): BridgeGraphData {
  const bySlug = new Map(notes.map((n) => [n.slug, n]))
  const byTitleSlug = new Map(notes.map((n) => [slugify(n.title), n]))
  const resolve = (target: string): string | null =>
    bySlug.has(target) ? target : byTitleSlug.get(target)?.slug ?? null

  const degree = new Map<string, number>()
  const bump = (s: string): void => {
    degree.set(s, (degree.get(s) ?? 0) + 1)
  }
  const edges: BridgeEdge[] = []
  const ghosts = new Set<string>()
  const edgeSeen = new Set<string>()

  for (const n of notes) {
    for (const raw of n.links) {
      const resolved = resolve(raw)
      const target = resolved ?? raw
      if (!resolved) ghosts.add(raw)
      const key = `${n.slug}->${target}`
      if (edgeSeen.has(key) || target === n.slug) continue
      edgeSeen.add(key)
      edges.push({ source: n.slug, target })
      bump(n.slug)
      bump(target)
    }
  }

  const nodes: BridgeNode[] = notes.map((n) => ({
    slug: n.slug,
    title: n.title,
    tags: n.tags,
    degree: degree.get(n.slug) ?? 0
  }))
  for (const g of ghosts) {
    if (!bySlug.has(g)) {
      nodes.push({ slug: g, title: g.replace(/-/g, ' '), tags: [], ghost: true, degree: degree.get(g) ?? 0 })
    }
  }
  return { nodes, edges }
}

/** Notes that link TO `slug` (resolved by slug or by title-slug). */
export function backlinksFor(notes: BridgeNote[], slug: string): BridgeNote[] {
  const target = notes.find((n) => n.slug === slug)
  const titleSlug = target ? slugify(target.title) : slug
  return notes.filter((n) => n.slug !== slug && n.links.some((l) => l === slug || l === titleSlug))
}

const STOP = new Set(
  'the a an and or of to in is it for on with be this that as are at by from we you your our'.split(' ')
)
const terms = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))

/** Full-text-ish search ranked by title + body matches. */
export function searchNotes(notes: BridgeNote[], query: string): BridgeNote[] {
  const q = query.trim().toLowerCase()
  if (!q) return notes.slice().sort((a, b) => b.updated - a.updated)
  const words = q.split(/\s+/).filter(Boolean)
  const score = (n: BridgeNote): number => {
    const hay = (n.title + ' ' + n.tags.join(' ') + ' ' + n.content).toLowerCase()
    let s = 0
    for (const w of words) {
      if (n.title.toLowerCase().includes(w)) s += 5
      if (n.tags.some((t) => t.includes(w))) s += 3
      if (hay.includes(w)) s += 1
    }
    return s
  }
  return notes
    .map((n) => ({ n, s: score(n) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.n.updated - a.n.updated)
    .map((x) => x.n)
}

/** Suggest notes worth linking to `slug`: shared tags or terms, not yet linked. */
export function suggestConnections(notes: BridgeNote[], slug: string, max = 6): { note: BridgeNote; shared: string[] }[] {
  const me = notes.find((n) => n.slug === slug)
  if (!me) return []
  const myTitleSlug = slugify(me.title)
  const linked = new Set<string>(me.links)
  // also exclude notes that link back to me
  for (const n of notes) if (n.links.includes(slug) || n.links.includes(myTitleSlug)) linked.add(n.slug)

  const myTags = new Set(me.tags)
  const myTerms = new Set(terms(me.title + ' ' + me.excerpt))
  const out: { note: BridgeNote; shared: string[]; score: number }[] = []
  for (const n of notes) {
    if (n.slug === slug || linked.has(n.slug)) continue
    const shared: string[] = []
    for (const t of n.tags) if (myTags.has(t)) shared.push('#' + t)
    let termHits = 0
    for (const w of terms(n.title)) if (myTerms.has(w)) termHits++
    const score = shared.length * 3 + termHits
    if (score > 0) out.push({ note: n, shared: shared.length ? shared : ['related'], score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max).map(({ note, shared }) => ({ note, shared }))
}
