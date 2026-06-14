import { create } from 'zustand'

/**
 * Folders agents have been opened in — drives the launcher's "Last used" (most
 * recent first) and "Frequently used" (by count) suggestions. Persisted to
 * localStorage. Best-effort.
 */
const KEY = 'urterminal.folderHistory'

interface Persisted {
  recents: string[]
  counts: Record<string, number>
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    const p = raw ? (JSON.parse(raw) as Partial<Persisted>) : {}
    return {
      recents: Array.isArray(p.recents) ? p.recents.filter((x): x is string => typeof x === 'string') : [],
      counts: p.counts && typeof p.counts === 'object' ? p.counts : {}
    }
  } catch {
    return { recents: [], counts: {} }
  }
}
function save(p: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

interface State extends Persisted {
  /** Record that a folder was opened (bumps recency + frequency). */
  record: (path: string) => void
}

export const useFolderHistory = create<State>((set, get) => ({
  ...load(),
  record: (path) => {
    if (!path) return
    const recents = [path, ...get().recents.filter((p) => p !== path)].slice(0, 12)
    const counts = { ...get().counts, [path]: (get().counts[path] ?? 0) + 1 }
    const next = { recents, counts }
    save(next)
    set(next)
  }
}))
