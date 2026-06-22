import type {
  UrChatRequest,
  UrChatMessage,
  UrToolCall,
  UrTurnResult,
  UrUsage
} from '@shared/uregant'

/**
 * Uregant local brain — one tool-calling chat turn over Ollama's /api/chat
 * (main process, no browser CORS limit). Mirrors openrouter/chat.ts but Ollama
 * streams NDJSON (one JSON object per line, no `data:`/`[DONE]`), and a turn can
 * emit `message.tool_calls` which the loop controller executes (§4, §7).
 *
 * A per-pane AbortController registry lets a turn be stopped (Stop button / pane
 * close) and lets panes stream independently.
 */

const inflight = new Map<string, AbortController>()

/** Emit callbacks the IPC layer wires to renderer events keyed by paneId. */
export interface UregantEmit {
  delta: (paneId: string, delta: string) => void
  toolCalls: (paneId: string, calls: UrToolCall[]) => void
  done: (paneId: string, result: UrTurnResult) => void
  error: (paneId: string, message: string) => void
}

/** Shape of one streamed Ollama /api/chat chunk (the fields we read). */
interface OllamaChunk {
  message?: {
    content?: string
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>
  }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

/** Abort a pane's in-flight turn. No-op if none. */
export function stopUregant(paneId: string): void {
  const ac = inflight.get(paneId)
  if (ac) {
    ac.abort()
    inflight.delete(paneId)
  }
}

/** Ollama tool_calls → normalized UrToolCall[] (arguments always an object). */
function normalizeToolCalls(raw: OllamaChunk['message']): UrToolCall[] {
  const calls = raw?.tool_calls
  if (!Array.isArray(calls)) return []
  const out: UrToolCall[] = []
  for (const c of calls) {
    const name = c?.function?.name
    if (!name) continue
    let args = c.function?.arguments
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        args = {}
      }
    }
    out.push({
      id: c.id,
      function: {
        name,
        arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
      }
    })
  }
  return out
}

/**
 * Run one chat turn for a pane. Streams deltas/tool-calls/done/error through
 * `emit` AND resolves with the assembled UrTurnResult so the loop controller can
 * decide whether to execute tools and continue.
 */
export async function streamUregant(req: UrChatRequest, emit: UregantEmit): Promise<UrTurnResult> {
  stopUregant(req.paneId) // one in-flight turn per pane
  const ac = new AbortController()
  inflight.set(req.paneId, ac)

  const messages: UrChatMessage[] = req.system
    ? [{ role: 'system', content: req.system }, ...req.messages]
    : req.messages

  const base = req.baseUrl.replace(/\/+$/, '')

  let content = ''
  const toolCalls: UrToolCall[] = []
  let usage: UrUsage | undefined
  let doneReason: string | undefined

  const finish = (): UrTurnResult => ({ content, toolCalls, usage, doneReason })

  try {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages,
        ...(req.tools && req.tools.length ? { tools: req.tools } : {}),
        stream: true,
        keep_alive: req.keepAlive ?? '30m',
        options: {
          temperature: req.temperature ?? 0.4,
          ...(req.numCtx ? { num_ctx: req.numCtx } : {})
        }
      })
    })

    if (!r.ok || !r.body) {
      const detail = await r.text().catch(() => '')
      emit.error(
        req.paneId,
        `Ollama chat failed: HTTP ${r.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
      )
      return finish()
    }

    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // Ollama emits one complete JSON object per \n-terminated line; keep the
    // remainder so an object split across chunk boundaries is reassembled.
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let chunk: OllamaChunk
        try {
          chunk = JSON.parse(line) as OllamaChunk
        } catch {
          continue // ignore a malformed/partial line
        }
        if (chunk.error) {
          emit.error(req.paneId, `Ollama: ${chunk.error}`)
          return finish()
        }
        const text = chunk.message?.content
        if (text) {
          content += text
          emit.delta(req.paneId, text)
        }
        const calls = normalizeToolCalls(chunk.message)
        if (calls.length) {
          toolCalls.push(...calls)
          emit.toolCalls(req.paneId, calls)
        }
        if (chunk.done) {
          doneReason = chunk.done_reason ?? 'stop'
          const pt = num(chunk.prompt_eval_count)
          const ct = num(chunk.eval_count)
          if (pt !== undefined || ct !== undefined) {
            usage = { promptTokens: pt, completionTokens: ct, totalTokens: (pt ?? 0) + (ct ?? 0) }
          }
        }
      }
    }

    const result = finish()
    emit.done(req.paneId, result)
    return result
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      doneReason = 'aborted'
      const result = finish()
      emit.done(req.paneId, result) // keep partial text; not an error
      return result
    }
    emit.error(req.paneId, `Ollama request failed: ${(e as Error).message}`)
    return finish()
  } finally {
    inflight.delete(req.paneId)
  }
}
