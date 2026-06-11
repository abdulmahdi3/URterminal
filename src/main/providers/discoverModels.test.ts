import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseOllamaTags,
  parseOpenAIModels,
  discoverModels,
  discoverOllamaModels,
  discoverLmStudioModels
} from './discoverModels'

/** Stub global fetch with a single canned response (or a thrown error). */
function mockFetch(impl: (url: string) => { ok: boolean; json?: () => unknown } | Promise<never>): void {
  globalThis.fetch = vi.fn((url: string) => {
    const r = impl(url)
    return Promise.resolve(r as unknown as Response)
  }) as unknown as typeof fetch
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseOllamaTags', () => {
  it('pulls model names from /api/tags', () => {
    expect(parseOllamaTags({ models: [{ name: 'llama3.1' }, { name: 'qwen2.5' }] })).toEqual([
      'llama3.1',
      'qwen2.5'
    ])
  })

  it('returns [] for malformed or empty payloads', () => {
    expect(parseOllamaTags({})).toEqual([])
    expect(parseOllamaTags(null)).toEqual([])
    expect(parseOllamaTags({ models: 'nope' })).toEqual([])
    expect(parseOllamaTags({ models: [{ size: 1 }, { name: 42 }] })).toEqual([])
  })
})

describe('parseOpenAIModels', () => {
  it('pulls model ids from /v1/models', () => {
    expect(parseOpenAIModels({ data: [{ id: 'qwen2.5-7b' }, { id: 'phi-3' }] })).toEqual([
      'qwen2.5-7b',
      'phi-3'
    ])
  })

  it('returns [] for malformed or empty payloads', () => {
    expect(parseOpenAIModels({})).toEqual([])
    expect(parseOpenAIModels(null)).toEqual([])
    expect(parseOpenAIModels({ data: {} })).toEqual([])
  })
})

describe('discoverOllamaModels', () => {
  it('hits {base}/api/tags and parses the result', async () => {
    mockFetch((url) => {
      expect(url).toBe('http://127.0.0.1:11434/api/tags')
      return { ok: true, json: () => ({ models: [{ name: 'llama3.1' }] }) }
    })
    await expect(discoverOllamaModels('http://127.0.0.1:11434')).resolves.toEqual(['llama3.1'])
  })

  it('trims a trailing slash on the base URL', async () => {
    mockFetch((url) => {
      expect(url).toBe('http://127.0.0.1:11434/api/tags')
      return { ok: true, json: () => ({ models: [] }) }
    })
    await expect(discoverOllamaModels('http://127.0.0.1:11434/')).resolves.toEqual([])
  })
})

describe('discoverLmStudioModels', () => {
  it('hits {base}/v1/models and parses the result', async () => {
    mockFetch((url) => {
      expect(url).toBe('http://127.0.0.1:1234/v1/models')
      return { ok: true, json: () => ({ data: [{ id: 'phi-3' }] }) }
    })
    await expect(discoverLmStudioModels('http://127.0.0.1:1234')).resolves.toEqual(['phi-3'])
  })
})

describe('discoverModels', () => {
  it('returns [] for hosted providers without any network call', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
    await expect(discoverModels('openai', 'http://x')).resolves.toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('falls back to the provider default base URL when none is given', async () => {
    mockFetch((url) => {
      expect(url).toBe('http://127.0.0.1:11434/api/tags')
      return { ok: true, json: () => ({ models: [{ name: 'mistral' }] }) }
    })
    await expect(discoverModels('ollama')).resolves.toEqual(['mistral'])
  })

  it('returns [] (not an error) when the server is unreachable', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch
    await expect(discoverModels('lmstudio')).resolves.toEqual([])
  })

  it('returns [] on a non-200 response', async () => {
    mockFetch(() => ({ ok: false, json: () => ({}) }))
    await expect(discoverModels('ollama')).resolves.toEqual([])
  })
})
