import { create } from 'zustand'

const KEY = 'urterminal.shortcuts.v1'

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

interface ShortcutsState {
  /** commandId → combo string (e.g. "Ctrl+Shift+S") */
  custom: Record<string, string>
  setShortcut: (id: string, combo: string) => void
  clearShortcut: (id: string) => void
}

function save(map: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export const useShortcuts = create<ShortcutsState>((set, get) => ({
  custom: load(),
  setShortcut: (id, combo) => {
    // A combo maps to a single command — drop any other command's custom use of it.
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(get().custom)) if (v !== combo) next[k] = v
    next[id] = combo
    save(next)
    set({ custom: next })
  },
  clearShortcut: (id) => {
    const next = { ...get().custom }
    delete next[id]
    save(next)
    set({ custom: next })
  }
}))
