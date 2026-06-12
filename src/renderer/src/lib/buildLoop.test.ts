import { describe, it, expect } from 'vitest'
import { LOOP_PHASES, currentPhaseIndex, currentPhase } from './buildLoop'

const snap = (o: Partial<Parameters<typeof currentPhaseIndex>[0]>) => ({
  paneCount: 0,
  agentPaneCount: 0,
  activityCount: 0,
  answerCount: 0,
  ...o
})

describe('build loop', () => {
  it('has the four phases in order', () => {
    expect(LOOP_PHASES.map((p) => p.id)).toEqual(['task', 'workspace', 'agents', 'review'])
  })

  it('starts at "task" with nothing open', () => {
    expect(currentPhaseIndex(snap({}))).toBe(0)
    expect(currentPhase(snap({}))).toBe('task')
  })

  it('reaches "workspace" once a pane is open', () => {
    expect(currentPhase(snap({ paneCount: 1 }))).toBe('workspace')
  })

  it('reaches "agents" with an agent pane or any activity', () => {
    expect(currentPhase(snap({ paneCount: 2, agentPaneCount: 1 }))).toBe('agents')
    expect(currentPhase(snap({ paneCount: 1, activityCount: 3 }))).toBe('agents')
  })

  it('reaches "review" once an agent has produced output', () => {
    expect(currentPhase(snap({ paneCount: 2, agentPaneCount: 1, activityCount: 4, answerCount: 1 }))).toBe('review')
  })
})
