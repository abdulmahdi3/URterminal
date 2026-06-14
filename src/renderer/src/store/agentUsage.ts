import { create } from 'zustand'

/**
 * How often each agent (by command) has been launched from the console. Drives
 * the launch console's "Most used" row. Persisted to localStorage so it survives
 * restarts; tiny and best-effort.
 */
const KEY = 'urterminal.agentUsage'

function load(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}
function save(counts: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(counts))
  } catch {
    /* ignore quota / unavailable */
  }
}

interface UsageState {
  counts: Record<string, number>
  /** Record one launch of an agent command. */
  record: (command: string) => void
}

export const useAgentUsage = create<UsageState>((set, get) => ({
  counts: load(),
  record: (command) => {
    const counts = { ...get().counts, [command]: (get().counts[command] ?? 0) + 1 }
    save(counts)
    set({ counts })
  }
}))
