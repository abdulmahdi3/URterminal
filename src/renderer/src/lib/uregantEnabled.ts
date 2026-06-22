/**
 * Per-model "enabled" set for the Registry (Phase 2, Slice 2). Persisted in
 * localStorage — a lightweight user preference; the Uregant pane picker can later
 * filter to enabled models. Keyed by model id/tag (local Ollama tag or cloud id).
 */
const KEY = 'uregant.enabled'

export function getEnabled(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function toggleEnabled(id: string): Set<string> {
  const s = getEnabled()
  if (s.has(id)) s.delete(id)
  else s.add(id)
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]))
  } catch {
    /* ignore quota/availability */
  }
  return s
}
