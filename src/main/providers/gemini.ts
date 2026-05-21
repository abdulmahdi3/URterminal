import type { ProviderAdapter } from './types'
import { ProviderError } from './types'
import { readSse, ensureOk } from './stream'

const API = 'https://generativelanguage.googleapis.com/v1beta'

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',

  async listModels(creds) {
    if (!creds.apiKey) throw new ProviderError('Missing Gemini API key')
    const res = await fetch(`${API}/models?key=${encodeURIComponent(creds.apiKey)}&pageSize=100`)
    await ensureOk(res)
    const json = (await res.json()) as {
      models: { name: string; supportedGenerationMethods?: string[] }[]
    }
    return json.models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
  },

  async streamChat(req, creds, onChunk, signal) {
    if (!creds.apiKey) throw new ProviderError('Missing Gemini API key')

    const systemText = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))

    const res = await fetch(
      `${API}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(creds.apiKey)}`,
      {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {})
        })
      }
    )
    await ensureOk(res)

    for await (const data of readSse(res)) {
      let evt: { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      try {
        evt = JSON.parse(data)
      } catch {
        continue
      }
      const parts = evt.candidates?.[0]?.content?.parts
      if (parts) for (const p of parts) if (p.text) onChunk(p.text)
    }
  }
}
