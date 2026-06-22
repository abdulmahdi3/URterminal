/**
 * Live `ollama pull` progress per model tag (Phase 2, Slice 2). Fed by
 * useUregantStream from the uregant:pull-progress event; read by the Registry.
 */
import { create } from 'zustand'
import type { UrPullProgress } from '@shared/uregant'

interface PullState {
  byTag: Record<string, UrPullProgress>
  _progress: (p: UrPullProgress) => void
  clear: (tag: string) => void
}

export const useUregantPulls = create<PullState>((set) => ({
  byTag: {},
  _progress: (p) => set((s) => ({ byTag: { ...s.byTag, [p.tag]: p } })),
  clear: (tag) =>
    set((s) => {
      const b = { ...s.byTag }
      delete b[tag]
      return { byTag: b }
    })
}))
