/**
 * Uregant model eval probe (UREGANT_PLAN.md §16). A tiny, deterministic
 * tool-call-fidelity test: ask the model to call an `echo` tool with a required
 * arg and check it actually emits a valid tool_call (rather than prose). Surfaces
 * whether an installed model can really drive the orchestrator's tools.
 */
import type { UrEvalResult } from '@shared/uregant'

const ECHO_TOOL = {
  type: 'function',
  function: {
    name: 'echo',
    description: 'Echo the given text back to the user.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  }
}

interface ChatResp {
  message?: {
    content?: string
    tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>
  }
}

export async function evalModel(baseUrl: string, model: string): Promise<UrEvalResult> {
  if (!baseUrl) return { ok: false, toolCalled: false, latencyMs: 0, note: 'no Ollama base URL' }
  const base = baseUrl.replace(/\/+$/, '')
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 90_000)
  const t0 = Date.now()
  try {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0 },
        keep_alive: '5m',
        tools: [ECHO_TOOL],
        messages: [
          { role: 'user', content: 'Call the echo tool with text "ping". Use the tool — do not reply in prose.' }
        ]
      })
    })
    const latencyMs = Date.now() - t0
    if (!r.ok) {
      const d = await r.text().catch(() => '')
      return { ok: false, toolCalled: false, latencyMs, note: `HTTP ${r.status}${d ? ` — ${d.slice(0, 120)}` : ''}` }
    }
    const j = (await r.json()) as ChatResp
    const calls = j.message?.tool_calls
    const call = Array.isArray(calls) ? calls.find((c) => c.function?.name === 'echo') : undefined
    const secs = (latencyMs / 1000).toFixed(1)
    if (call) {
      let args = call.function?.arguments
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args)
        } catch {
          /* leave as-is */
        }
      }
      const hasText = !!(args && typeof args === 'object' && 'text' in (args as Record<string, unknown>))
      return {
        ok: true,
        toolCalled: true,
        latencyMs,
        note: hasText ? `valid tool call · ${secs}s` : `tool call missing required arg · ${secs}s`
      }
    }
    return { ok: false, toolCalled: false, latencyMs, note: `replied in prose — weak tool-calling · ${secs}s` }
  } catch (e) {
    const latencyMs = Date.now() - t0
    if ((e as Error).name === 'AbortError') {
      return { ok: false, toolCalled: false, latencyMs, note: 'timed out (model load too slow?)' }
    }
    return { ok: false, toolCalled: false, latencyMs, note: (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}
