import { create } from 'zustand'
import type { ClaudeUsage } from '@shared/types'

/**
 * Account-global Claude usage from Anthropic's `/usage` endpoint (via main). A
 * single shared interval (mounted once in App) polls it so every claude pane
 * title reads one source. Polled gently — it's a network call and the windows
 * move slowly.
 */
interface ClaudeUsageState extends ClaudeUsage {
  loaded: boolean
  sample: () => Promise<void>
}

const POLL_MS = 60_000

export const useClaudeUsage = create<ClaudeUsageState>((set) => ({
  ok: false,
  fiveHour: null,
  sevenDay: null,
  loaded: false,
  sample: async () => {
    try {
      const u = await window.api.getClaudeUsage()
      set({ ...u, loaded: true })
    } catch {
      set({ loaded: true })
    }
  }
}))

/** Start the shared polling loop; returns a cleanup fn. */
export function startClaudeUsageLoop(): () => void {
  void useClaudeUsage.getState().sample()
  const id = window.setInterval(() => void useClaudeUsage.getState().sample(), POLL_MS)
  return () => window.clearInterval(id)
}

/** "3:10" = 3h10m remaining; "12m" under an hour; "2d 4h" for multi-day windows. */
export function formatResetIn(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return `${h}:${String(m).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
