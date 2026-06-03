import { describe, it, expect } from 'vitest'
import { normalizeGoogleTask, dueDateOnly, formatGoogleAgenda } from './googleTasks'
import type { GoogleTaskGroup } from '@shared/types'

describe('normalizeGoogleTask', () => {
  it('maps a typical API task', () => {
    const t = normalizeGoogleTask({
      id: 'abc',
      title: 'Buy milk',
      notes: 'whole',
      status: 'needsAction',
      due: '2026-06-01T00:00:00.000Z',
      updated: '2026-05-31T10:00:00.000Z'
    })
    expect(t).toEqual({
      id: 'abc',
      title: 'Buy milk',
      notes: 'whole',
      status: 'needsAction',
      due: '2026-06-01T00:00:00.000Z',
      completed: undefined,
      updated: '2026-05-31T10:00:00.000Z'
    })
  })

  it('defaults a blank title and coerces unknown status to needsAction', () => {
    const t = normalizeGoogleTask({ id: '1', title: '   ' })
    expect(t.title).toBe('(untitled)')
    expect(t.status).toBe('needsAction')
  })

  it('keeps completed status', () => {
    expect(normalizeGoogleTask({ id: '1', title: 'x', status: 'completed' }).status).toBe('completed')
  })
})

describe('dueDateOnly', () => {
  it('extracts the date part', () => {
    expect(dueDateOnly('2026-06-01T00:00:00.000Z')).toBe('2026-06-01')
  })
  it('passes through undefined', () => {
    expect(dueDateOnly(undefined)).toBeUndefined()
  })
})

describe('formatGoogleAgenda', () => {
  it('renders open tasks grouped by list, skipping empty lists and completed tasks', () => {
    const groups: GoogleTaskGroup[] = [
      {
        list: { id: 'l1', title: 'Work' },
        tasks: [
          { id: 't1', title: 'Ship release', status: 'needsAction', due: '2026-06-02T00:00:00Z' },
          { id: 't2', title: 'Old thing', status: 'completed' }
        ]
      },
      { list: { id: 'l2', title: 'Empty' }, tasks: [] }
    ]
    const out = formatGoogleAgenda(groups)
    expect(out).toContain('📋 Work')
    expect(out).toContain('• Ship release (due 2026-06-02)')
    expect(out).not.toContain('Old thing')
    expect(out).not.toContain('Empty')
  })

  it('reports an empty agenda', () => {
    expect(formatGoogleAgenda([])).toBe('No open Google Tasks. 🎉')
    expect(
      formatGoogleAgenda([{ list: { id: 'l', title: 'L' }, tasks: [{ id: 'c', title: 'done', status: 'completed' }] }])
    ).toBe('No open Google Tasks. 🎉')
  })
})
