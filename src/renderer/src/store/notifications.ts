import { create } from 'zustand'

export type NotifKind = 'agent' | 'update' | 'error' | 'info'

export interface NotificationItem {
  id: string
  kind: NotifKind
  title: string
  body?: string
  /** epoch ms */
  ts: number
  read: boolean
}

interface NotifState {
  /** newest first */
  items: NotificationItem[]
  unread: number
  push: (n: { kind: NotifKind; title: string; body?: string }) => void
  markAllRead: () => void
  clear: () => void
}

const MAX = 50
let counter = 0

export const useNotifications = create<NotifState>((set) => ({
  items: [],
  unread: 0,

  push: (n) =>
    set((s) => {
      const item: NotificationItem = {
        id: `n${++counter}`,
        kind: n.kind,
        title: n.title,
        body: n.body,
        ts: Date.now(),
        read: false
      }
      return { items: [item, ...s.items].slice(0, MAX), unread: s.unread + 1 }
    }),

  markAllRead: () =>
    set((s) => (s.unread === 0 ? s : { items: s.items.map((i) => ({ ...i, read: true })), unread: 0 })),

  clear: () => set({ items: [], unread: 0 })
}))

/** "just now" / "5m" / "3h" / "2d" relative time for the feed. */
export function relativeTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}
