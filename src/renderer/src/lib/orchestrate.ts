import { useWorkspace } from '@renderer/store/workspace'
import { useOrchestrator, type OrchestratorWorker } from '@renderer/store/orchestrator'
import { seedPrompt, getFullText } from '@renderer/lib/terminalPool'
import { answerBlocks } from '@renderer/hooks/useChainForwarding'
import { toast } from '@renderer/store/toasts'
import { composeWorkerPrompt, workerLabel, buildReport } from './orchestratePlan'

/**
 * Orchestrator (#2): fan a shared goal out to a set of worker agent panes, one
 * subtask each, then aggregate their answers into a single report. Builds on the
 * existing addPane + seedPrompt (boot-aware typing) + answer-block extraction.
 */

// Re-export the pure planners so callers import from one place.
export { parseSubtasks, composeWorkerPrompt, workerLabel, buildReport } from './orchestratePlan'

export interface OrchestrateSpec {
  goal: string
  subtasks: string[]
  cwd?: string
  command: string
  /** send each subtask immediately (Enter), vs. typing it for the user to send */
  autoSend: boolean
}

/** Spawn a worker pane per subtask and seed each with its prompt. Returns count. */
export function runOrchestration(spec: OrchestrateSpec): number {
  const ws = useWorkspace.getState()
  const workers: OrchestratorWorker[] = []
  for (const subtask of spec.subtasks) {
    const label = workerLabel(subtask)
    const id = ws.addPane('ai', 'row', {
      agentCommand: spec.command,
      agentCwd: spec.cwd,
      label
    })
    if (!id) {
      toast(`Max panes reached — opened ${workers.length} worker(s).`, 'info')
      break
    }
    ws.updatePane(id, { agent: { command: spec.command, cwd: spec.cwd }, title: label })
    seedPrompt(id, composeWorkerPrompt(spec.goal, subtask), spec.autoSend)
    workers.push({ paneId: id, subtask })
  }
  useOrchestrator.getState().setRun(spec.goal, workers)
  return workers.length
}

/** Collect each worker's latest answer block into a markdown report. */
export function collectReport(): string {
  const { goal, workers } = useOrchestrator.getState()
  const results = workers.map((w) => {
    const blocks = answerBlocks(getFullText(w.paneId))
    return { subtask: w.subtask, answer: blocks.length ? blocks[blocks.length - 1] : '' }
  })
  return buildReport(goal, results)
}
