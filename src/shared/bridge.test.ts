import { describe, it, expect } from 'vitest'
import {
  extractWikilinks,
  linkSlug,
  parseNote,
  buildGraph,
  backlinksFor,
  searchNotes,
  suggestConnections,
  forceLayout,
  slugify,
  type BridgeNote
} from './bridge'

describe('linkSlug / extractWikilinks', () => {
  it('normalizes a target stripping alias + section', () => {
    expect(linkSlug('Auth Pattern#setup|the auth')).toBe('auth-pattern')
  })
  it('extracts and dedupes wikilinks in order', () => {
    expect(extractWikilinks('see [[Auth Pattern]] and [[csrf-flow]] and [[Auth Pattern|again]]')).toEqual([
      'auth-pattern',
      'csrf-flow'
    ])
  })
})

describe('parseNote', () => {
  it('reads frontmatter title + tags and inline #tags + links', () => {
    const content = ['---', 'title: Auth Pattern', 'tags: [auth, security]', '---', '# Heading', '', 'Uses [[csrf-flow]]. Also #jwt here.'].join(
      '\n'
    )
    const n = parseNote('auth-pattern', content, 5)
    expect(n.title).toBe('Auth Pattern')
    expect(n.tags.sort()).toEqual(['auth', 'jwt', 'security'])
    expect(n.links).toEqual(['csrf-flow'])
    expect(n.excerpt).toContain('Uses csrf-flow')
    expect(n.updated).toBe(5)
  })
  it('falls back to the first heading, then the slug, for the title', () => {
    expect(parseNote('ship-decision', '# Ship it\n\nbody').title).toBe('Ship it')
    expect(parseNote('ship-decision', 'no heading here').title).toBe('ship decision')
  })
  it('does not treat a markdown heading as a tag', () => {
    expect(parseNote('x', '# Title\n\ntext').tags).toEqual([])
  })
})

const mk = (slug: string, content: string, updated = 0): BridgeNote => parseNote(slug, content, updated)

describe('buildGraph', () => {
  it('links notes by slug and by title-slug, and ghosts unknown targets', () => {
    const notes = [
      mk('a', '# A\n[[b]] and [[Csrf Flow]]'),
      mk('csrf-flow', '# Csrf Flow\nhi'),
      mk('b', '# B\nhi')
    ]
    const g = buildGraph(notes)
    expect(g.nodes.find((n) => n.slug === 'b')).toBeTruthy()
    // 'Csrf Flow' resolves to the csrf-flow note (by title slug)
    expect(g.edges).toContainEqual({ source: 'a', target: 'csrf-flow' })
    // an unknown link becomes a ghost node
    const notes2 = [mk('a', '[[missing-note]]')]
    const g2 = buildGraph(notes2)
    expect(g2.nodes.find((n) => n.slug === 'missing-note')?.ghost).toBe(true)
  })
})

describe('backlinksFor', () => {
  it('finds notes linking to a slug', () => {
    const notes = [mk('a', '[[b]]'), mk('b', 'x'), mk('c', '[[b]] [[a]]')]
    expect(backlinksFor(notes, 'b').map((n) => n.slug).sort()).toEqual(['a', 'c'])
  })
})

describe('searchNotes', () => {
  it('ranks title hits above body hits', () => {
    const notes = [mk('a', '# Stripe webhook\nx'), mk('b', '# Other\nmentions stripe once')]
    const r = searchNotes(notes, 'stripe')
    expect(r[0].slug).toBe('a')
    expect(r.map((n) => n.slug)).toContain('b')
  })
  it('returns all (recent first) for an empty query', () => {
    const notes = [mk('a', 'x', 1), mk('b', 'y', 2)]
    expect(searchNotes(notes, '').map((n) => n.slug)).toEqual(['b', 'a'])
  })
})

describe('suggestConnections', () => {
  it('suggests notes sharing tags but not already linked', () => {
    const notes = [
      mk('a', '---\ntags: [auth]\n---\n# A'),
      mk('b', '---\ntags: [auth]\n---\n# B'), // shares #auth, not linked → suggested
      mk('c', '---\ntags: [auth]\n---\n# C\n[[a]]'), // links to a → excluded
      mk('d', '---\ntags: [ui]\n---\n# D') // no overlap → excluded
    ]
    const s = suggestConnections(notes, 'a')
    const slugs = s.map((x) => x.note.slug)
    expect(slugs).toContain('b')
    expect(slugs).not.toContain('c')
    expect(slugs).not.toContain('d')
    expect(s.find((x) => x.note.slug === 'b')?.shared).toContain('#auth')
  })
})

describe('slugify', () => {
  it('makes a filesystem-safe slug', () => {
    expect(slugify('Auth Pattern! (v2)')).toBe('auth-pattern-v2')
  })
})

describe('forceLayout', () => {
  const W = 800
  const H = 440
  it('centers a single node and is empty for none', () => {
    expect(forceLayout({ nodes: [], edges: [] }, { width: W, height: H }).size).toBe(0)
    const one = forceLayout({ nodes: [{ slug: 'a', title: 'A', tags: [], degree: 0 }], edges: [] }, { width: W, height: H })
    expect(one.get('a')).toEqual({ x: W / 2, y: H / 2 })
  })

  it('is deterministic and keeps every node inside the box', () => {
    const g = buildGraph([mk('a', '[[b]] [[c]]'), mk('b', '[[c]]'), mk('c', 'x'), mk('d', 'lonely')])
    const p1 = forceLayout(g, { width: W, height: H })
    const p2 = forceLayout(g, { width: W, height: H })
    for (const [slug, pt] of p1) {
      expect(p2.get(slug)).toEqual(pt) // same input → same output
      expect(pt.x).toBeGreaterThanOrEqual(0)
      expect(pt.x).toBeLessThanOrEqual(W)
      expect(pt.y).toBeGreaterThanOrEqual(0)
      expect(pt.y).toBeLessThanOrEqual(H)
    }
  })

  it('pulls linked nodes closer than unlinked ones', () => {
    const g = buildGraph([mk('a', '[[b]]'), mk('b', 'x'), mk('far', 'unconnected')])
    const p = forceLayout(g, { width: W, height: H })
    const dist = (s1: string, s2: string): number => {
      const a = p.get(s1)!
      const b = p.get(s2)!
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    expect(dist('a', 'b')).toBeLessThan(dist('a', 'far'))
  })
})
