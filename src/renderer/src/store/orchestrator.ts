import { create } from 'zustand'

/** One worker pane in the active orchestration. */
export interface OrchestratorWorker {
  paneId: string
  subtask: string
}

interface OrchestratorState {
  /** the shared goal of the active orchestration */
  goal: string
  /** worker panes spawned for it (empty = none running) */
  workers: OrchestratorWorker[]
  setRun: (goal: string, workers: OrchestratorWorker[]) => void
  clear: () => void
}

/** Tracks the active orchestration so the modal can monitor + collect results. */
export const useOrchestrator = create<OrchestratorState>((set) => ({
  goal: '',
  workers: [],
  setRun: (goal, workers) => set({ goal, workers }),
  clear: () => set({ goal: '', workers: [] })
}))
