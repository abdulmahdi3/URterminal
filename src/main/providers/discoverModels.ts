import type { ProviderId } from '@shared/types'
import { defaultLocalBaseUrl, isLocalProvider } from '@shared/providers'

/**
 * Live model discovery for local providers (Ollama / LM Studio).
 *
 * Both run an HTTP server the user already started; we ask it which models are
 * actually installed instead of guessing from a hardcoded list. Everything here
 * is best-effort: a missing server, a non-200, or malformed JSON yields `[]` (not
 * an error) so the UI degrades to the static fallback list and never blocks.
 */

const DISCOVERY_TIMEOUT_MS = 3000

/** Fetch JSON with a short timeout; returns null on any failure. */
async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: controller.signal })
    if (!r.ok) return null
    return (await r.json()) as unknown
  } catch {
    return null // server down / aborted / not JSON — degrade to fallback
  } finally {
    clearTimeout(timer)
  }
}

/** Drop a trailing slash so we can append known paths cleanly. */
function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/** Ollama native list: `GET /api/tags` -> `{ models: [{ name }] }`. */
export function parseOllamaTags(data: unknown): string[] {
  const models = (data as { models?: Array<{ name?: unknown }> } | null)?.models
  if (!Array.isArray(models)) return []
  return models.map((m) => (typeof m?.name === 'string' ? m.name : '')).filter(Boolean)
}

export async function discoverOllamaModels(baseUrl: string): Promise<string[]> {
  const data = await fetchJson(`${trimBase(baseUrl)}/api/tags`)
  return data ? parseOllamaTags(data) : []
}

/** OpenAI-compatible list (LM Studio): `GET /v1/models` -> `{ data: [{ id }] }`. */
export function parseOpenAIModels(data: unknown): string[] {
  const list = (data as { data?: Array<{ id?: unknown }> } | null)?.data
  if (!Array.isArray(list)) return []
  return list.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
}

export async function discoverLmStudioModels(baseUrl: string): Promise<string[]> {
  const data = await fetchJson(`${trimBase(baseUrl)}/v1/models`)
  return data ? parseOpenAIModels(data) : []
}

/**
 * Discover installed models for a provider. Returns `[]` for non-local providers
 * and on any failure. `baseUrl` falls back to the provider's default when omitted.
 */
export async function discoverModels(provider: ProviderId, baseUrl?: string): Promise<string[]> {
  if (!isLocalProvider(provider)) return []
  const url = (baseUrl && baseUrl.trim()) || defaultLocalBaseUrl(provider)
  if (!url) return []
  if (provider === 'ollama') return discoverOllamaModels(url)
  if (provider === 'lmstudio') return discoverLmStudioModels(url)
  return []
}
