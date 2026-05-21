import type { ProviderAdapter } from './types'
import { ProviderError } from './types'
import { readSse, ensureOk } from './stream'

const API = 'https://api.openai.com/v1'

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',

  async listModels(creds) {
    if (!creds.apiKey) throw new ProviderError('Missing OpenAI API key')
    const res = await fetch(`${API}/models`, {
      headers: { Authorization: `Bearer ${creds.apiKey}` }
    })
    await ensureOk(res)
    const json = (await res.json()) as { data: { id: string }[] }
    return json.data
      .map((m) => m.id)
      .filter((id) => /^(gpt-|o\d|chatgpt)/.test(id))
      .sort()
  },

  async streamChat(req, creds, onChunk, signal) {
    if (!creds.apiKey) throw new ProviderError('Missing OpenAI API key')
    const res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${creds.apiKey}`
      },
      body: JSON.stringify({
        model: req.model,
        stream: true,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    })
    await ensureOk(res)

    for await (const data of readSse(res)) {
      let evt: { choices?: { delta?: { content?: string } }[] }
      try {
        evt = JSON.parse(data)
      } catch {
        continue
      }
      const text = evt.choices?.[0]?.delta?.content
      if (text) onChunk(text)
    }
  }
}
