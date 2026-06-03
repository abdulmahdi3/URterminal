import { describe, it, expect } from 'vitest'
import { projectHash } from './paths'

describe('projectHash', () => {
  it('is stable for the same path', () => {
    expect(projectHash('/home/u/proj')).toBe(projectHash('/home/u/proj'))
  })

  it('differs for different paths', () => {
    expect(projectHash('/home/u/a')).not.toBe(projectHash('/home/u/b'))
  })

  it('returns a 12-char hex id', () => {
    expect(projectHash('/some/dir')).toMatch(/^[0-9a-f]{12}$/)
  })

  it('falls back to cwd for an empty path', () => {
    expect(projectHash('')).toMatch(/^[0-9a-f]{12}$/)
  })
})
