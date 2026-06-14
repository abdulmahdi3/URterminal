import type { OrModelInfo, OrCredits } from '@shared/types'

/**
 * OpenRouter catalog + account helpers (main process). Best-effort: every call
 * is timeout-bounded and returns a safe empty value on any failure, so the
 * renderer can always fall back to the curated DEFAULT_MODELS list.
 */

function headers(apiKey?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    'HTTP-Referer': 'https://github.com/abdulmahdi3/URterminal',
    'X-Title': 'URterminal'
  }
}

async function getJson(url: string, apiKey?: string, timeoutMs = 6000): Promise<unknown> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers: headers(apiKey), signal: ac.signal })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

/** OpenRouter's model catalog → picker rows (id + context length + per-token price). */
export async function fetchOpenRouterModels(apiKey?: string): Promise<OrModelInfo[]> {
  const data = (await getJson('https://openrouter.ai/api/v1/models', apiKey)) as {
    data?: Array<Record<string, unknown>>
  } | null
  const list = data?.data
  if (!Array.isArray(list)) return []
  return list
    .map((m): OrModelInfo | null => {
      const id = typeof m.id === 'string' ? m.id : ''
      if (!id) return null
      const pricing = (m.pricing ?? {}) as Record<string, unknown>
      return {
        id,
        name: typeof m.name === 'string' ? m.name : undefined,
        contextLength: num(m.context_length),
        promptPrice: num(pricing.prompt),
        completionPrice: num(pricing.completion)
      }
    })
    .filter((m): m is OrModelInfo => m !== null)
}

/** Account credit/usage snapshot (GET /api/v1/key). null on failure / no key. */
export async function fetchOpenRouterCredits(apiKey: string): Promise<OrCredits | null> {
  // /credits returns the ACCOUNT balance (purchased credits − usage), which is
  // what "do I have money to run a paid model?" actually depends on.
  const data = (await getJson('https://openrouter.ai/api/v1/credits', apiKey)) as {
    data?: Record<string, unknown>
  } | null
  const d = data?.data
  if (!d || typeof d !== 'object') return null
  const total = num(d.total_credits)
  const used = num(d.total_usage)
  return {
    usage: used,
    limit: total ?? null,
    remaining: total != null && used != null ? total - used : undefined
  }
}
