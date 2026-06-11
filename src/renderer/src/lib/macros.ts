import type { MacroItem } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toasts'
import { ptyOf } from './inject'
import { macroSchedule } from './macroSchedule'

/**
 * Macros (#14): a saved sequence of command/prompt lines replayed into the
 * active pane, one after another. Each line is pasted then submitted (Enter),
 * and the lines are spaced apart so the shell/agent finishes consuming one
 * before the next arrives — replaying a routine you'd otherwise retype.
 *
 * The pure scheduling lives in ./macroSchedule (unit-tested without timers or
 * the renderer); `runMacro` just maps it onto window.setTimeout + writePty.
 */

// Re-export the pure helpers so callers can `import { ... } from '@renderer/lib/macros'`.
export {
  parseMacroSteps,
  stepsToText,
  macroSchedule,
  MACRO_STEP_DELAY_MS,
  MACRO_SUBMIT_DELAY_MS,
  type MacroEvent
} from './macroSchedule'

/**
 * Replay a macro into a pane (the active pane by default). Returns false if
 * there's no live PTY to run into or the macro has no steps.
 */
export function runMacro(
  macro: MacroItem,
  opts?: { paneId?: string; stepDelayMs?: number }
): boolean {
  const ws = useWorkspace.getState()
  const paneId = opts?.paneId ?? ws.activePaneId ?? ''
  const pty = ptyOf(paneId ? ws.panes[paneId] : undefined)
  if (!pty) {
    toast('No active pane to run the macro in', 'info')
    return false
  }
  const events = macroSchedule(macro.steps, opts?.stepDelayMs)
  if (!events.length) {
    toast(`Macro "${macro.name}" has no steps`, 'info')
    return false
  }
  for (const ev of events) window.setTimeout(() => window.api.writePty(pty, ev.data), ev.atMs)
  toast(`Running macro: ${macro.name}`, 'ok')
  return true
}
