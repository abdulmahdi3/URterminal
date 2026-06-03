import { describe, it, expect } from 'vitest'
import { scrub } from './scrub'

describe('scrub', () => {
  it('redacts an OpenAI-style key', () => {
    const r = scrub('token sk-' + 'A1b2C3d4'.repeat(3))
    expect(r).not.toContain('sk-A1b2')
    expect(r).toContain('«redacted:openai-key»')
  })

  it('redacts a GitHub token', () => {
    expect(scrub('ghp_' + 'a'.repeat(36))).toContain('«redacted:github-token»')
  })

  it('redacts an AWS access key id', () => {
    expect(scrub('AKIA' + 'ABCDEFGHIJKLMNOP')).toContain('«redacted:aws-access-key»')
  })

  it('redacts a PEM private key block', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----'
    expect(scrub(pem)).toBe('«redacted:private-key»')
  })

  it('redacts a sensitive KEY=VALUE value but keeps the key', () => {
    const r = scrub('MY_SECRET_TOKEN=hunter2supersecret')
    expect(r).toContain('MY_SECRET_TOKEN=')
    expect(r).not.toContain('hunter2')
  })

  it('leaves ordinary prose alone', () => {
    expect(scrub('just a normal sentence about code')).toBe('just a normal sentence about code')
  })

  it('applies user-supplied extra patterns', () => {
    expect(scrub('internal-12345', ['internal-\\d+'])).toContain('«redacted:custom»')
  })

  it('ignores a malformed extra pattern without throwing', () => {
    expect(() => scrub('x', ['('])).not.toThrow()
  })
})
