/**
 * The build loop — the daily rhythm of vibe coding, made visible: Set the vibe →
 * Open the room → Run the crew → Review the work. The point isn't to hide
 * complexity, it's to keep the moving parts visible enough that you can steer
 * them. This is the pure phase derivation (from a live snapshot), unit-tested;
 * BuildTimelineModal renders it.
 */

export type LoopPhase = 'task' | 'workspace' | 'agents' | 'review'

export const LOOP_PHASES: { id: LoopPhase; name: string; hint: string }[] = [
  { id: 'task', name: 'Set the vibe', hint: 'Start from a task, repo or idea' },
  { id: 'workspace', name: 'Open the room', hint: 'Panes + context, one center of gravity' },
  { id: 'agents', name: 'Run the crew', hint: 'Spin up agents, watch status live' },
  { id: 'review', name: 'Review the work', hint: 'Decide what ships — you stay in the room' }
]

export interface LoopSnapshot {
  /** total panes open in the workspace */
  paneCount: number
  /** agent + stream panes (the "crew") */
  agentPaneCount: number
  /** recorded prompt/answer events */
  activityCount: number
  /** agent answers produced (work to review) */
  answerCount: number
}

/** The furthest phase reached for a snapshot (0..3). */
export function currentPhaseIndex(s: LoopSnapshot): number {
  if (s.answerCount > 0) return 3
  if (s.agentPaneCount > 0 || s.activityCount > 0) return 2
  if (s.paneCount > 0) return 1
  return 0
}

export function currentPhase(s: LoopSnapshot): LoopPhase {
  return LOOP_PHASES[currentPhaseIndex(s)].id
}
