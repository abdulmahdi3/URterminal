import { create } from 'zustand'
import type { FilePatch } from '@shared/diff'

/** Per-file apply state shown in the diff-review modal. */
export type ReviewStatus = 'pending' | 'applied' | 'failed' | 'skipped'

export interface ReviewPatch extends FilePatch {
  /** stable id within this review batch */
  id: string
  /** whether this file is checked for the next "Apply selected" */
  selected: boolean
  status: ReviewStatus
  error?: string
}

interface DiffReviewState {
  /** the folder file paths resolve against (the source pane's cwd) */
  cwd: string
  patches: ReviewPatch[]
  /** load a fresh batch (dedups to the last patch per file) and reset state */
  open: (patches: FilePatch[], cwd: string) => void
  toggle: (id: string) => void
  setAllSelected: (selected: boolean) => void
  setStatus: (id: string, status: ReviewStatus, error?: string) => void
  reset: () => void
}

/** Keep only the LAST patch seen for each file — re-printed/iterated diffs in the
 *  same buffer collapse to the most recent edit, which is what the user wants. */
function dedupeByFile(patches: FilePatch[]): FilePatch[] {
  const byFile = new Map<string, FilePatch>()
  for (const p of patches) byFile.set(p.file, p)
  return [...byFile.values()]
}

export const useDiffReview = create<DiffReviewState>((set) => ({
  cwd: '',
  patches: [],
  open: (patches, cwd) =>
    set({
      cwd,
      patches: dedupeByFile(patches).map((p, i) => ({
        ...p,
        id: `${i}:${p.file}`,
        selected: true,
        status: 'pending' as const
      }))
    }),
  toggle: (id) =>
    set((s) => ({
      patches: s.patches.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p))
    })),
  setAllSelected: (selected) =>
    set((s) => ({ patches: s.patches.map((p) => ({ ...p, selected })) })),
  setStatus: (id, status, error) =>
    set((s) => ({
      patches: s.patches.map((p) => (p.id === id ? { ...p, status, error } : p))
    })),
  reset: () => set({ cwd: '', patches: [] })
}))
