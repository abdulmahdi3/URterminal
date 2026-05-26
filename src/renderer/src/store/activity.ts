import { create } from 'zustand'

export interface ActivityEntry {
  id: string
  ts: number
  paneId: string
  paneTitle: string
  role: 'prompt' | 'answer'
  text: string
}

const MAX_ENTRIES = 2000

interface ActivityState {
  entries: ActivityEntry[]
  add: (e: Omit<ActivityEntry, 'id'>) => void
  clear: () => void
}

export const useActivity = create<ActivityState>((set) => ({
  entries: [],
  add: (e) =>
    set((s) => ({
      entries: [...s.entries, { ...e, id: Math.random().toString(36).slice(2, 10) }].slice(-MAX_ENTRIES)
    })),
  clear: () => set({ entries: [] })
}))

/** Render the recorded timeline as Markdown for export. */
export function activityToMarkdown(entries: ActivityEntry[]): string {
  const time = (ts: number): string =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const head = `# URterminal activity — ${new Date().toLocaleString()}\n\n${entries.length} events\n`
  const body = entries
    .map((e) => {
      const icon = e.role === 'prompt' ? '🧑' : '🤖'
      const header = `**${time(e.ts)} · ${e.paneTitle} · ${e.role}**`
      const text = e.role === 'prompt' ? `> ${e.text.replace(/\n/g, '\n> ')}` : e.text
      return `${icon} ${header}\n\n${text}\n`
    })
    .join('\n---\n\n')
  return `${head}\n${body}`
}
