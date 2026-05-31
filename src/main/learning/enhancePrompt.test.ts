import { describe, it, expect } from 'vitest'
import { buildEnhancePrompt, ENHANCE_SYSTEM } from './enhancePrompt'

describe('buildEnhancePrompt', () => {
  it('includes the request and a memory block', () => {
    const p = buildEnhancePrompt(
      'fix the login bug',
      [{ title: 'Auth', body: 'sessions use   JWT\nstored in redis' }],
      []
    )
    expect(p).toContain('USER REQUEST:')
    expect(p).toContain('fix the login bug')
    expect(p).toContain('- Auth: sessions use JWT stored in redis') // whitespace collapsed
    expect(p.trimEnd().endsWith('Rewritten request:')).toBe(true)
  })

  it('notes when there is no memory and omits the skills block', () => {
    const p = buildEnhancePrompt('do X', [], [])
    expect(p).toContain('(no memory recorded yet)')
    expect(p).not.toContain('SKILLS:')
  })

  it('includes skills when present', () => {
    const p = buildEnhancePrompt('do X', [], [{ name: 'deploy', description: 'ship to prod' }])
    expect(p).toContain('SKILLS:')
    expect(p).toContain('- deploy: ship to prod')
  })

  it('truncates very long memory bodies', () => {
    const long = 'x'.repeat(500)
    const p = buildEnhancePrompt('q', [{ title: 'T', body: long }], [])
    // 280-char cap on the body slice
    expect(p).toContain('- T: ' + 'x'.repeat(280))
    expect(p).not.toContain('x'.repeat(281))
  })

  it('system prompt forbids preamble', () => {
    expect(ENHANCE_SYSTEM.toLowerCase()).toContain('output only')
  })
})
