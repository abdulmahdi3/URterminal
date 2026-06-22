/**
 * Persisted model eval scores (UREGANT_PLAN.md §16), keyed by catalog tag, so the
 * Registry shows a model's tool-call fidelity next to its fit badge across sessions.
 */
import type { UrEvalResult } from '@shared/uregant'

const KEY = 'uregant.eval'

export type StoredEval = UrEvalResult & { ts: number }

export function getEvalScores(): Record<string, StoredEval> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, StoredEval>
  } catch {
    return {}
  }
}

export function setEvalScore(tag: string, r: UrEvalResult): Record<string, StoredEval> {
  const all = getEvalScores()
  all[tag] = { ...r, ts: Date.now() }
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* ignore quota */
  }
  return all
}
