import { describe, it, expect } from 'vitest'
import { parseSubtasks, composeWorkerPrompt, workerLabel, buildReport } from './orchestratePlan'

describe('parseSubtasks', () => {
  it('trims and drops blank lines', () => {
    expect(parseSubtasks(' a \n\n b \n   \n')).toEqual(['a', 'b'])
  })
  it('handles CRLF and is empty for whitespace', () => {
    expect(parseSubtasks('x\r\ny')).toEqual(['x', 'y'])
    expect(parseSubtasks('  \n\t')).toEqual([])
  })
})

describe('composeWorkerPrompt', () => {
  it('includes goal + subtask when a goal is set', () => {
    const p = composeWorkerPrompt('Ship v2', 'Write the migration')
    expect(p).toContain('Shared goal: Ship v2')
    expect(p).toContain('Write the migration')
  })
  it('is just the subtask when no goal', () => {
    expect(composeWorkerPrompt('   ', 'Do the thing')).toBe('Do the thing')
  })
})

describe('workerLabel', () => {
  it('passes short labels through', () => {
    expect(workerLabel('build')).toBe('build')
  })
  it('truncates long labels with an ellipsis', () => {
    expect(workerLabel('a'.repeat(40), 10)).toBe('aaaaaaaaa…')
    expect(workerLabel('a'.repeat(40), 10)).toHaveLength(10)
  })
})

describe('buildReport', () => {
  it('renders a section per worker with answers', () => {
    const md = buildReport('Goal X', [
      { subtask: 'task A', answer: 'did A' },
      { subtask: 'task B', answer: '' }
    ])
    expect(md).toContain('**Goal:** Goal X')
    expect(md).toContain('## Worker 1: task A')
    expect(md).toContain('did A')
    expect(md).toContain('## Worker 2: task B')
    expect(md).toContain('_(no answer captured yet)_') // empty answer placeholder
  })
  it('shows (none) when goal is blank', () => {
    expect(buildReport('  ', [])).toContain('**Goal:** (none)')
  })
})
