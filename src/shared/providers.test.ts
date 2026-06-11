import { describe, it, expect } from 'vitest'
import {
  AGENT_REGISTRY,
  agentLaunch,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  DEFAULT_MODELS,
  DEFAULT_LMSTUDIO_URL,
  DEFAULT_OLLAMA_URL,
  isLocalProvider,
  defaultLocalBaseUrl,
  latestModel
} from './providers'

describe('agent registry', () => {
  it('declares stream-json support for Claude Code', () => {
    const claude = AGENT_REGISTRY.find((a) => a.id === 'claude')
    expect(claude?.supports?.streamJson).toBe(true)
  })
})

describe('agentLaunch', () => {
  it('spawns the bare id when no host binary is set', () => {
    expect(agentLaunch({ id: 'codex', label: 'Codex' }, 'codex')).toEqual({
      command: 'codex',
      args: []
    })
  })

  it('maps a host-extension agent to bin + launch args', () => {
    expect(
      agentLaunch({ id: 'gh-copilot', label: 'Copilot', bin: 'gh', launchArgs: ['copilot'] }, 'gh-copilot')
    ).toEqual({ command: 'gh', args: ['copilot'] })
  })

  it('falls back to the id when the descriptor is missing', () => {
    expect(agentLaunch(undefined, 'mystery')).toEqual({ command: 'mystery', args: [] })
  })
})

describe('providers', () => {
  it('registers LM Studio alongside the other providers', () => {
    expect(PROVIDER_IDS).toContain('lmstudio')
    expect(PROVIDER_LABELS.lmstudio).toBe('LM Studio (local)')
  })

  it('flags only Ollama and LM Studio as local', () => {
    expect(isLocalProvider('ollama')).toBe(true)
    expect(isLocalProvider('lmstudio')).toBe(true)
    expect(isLocalProvider('anthropic')).toBe(false)
    expect(isLocalProvider('openai')).toBe(false)
    expect(isLocalProvider('gemini')).toBe(false)
  })

  it('maps local providers to their default base URLs', () => {
    expect(defaultLocalBaseUrl('ollama')).toBe(DEFAULT_OLLAMA_URL)
    expect(defaultLocalBaseUrl('lmstudio')).toBe(DEFAULT_LMSTUDIO_URL)
    expect(DEFAULT_LMSTUDIO_URL).toMatch(/^http:\/\/127\.0\.0\.1:1234$/)
    expect(defaultLocalBaseUrl('openai')).toBe('')
  })

  it('treats LM Studio as having no static model fallback', () => {
    expect(DEFAULT_MODELS.lmstudio).toEqual([])
    expect(latestModel('lmstudio')).toBe('')
    // Ollama keeps a fallback list for when its server is unreachable.
    expect(DEFAULT_MODELS.ollama.length).toBeGreaterThan(0)
  })
})
