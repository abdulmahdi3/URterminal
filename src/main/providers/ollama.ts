import type { ProviderAdapter } from './types'
import { ProviderError } from './types'
import { readLines, ensureOk } from './stream'
import { DEFAULT_OLLAMA_URL } from '@shared/providers'

export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',

  async listModels(creds) {
    const base = creds.baseUrl || DEFAULT_OLLAMA_URL
    const res = await fetch(`${base}/api/tags`)
    await ensureOk(res)
    const json = (await res.json()) as { models?: { name: string }[] }
    return (json.models ?? []).map((m) => m.name)
  },

  async streamChat(req, creds, onChunk, signal) {
    const base = creds.baseUrl || DEFAULT_OLLAMA_URL
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        stream: true,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    })
    await ensureOk(res)

    // Ollama streams newline-delimited JSON objects.
    for await (const line of readLines(res)) {
      if (!line.trim()) continue
      let evt: { message?: { content?: string }; error?: string; done?: boolean }
      try {
        evt = JSON.parse(line)
      } catch {
        continue
      }
      if (evt.error) throw new ProviderError(evt.error)
      const text = evt.message?.content
      if (text) onChunk(text)
    }
  }
}
