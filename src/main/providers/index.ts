import type { ProviderId } from '@shared/types'
import type { ProviderAdapter } from './types'
import { anthropicAdapter } from './anthropic'
import { openaiAdapter } from './openai'
import { geminiAdapter } from './gemini'
import { ollamaAdapter } from './ollama'

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter
}

export function getAdapter(id: ProviderId): ProviderAdapter {
  return ADAPTERS[id]
}

export type { ProviderAdapter } from './types'
export { ProviderError } from './types'
