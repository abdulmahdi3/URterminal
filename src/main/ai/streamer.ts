import type { ChatStreamRequest, StreamChunk } from '@shared/types'
import { getAdapter, ProviderError } from '../providers'
import type { ProviderCreds } from '../providers/types'
import type { SettingsStore } from '../settings/store'

type Emit = (chunk: StreamChunk) => void
type OnComplete = (paneId: string, fullText: string) => void

export class Streamer {
  private active = new Map<string, AbortController>()

  constructor(
    private settings: SettingsStore,
    private emit: Emit,
    private onComplete?: OnComplete
  ) {}

  private credsFor(provider: ChatStreamRequest['provider']): ProviderCreds {
    if (provider === 'ollama') return { baseUrl: this.settings.getOllamaBaseUrl() }
    return { apiKey: this.settings.getApiKey(provider) }
  }

  async start(req: ChatStreamRequest): Promise<void> {
    const controller = new AbortController()
    this.active.set(req.streamId, controller)
    const adapter = getAdapter(req.provider)
    const base = { streamId: req.streamId, paneId: req.paneId }
    let full = ''

    try {
      await adapter.streamChat(
        { model: req.model, messages: req.messages },
        this.credsFor(req.provider),
        (text) => {
          full += text
          this.emit({ ...base, type: 'text', text })
        },
        controller.signal
      )
      this.emit({ ...base, type: 'done' })
      if (full) this.onComplete?.(req.paneId, full)
    } catch (err) {
      if (controller.signal.aborted) {
        // user cancelled — treat as a clean stop
        this.emit({ ...base, type: 'done' })
      } else {
        const message =
          err instanceof ProviderError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err)
        this.emit({ ...base, type: 'error', message })
      }
    } finally {
      this.active.delete(req.streamId)
    }
  }

  cancel(streamId: string): void {
    this.active.get(streamId)?.abort()
    this.active.delete(streamId)
  }

  cancelAll(): void {
    for (const c of this.active.values()) c.abort()
    this.active.clear()
  }

  get activeCount(): number {
    return this.active.size
  }
}
