import type { OrSendRequest, OrUsage } from '@shared/types'

/**
 * Streaming OpenRouter chat backend (main process — no browser CORS limit).
 * Mirrors the header/body shape of `runOpenRouter` (../learning/model.ts) but
 * with `stream: true` + `usage: { include: true }`, SSE parsing, and a per-pane
 * AbortController registry so a turn can be stopped and panes stream independently.
 */

const inflight = new Map<string, AbortController>()

/** Emit callbacks the IPC layer wires to renderer events keyed by paneId. */
export interface ChatEmit {
  delta: (paneId: string, delta: string) => void
  done: (paneId: string, usage: OrUsage | undefined, finishReason?: string) => void
  error: (paneId: string, message: string) => void
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

/** OpenRouter usage object → our OrUsage (it returns `cost` in USD with usage.include). */
function mapUsage(u: unknown): OrUsage | undefined {
  if (!u || typeof u !== 'object') return undefined
  const o = u as Record<string, unknown>
  const out: OrUsage = {
    promptTokens: num(o.prompt_tokens),
    completionTokens: num(o.completion_tokens),
    totalTokens: num(o.total_tokens),
    costUsd: num(o.cost)
  }
  return Object.values(out).some((v) => v !== undefined) ? out : undefined
}

/** Abort a pane's in-flight turn (Stop button / pane close). No-op if none. */
export function stopOpenRouter(paneId: string): void {
  const ac = inflight.get(paneId)
  if (ac) {
    ac.abort()
    inflight.delete(paneId)
  }
}

/**
 * Stream one chat turn for a pane. Resolves when the stream ends; the result is
 * delivered through `emit` (delta/done/error), not the return value.
 */
export async function streamOpenRouter(
  apiKey: string,
  req: OrSendRequest,
  emit: ChatEmit
): Promise<void> {
  stopOpenRouter(req.paneId) // one in-flight turn per pane
  const ac = new AbortController()
  inflight.set(req.paneId, ac)

  const messages = req.system
    ? [{ role: 'system', content: req.system }, ...req.messages]
    : req.messages

  let usage: OrUsage | undefined
  let finishReason: string | undefined

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/abdulmahdi3/URterminal',
        'X-Title': 'URterminal'
      },
      body: JSON.stringify({
        model: req.model,
        temperature: req.temperature ?? 0.7,
        stream: true,
        usage: { include: true },
        messages
      })
    })

    if (!r.ok || !r.body) {
      const detail = await r.text().catch(() => '')
      emit.error(
        req.paneId,
        `OpenRouter failed: HTTP ${r.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
      )
      return
    }

    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let streaming = true

    // Parse only complete \n-terminated SSE lines; keep the remainder so a `data:`
    // line split across chunk boundaries is reassembled before JSON.parse.
    while (streaming) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line || line.startsWith(':')) continue // blank or keepalive comment
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          streaming = false
          break
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
            usage?: unknown
          }
          const choice = json.choices?.[0]
          const content = choice?.delta?.content
          if (content) emit.delta(req.paneId, content)
          if (choice?.finish_reason) finishReason = choice.finish_reason
          const u = mapUsage(json.usage)
          if (u) usage = u
        } catch {
          /* ignore a malformed/partial line */
        }
      }
    }
    emit.done(req.paneId, usage, finishReason)
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      // Stopped by the user — keep any partial text, not an error.
      emit.done(req.paneId, usage, 'aborted')
    } else {
      emit.error(req.paneId, `OpenRouter request failed: ${(e as Error).message}`)
    }
  } finally {
    inflight.delete(req.paneId)
  }
}
