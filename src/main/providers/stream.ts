import { ProviderError } from './types'

/** Read a fetch Response body line-by-line (handles partial chunks). */
export async function* readLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        yield line
      }
    }
    if (buffer.trim()) yield buffer
  } finally {
    reader.releaseLock()
  }
}

/** Iterate `data:` payloads from an SSE stream, skipping comments / [DONE]. */
export async function* readSse(res: Response): AsyncGenerator<string> {
  for await (const line of readLines(res)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '[DONE]' || data === '') continue
    yield data
  }
}

export async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return
  let detail = ''
  try {
    detail = await res.text()
  } catch {
    /* ignore */
  }
  const trimmed = detail.length > 300 ? detail.slice(0, 300) + '…' : detail
  throw new ProviderError(`HTTP ${res.status} ${res.statusText}${trimmed ? ` — ${trimmed}` : ''}`, res.status)
}
