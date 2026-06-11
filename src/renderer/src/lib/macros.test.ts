import { describe, it, expect } from 'vitest'
import {
  parseMacroSteps,
  stepsToText,
  macroSchedule,
  MACRO_STEP_DELAY_MS,
  MACRO_SUBMIT_DELAY_MS
} from './macroSchedule'

describe('parseMacroSteps', () => {
  it('trims and drops blank lines', () => {
    expect(parseMacroSteps('  npm test \n\n  git status\n   \n')).toEqual(['npm test', 'git status'])
  })
  it('handles CRLF', () => {
    expect(parseMacroSteps('a\r\nb')).toEqual(['a', 'b'])
  })
  it('is empty for whitespace-only input', () => {
    expect(parseMacroSteps('   \n\t\n')).toEqual([])
  })
})

describe('stepsToText', () => {
  it('round-trips with parseMacroSteps', () => {
    const steps = ['npm install', 'npm run build', 'npm test']
    expect(parseMacroSteps(stepsToText(steps))).toEqual(steps)
  })
})

describe('macroSchedule', () => {
  it('emits a paste then a submit per step, in order', () => {
    const ev = macroSchedule(['one', 'two'], 1000, 100)
    expect(ev).toHaveLength(4)
    // step 0: paste at 0, submit at 100
    expect(ev[0].atMs).toBe(0)
    expect(ev[0].data).toContain('one')
    expect(ev[1]).toEqual({ atMs: 100, data: '\r' })
    // step 1: paste at 1000, submit at 1100
    expect(ev[2].atMs).toBe(1000)
    expect(ev[2].data).toContain('two')
    expect(ev[3]).toEqual({ atMs: 1100, data: '\r' })
  })

  it('wraps each step in bracketed-paste markers', () => {
    const [paste] = macroSchedule(['ls'])
    expect(paste.data).toBe('\x1b[200~ls\x1b[201~')
  })

  it('skips blank steps and keeps timing contiguous', () => {
    const ev = macroSchedule(['a', '   ', 'b'])
    expect(ev).toHaveLength(4) // only 2 real steps × (paste+submit)
    expect(ev[0].atMs).toBe(0)
    expect(ev[2].atMs).toBe(MACRO_STEP_DELAY_MS) // 'b' is slot 1, not slot 2
    expect(ev[3].atMs).toBe(MACRO_STEP_DELAY_MS + MACRO_SUBMIT_DELAY_MS)
  })

  it('returns nothing for an empty macro', () => {
    expect(macroSchedule([])).toEqual([])
    expect(macroSchedule(['', '  '])).toEqual([])
  })
})
