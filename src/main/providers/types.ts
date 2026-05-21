import type { ChatRole, ProviderId } from '@shared/types'

export interface ProviderCreds {
  apiKey?: string
  baseUrl?: string
}

export interface AdapterChatRequest {
  model: string
  messages: { role: ChatRole; content: string }[]
}

export type ChunkHandler = (text: string) => void

export interface ProviderAdapter {
  id: ProviderId
  listModels(creds: ProviderCreds): Promise<string[]>
  streamChat(
    req: AdapterChatRequest,
    creds: ProviderCreds,
    onChunk: ChunkHandler,
    signal: AbortSignal
  ): Promise<void>
}

/** Thrown for non-2xx responses with a readable message. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
