#!/usr/bin/env node
/**
 * BridgeMemory MCP server — exposes the local `.bridgememory/` hub to any agent
 * that speaks the Model Context Protocol (Claude Code, Codex, …) so builders,
 * reviewers and scouts read + write the SAME knowledge graph.
 *
 * Self-contained: a standalone ESM script the agent spawns as a child (no build
 * step, no deps). It mirrors the pure logic in `src/shared/bridge.ts`; keep them
 * in sync. The stdio JSON-RPC loop runs only when invoked directly — the tool
 * handlers are exported so they can be unit-tested.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (the MCP stdio transport).
 * The hub is discovered from the server's own cwd (= the folder the agent opened).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HUB = '.bridgememory'

// ── pure core (mirrors src/shared/bridge.ts) ──
export function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'note'
}
function linkSlug(raw) {
  return slugify(raw.split('|')[0].split('#')[0].trim())
}
export function extractWikilinks(text) {
  const out = []
  const seen = new Set()
  const re = /\[\[([^\]]+)\]\]/g
  let m
  while ((m = re.exec(text)) !== null) {
    const s = linkSlug(m[1])
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}
function readFrontmatter(content) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content)
  if (!m) return { tags: [], body: content }
  let title, tags = []
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const k = line.slice(0, i).trim().toLowerCase()
    const v = line.slice(i + 1).trim()
    if (k === 'title') title = v.replace(/^["']|["']$/g, '')
    else if (k === 'tags') tags = v.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().replace(/^["']|["']$|^#/g, '')).filter(Boolean)
  }
  return { title, tags, body: m[2] ?? '' }
}
function inlineTags(body) {
  const out = []
  const re = /(^|\s)#([a-z0-9][\w-]*)/gi
  let m
  while ((m = re.exec(body)) !== null) out.push(m[2].toLowerCase())
  return out
}
export function parseNote(slug, content, updated = 0) {
  const fm = readFrontmatter(content)
  const heading = (/^#\s+(.+)$/m.exec(fm.body)?.[1] || '').trim()
  const title = fm.title || heading || slug.replace(/-/g, ' ')
  const tags = Array.from(new Set([...fm.tags, ...inlineTags(fm.body)]))
  return { slug, title, tags, links: extractWikilinks(fm.body), content, updated }
}
const STOP = new Set('the a an and or of to in is it for on with be this that as are at by from we you your our'.split(' '))
const terms = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w))

// ── hub IO ──
export function discoverHub(cwd) {
  let dir = cwd
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, HUB))) return join(dir, HUB)
    if (existsSync(join(dir, '.git'))) return join(dir, HUB)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(cwd, HUB)
}
function ensure(hub) {
  if (!existsSync(hub)) mkdirSync(hub, { recursive: true })
  return hub
}
function listNotes(hub) {
  if (!existsSync(hub)) return []
  const notes = []
  for (const name of readdirSync(hub)) {
    if (!name.toLowerCase().endsWith('.md')) continue
    try {
      const full = join(hub, name)
      notes.push(parseNote(name.replace(/\.md$/i, ''), readFileSync(full, 'utf8'), statSync(full).mtimeMs))
    } catch {
      /* skip */
    }
  }
  return notes.sort((a, b) => b.updated - a.updated)
}
function resolveSlug(hub, ref) {
  const slug = slugify(ref)
  if (existsSync(join(hub, slug + '.md'))) return slug
  const byTitle = listNotes(hub).find((n) => slugify(n.title) === slug)
  return byTitle ? byTitle.slug : slug
}
function uniqueSlug(hub, base) {
  let slug = base
  let n = 2
  while (existsSync(join(hub, slug + '.md'))) slug = `${base}-${n++}`
  return slug
}

// ── tools ──
export const TOOLS = [
  { name: 'list_memories', description: 'List every memory note (slug, title, tags).', inputSchema: { type: 'object', properties: {} } },
  { name: 'read_memory', description: 'Read a memory note by slug or title.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_memory', description: 'Create a memory note. Use [[wikilinks]] in content to connect notes.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title'] } },
  { name: 'update_memory', description: 'Replace a memory note’s full content.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id', 'content'] } },
  { name: 'append_memory', description: 'Append text to an existing memory note.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
  { name: 'delete_memory', description: 'Delete a memory note.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'search_memories', description: 'Full-text search across memory notes.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'find_backlinks', description: 'Notes that link to a given note.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'suggest_connections', description: 'Notes worth linking to a given note (shared tags/terms, not yet linked).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'link_memories', description: 'Add a [[wikilink]] from one note to another.', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'list_tags', description: 'All tags with note counts.', inputSchema: { type: 'object', properties: {} } },
  { name: 'graph_summary', description: 'Summary of the graph: note + link counts and the most-connected notes.', inputSchema: { type: 'object', properties: {} } }
]

/** Execute a tool against `hub`. Returns a string result; throws on bad input. */
export function callTool(name, args, hub) {
  const a = args || {}
  switch (name) {
    case 'list_memories':
      return JSON.stringify(listNotes(hub).map((n) => ({ slug: n.slug, title: n.title, tags: n.tags })), null, 2)
    case 'read_memory': {
      const slug = resolveSlug(hub, a.id)
      const p = join(hub, slug + '.md')
      if (!existsSync(p)) throw new Error(`No memory: ${a.id}`)
      return readFileSync(p, 'utf8')
    }
    case 'create_memory': {
      ensure(hub)
      const slug = uniqueSlug(hub, slugify(a.title))
      const fm = a.tags && a.tags.length ? `---\ntitle: ${a.title}\ntags: [${a.tags.join(', ')}]\n---\n` : ''
      const body = fm ? `${fm}${a.content || ''}\n` : `# ${a.title}\n\n${a.content || ''}\n`
      writeFileSync(join(hub, slug + '.md'), body, 'utf8')
      return `Created [[${slug}]]`
    }
    case 'update_memory': {
      ensure(hub)
      const slug = resolveSlug(hub, a.id)
      writeFileSync(join(hub, slug + '.md'), a.content, 'utf8')
      return `Updated [[${slug}]]`
    }
    case 'append_memory': {
      const slug = resolveSlug(hub, a.id)
      const p = join(hub, slug + '.md')
      const prev = existsSync(p) ? readFileSync(p, 'utf8') : ''
      writeFileSync(p, prev + (prev.endsWith('\n') || !prev ? '' : '\n') + a.text + '\n', 'utf8')
      return `Appended to [[${slug}]]`
    }
    case 'delete_memory': {
      const slug = resolveSlug(hub, a.id)
      const p = join(hub, slug + '.md')
      if (existsSync(p)) unlinkSync(p)
      return `Deleted ${slug}`
    }
    case 'search_memories': {
      const q = String(a.query || '').toLowerCase()
      const words = q.split(/\s+/).filter(Boolean)
      const notes = listNotes(hub)
        .map((n) => {
          const hay = (n.title + ' ' + n.tags.join(' ') + ' ' + n.content).toLowerCase()
          let s = 0
          for (const w of words) {
            if (n.title.toLowerCase().includes(w)) s += 5
            if (n.tags.some((t) => t.includes(w))) s += 3
            if (hay.includes(w)) s += 1
          }
          return { n, s }
        })
        .filter((x) => x.s > 0)
        .sort((x, y) => y.s - x.s)
        .map((x) => ({ slug: x.n.slug, title: x.n.title, tags: x.n.tags }))
      return JSON.stringify(notes, null, 2)
    }
    case 'find_backlinks': {
      const slug = resolveSlug(hub, a.id)
      const notes = listNotes(hub)
      const titleSlug = slugify(notes.find((n) => n.slug === slug)?.title || slug)
      const back = notes.filter((n) => n.slug !== slug && n.links.some((l) => l === slug || l === titleSlug))
      return JSON.stringify(back.map((n) => ({ slug: n.slug, title: n.title })), null, 2)
    }
    case 'suggest_connections': {
      const notes = listNotes(hub)
      const me = notes.find((n) => n.slug === resolveSlug(hub, a.id))
      if (!me) throw new Error(`No memory: ${a.id}`)
      const linked = new Set(me.links)
      for (const n of notes) if (n.links.includes(me.slug)) linked.add(n.slug)
      const myTags = new Set(me.tags)
      const myTerms = new Set(terms(me.title))
      const out = []
      for (const n of notes) {
        if (n.slug === me.slug || linked.has(n.slug)) continue
        const shared = n.tags.filter((t) => myTags.has(t)).map((t) => '#' + t)
        let hits = 0
        for (const w of terms(n.title)) if (myTerms.has(w)) hits++
        const score = shared.length * 3 + hits
        if (score > 0) out.push({ slug: n.slug, title: n.title, shared: shared.length ? shared : ['related'], score })
      }
      return JSON.stringify(out.sort((x, y) => y.score - x.score).slice(0, 8), null, 2)
    }
    case 'link_memories': {
      const from = resolveSlug(hub, a.from)
      const to = resolveSlug(hub, a.to)
      const p = join(hub, from + '.md')
      const prev = existsSync(p) ? readFileSync(p, 'utf8') : `# ${a.from}\n`
      if (extractWikilinks(prev).includes(to)) return `[[${from}]] already links [[${to}]]`
      writeFileSync(p, prev + (prev.endsWith('\n') ? '' : '\n') + `See also [[${to}]].\n`, 'utf8')
      return `Linked [[${from}]] → [[${to}]]`
    }
    case 'list_tags': {
      const counts = {}
      for (const n of listNotes(hub)) for (const t of n.tags) counts[t] = (counts[t] || 0) + 1
      return JSON.stringify(counts, null, 2)
    }
    case 'graph_summary': {
      const notes = listNotes(hub)
      const deg = {}
      let edges = 0
      const bySlug = new Set(notes.map((n) => n.slug))
      const byTitle = new Map(notes.map((n) => [slugify(n.title), n.slug]))
      for (const n of notes)
        for (const l of n.links) {
          const target = bySlug.has(l) ? l : byTitle.get(l) || l
          edges++
          deg[n.slug] = (deg[n.slug] || 0) + 1
          deg[target] = (deg[target] || 0) + 1
        }
      const top = Object.entries(deg).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([slug, d]) => ({ slug, links: d }))
      return JSON.stringify({ notes: notes.length, links: edges, mostConnected: top }, null, 2)
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── MCP stdio JSON-RPC loop ──
function runServer() {
  const hub = discoverHub(process.cwd())
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
  const fail = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32000, message } })

  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      handle(msg)
    }
  })

  function handle(msg) {
    const { id, method, params } = msg
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'bridgememory', version: '1.0.0' }
      })
    } else if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      /* no response to notifications */
    } else if (method === 'ping') {
      reply(id, {})
    } else if (method === 'tools/list') {
      reply(id, { tools: TOOLS })
    } else if (method === 'tools/call') {
      try {
        const text = callTool(params?.name, params?.arguments, hub)
        reply(id, { content: [{ type: 'text', text }] })
      } catch (e) {
        reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true })
      }
    } else if (id !== undefined) {
      fail(id, `Unknown method: ${method}`)
    }
  }
}

// Run the server only when executed directly (not when imported by tests).
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) runServer()
