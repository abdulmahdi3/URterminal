import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// @ts-ignore — self-contained ESM MCP server, no type declarations by design
import { callTool, TOOLS } from '../../../resources/bridge-mcp.mjs'

const names = (TOOLS as { name: string }[]).map((t) => t.name)

describe('bridge MCP server', () => {
  let hub = ''
  beforeEach(() => {
    hub = join(mkdtempSync(join(tmpdir(), 'bm-')), '.bridgememory')
    mkdirSync(hub)
  })
  afterEach(() => {
    try {
      rmSync(hub, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('exposes the memory toolset', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(12)
    for (const t of ['create_memory', 'search_memories', 'find_backlinks', 'suggest_connections', 'link_memories', 'graph_summary'])
      expect(names).toContain(t)
  })

  it('creates, reads, searches, backlinks, suggests, links and summarizes', () => {
    callTool('create_memory', { title: 'Auth Pattern', content: 'JWT stuff [[Csrf Flow]]', tags: ['auth'] }, hub)
    callTool('create_memory', { title: 'Csrf Flow', content: 'tokens', tags: ['auth'] }, hub)
    callTool('create_memory', { title: 'Session Bug', tags: ['auth'] }, hub)

    const list = JSON.parse(callTool('list_memories', {}, hub))
    expect(list.map((n: { slug: string }) => n.slug).sort()).toEqual(['auth-pattern', 'csrf-flow', 'session-bug'])

    expect(callTool('read_memory', { id: 'Auth Pattern' }, hub)).toContain('JWT stuff')

    const found = JSON.parse(callTool('search_memories', { query: 'jwt' }, hub))
    expect(found[0].slug).toBe('auth-pattern')

    const back = JSON.parse(callTool('find_backlinks', { id: 'csrf-flow' }, hub))
    expect(back.map((n: { slug: string }) => n.slug)).toContain('auth-pattern')

    const sugg = JSON.parse(callTool('suggest_connections', { id: 'auth-pattern' }, hub))
    expect(sugg.map((s: { slug: string }) => s.slug)).toContain('session-bug')

    callTool('link_memories', { from: 'session-bug', to: 'auth-pattern' }, hub)
    const back2 = JSON.parse(callTool('find_backlinks', { id: 'auth-pattern' }, hub))
    expect(back2.map((n: { slug: string }) => n.slug)).toContain('session-bug')

    expect(JSON.parse(callTool('list_tags', {}, hub)).auth).toBe(3)

    const g = JSON.parse(callTool('graph_summary', {}, hub))
    expect(g.notes).toBe(3)
    expect(g.links).toBeGreaterThan(0)
  })

  it('deletes a note', () => {
    callTool('create_memory', { title: 'Temp note' }, hub)
    callTool('delete_memory', { id: 'temp-note' }, hub)
    expect(JSON.parse(callTool('list_memories', {}, hub))).toEqual([])
  })
})
