/**
 * Tiny translation helper backed by Google Translate's free `gtx` endpoint —
 * the same one browser translate extensions use. No API key; we call it from the
 * main process so the renderer isn't blocked by CORS. Best-effort: throws a
 * readable error on failure so the UI can show it.
 */

export interface TranslateResult {
  /** the translated text */
  text: string
  /** detected source language code (e.g. "en"), if Google reported one */
  sourceLang?: string
}

/**
 * Parse the `translate_a/single` response shape into our result.
 * The body looks like: [[["translated","source",...], ...], null, "en", ...]
 * Exported for unit testing (no network).
 */
export function parseGoogleTranslate(body: unknown): TranslateResult {
  if (!Array.isArray(body)) return { text: '' }
  const segments = Array.isArray(body[0]) ? (body[0] as unknown[]) : []
  const text = segments
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('')
  const sourceLang = typeof body[2] === 'string' ? (body[2] as string) : undefined
  return { text, sourceLang }
}

/** Translate `text` into the target language code (e.g. "ar", "en", "fr"). */
export async function translateText(text: string, targetLang: string): Promise<TranslateResult> {
  const trimmed = text.trim()
  if (!trimmed) return { text: '' }
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang || 'en')}&dt=t&q=${encodeURIComponent(trimmed)}`
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch((e) => {
    throw new Error(`Translation request failed: ${(e as Error).message}`)
  })
  if (!r.ok) throw new Error(`Translation failed: HTTP ${r.status}`)
  const body = (await r.json()) as unknown
  const result = parseGoogleTranslate(body)
  if (!result.text) throw new Error('Translation returned no text')
  return result
}
