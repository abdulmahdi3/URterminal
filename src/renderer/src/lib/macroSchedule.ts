/**
 * Pure macro scheduling — deliberately free of any renderer/store/xterm imports
 * so it stays unit-testable in the node test environment (see vitest.config:
 * environment 'node'). The stateful replay lives in macros.ts (`runMacro`),
 * which maps this onto window.setTimeout + writePty.
 */

const ESC = String.fromCharCode(27)
/** Bracketed-paste wrap. Mirrors inject.ts `bracketPaste`; kept local to stay pure. */
export const bracketPaste = (s: string): string => `${ESC}[200~${s}${ESC}[201~`

/** Delay between consecutive macro steps. */
export const MACRO_STEP_DELAY_MS = 600
/** Gap between pasting a line and submitting it (matches injectText). */
export const MACRO_SUBMIT_DELAY_MS = 150

/** One scheduled terminal write: `data` should be sent at `atMs` from start. */
export interface MacroEvent {
  atMs: number
  data: string
}

/** Split a textarea body into trimmed, non-empty step lines. */
export function parseMacroSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/** Render steps back into a textarea body (one per line). */
export function stepsToText(steps: string[]): string {
  return steps.join('\n')
}

/**
 * Compute the ordered write events for a macro: for each non-empty step, a
 * bracketed paste at its slot, then a carriage return shortly after. Blank steps
 * are skipped without leaving a gap in the timing.
 */
export function macroSchedule(
  steps: string[],
  stepDelayMs: number = MACRO_STEP_DELAY_MS,
  submitDelayMs: number = MACRO_SUBMIT_DELAY_MS
): MacroEvent[] {
  const events: MacroEvent[] = []
  parseMacroSteps(steps.join('\n')).forEach((step, i) => {
    const base = i * stepDelayMs
    events.push({ atMs: base, data: bracketPaste(step) })
    events.push({ atMs: base + submitDelayMs, data: '\r' })
  })
  return events
}
