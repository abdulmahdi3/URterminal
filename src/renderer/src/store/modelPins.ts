import { create } from 'zustand'

/**
 * User-pinned OpenRouter model ids (favorites). Pinned models float to the top of
 * the model picker + the Others browser and appear as quick-launch cards at the
 * top of the launch console. Persisted to localStorage; newest pin first.
 */
const KEY = 'urterminal.modelPins'

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function save(pinned: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pinned))
  } catch {
    /* ignore quota / unavailable */
  }
}

interface PinState {
  pinned: string[]
  /** pin (newest first) or unpin a model id */
  toggle: (id: string) => void
}

export const useModelPins = create<PinState>((set, get) => ({
  pinned: load(),
  toggle: (id) => {
    const cur = get().pinned
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur]
    save(next)
    set({ pinned: next })
  }
}))
