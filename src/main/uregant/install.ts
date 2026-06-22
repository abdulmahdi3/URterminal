/**
 * Uregant model install (Phase 2, Slice 2) — streams `ollama pull` progress.
 * POSTs /api/pull with stream:true, parses Ollama's NDJSON progress lines, and
 * emits {status, completed, total, done, error} per tag. Abortable per tag.
 */

interface PullEmit {
  progress: (
    tag: string,
    p: { status: string; completed?: number; total?: number; done?: boolean; error?: string }
  ) => void
}

const pulls = new Map<string, AbortController>()

export function cancelPull(tag: string): void {
  const ac = pulls.get(tag)
  if (ac) {
    ac.abort()
    pulls.delete(tag)
  }
}

interface OllamaPullChunk {
  status?: string
  completed?: number
  total?: number
  error?: string
}

export async function pullModel(baseUrl: string, tag: string, emit: PullEmit): Promise<void> {
  if (!baseUrl) {
    emit.progress(tag, { status: 'failed', error: 'no Ollama base URL', done: true })
    return
  }
  cancelPull(tag)
  const ac = new AbortController()
  pulls.set(tag, ac)
  const base = baseUrl.replace(/\/+$/, '')

  try {
    const r = await fetch(`${base}/api/pull`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tag, stream: true })
    })
    if (!r.ok || !r.body) {
      const detail = await r.text().catch(() => '')
      emit.progress(tag, { status: 'failed', error: `HTTP ${r.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`, done: true })
      return
    }
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let chunk: OllamaPullChunk
        try {
          chunk = JSON.parse(line) as OllamaPullChunk
        } catch {
          continue
        }
        if (chunk.error) {
          emit.progress(tag, { status: 'failed', error: chunk.error, done: true })
          return
        }
        const status = chunk.status ?? ''
        emit.progress(tag, {
          status,
          completed: typeof chunk.completed === 'number' ? chunk.completed : undefined,
          total: typeof chunk.total === 'number' ? chunk.total : undefined,
          done: status === 'success'
        })
      }
    }
    emit.progress(tag, { status: 'success', done: true })
  } catch (e) {
    if ((e as Error).name === 'AbortError') emit.progress(tag, { status: 'canceled', done: true })
    else emit.progress(tag, { status: 'failed', error: (e as Error).message, done: true })
  } finally {
    pulls.delete(tag)
  }
}
