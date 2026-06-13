import { create } from 'zustand'

const KEY = 'urterminal.sidebar.v1'

interface Persisted {
  pinned: boolean
  agentPins: string[]
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<Persisted>
      return { pinned: !!v.pinned, agentPins: Array.isArray(v.agentPins) ? v.agentPins : [] }
    }
  } catch {
    /* ignore */
  }
  return { pinned: false, agentPins: [] }
}

interface SidebarState {
  /** rail locked open (vs. hover-to-expand) — toggled with Ctrl+B */
  pinned: boolean
  /** agent command ids the user pinned to the rail's quick-launch row */
  agentPins: string[]
  togglePinned: () => void
  setPinned: (v: boolean) => void
  togglePin: (id: string) => void
}

function save(s: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore quota / private-mode */
  }
}

export const useSidebar = create<SidebarState>((set, get) => ({
  ...load(),
  togglePinned: () => {
    const pinned = !get().pinned
    save({ pinned, agentPins: get().agentPins })
    set({ pinned })
  },
  setPinned: (pinned) => {
    save({ pinned, agentPins: get().agentPins })
    set({ pinned })
  },
  togglePin: (id) => {
    const cur = get().agentPins
    const agentPins = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    save({ pinned: get().pinned, agentPins })
    set({ agentPins })
  }
}))
