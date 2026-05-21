import type { ProviderId } from './types'

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  ollama: 'Ollama (local)'
}

export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'ollama']

/** Fallback model lists used before a live list is fetched (and when offline). */
export const DEFAULT_MODELS: Record<ProviderId, string[]> = {
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  ollama: ['llama3.1', 'qwen2.5', 'mistral']
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

// ---------------------------------------------------------------------------
// Agent CLIs launched inside terminal panes (the "AI pane" runs one of these).
// ---------------------------------------------------------------------------

export const AGENTS = ['claude', 'codex', 'gemini', 'aider', 'opencode'] as const
export type AgentCommand = (typeof AGENTS)[number]

export const DEFAULT_AGENT: AgentCommand = 'claude'
