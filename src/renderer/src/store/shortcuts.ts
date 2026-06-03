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
  /**
   * commandId → override combo. A value like "Ctrl+Shift+S" rebinds the command;
   * an empty string "" means explicitly UNBOUND (suppresses the built-in default,
   * used to free a combo when it's reassigned elsewhere); absent = use default.
   */
  custom: Record<string, string>
  /** rebind a command to a combo ("" to unbind). Does not touch other commands. */
  setShortcut: (id: string, combo: string) => void
  /** drop a command's override, reverting it to its built-in default. */
  clearShortcut: (id: string) => void
  /** clear ALL overrides → every command back to its default. */
  resetAll: () => void
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
    const next = { ...get().custom, [id]: combo }
    save(next)
    set({ custom: next })
  },
  clearShortcut: (id) => {
    const next = { ...get().custom }
    delete next[id]
    save(next)
    set({ custom: next })
  },
  resetAll: () => {
    save({})
    set({ custom: {} })
  }
}))

/** The combo a command is currently bound to ("" = unbound), or undefined if unbound/none. */
export function effectiveCombo(
  custom: Record<string, string>,
  id: string,
  fallback: string | undefined
): string | undefined {
  const v = id in custom ? custom[id] : fallback
  return v || undefined
}
