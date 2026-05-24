import { create } from 'zustand'

interface CopiedState {
  visible: boolean
  /** show the "Copied" flash; repeated calls (e.g. while dragging a selection) keep it up and reset its timeout */
  flash: () => void
}

let timer = 0

export const useCopied = create<CopiedState>((set) => ({
  visible: false,
  flash: () => {
    set({ visible: true })
    window.clearTimeout(timer)
    timer = window.setTimeout(() => set({ visible: false }), 900)
  }
}))

/** Convenience for non-component callers (e.g. the terminal pool). */
export const flashCopied = (): void => useCopied.getState().flash()
