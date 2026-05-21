import type { ProviderAdapter } from './types'
import { ProviderError } from './types'
import { readSse, ensureOk } from './stream'

const API = 'https://api.anthropic.com/v1'
const VERSION = '2023-06-01'

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',

  async listModels(creds) {
    if (!creds.apiKey) throw new ProviderError('Missing Anthropic API key')
    const res = await fetch(`${API}/models?limit=100`, {
      headers: { 'x-api-key': creds.apiKey, 'anthropic-version': VERSION }
    })
    await ensureOk(res)
    const json = (await res.json()) as { data: { id: string }[] }
    return json.data.map((m) => m.id)
  },

  async streamChat(req, creds, onChunk, signal) {
    if (!creds.apiKey) throw new ProviderError('Missing Anthropic API key')

    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))

    const res = await fetch(`${API}/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': creds.apiKey,
        'anthropic-version': VERSION
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: 4096,
        stream: true,
        ...(system ? { system } : {}),
        messages
      })
    })
    await ensureOk(res)

    for await (const data of readSse(res)) {
      let evt: { type: string; delta?: { type?: string; text?: string } }
      try {
        evt = JSON.parse(data)
      } catch {
        continue
      }
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
        onChunk(evt.delta.text)
      }
    }
  }
}
