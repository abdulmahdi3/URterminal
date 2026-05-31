import { useWorkspace } from '@renderer/store/workspace'
import { isTerminalStarted } from '@renderer/lib/terminalPool'
import { toast } from '@renderer/store/toasts'
import type { TodoItem } from '@shared/types'

const ESC = String.fromCharCode(27)
const bracketPaste = (s: string): string => `${ESC}[200~${s}${ESC}[201~`

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** Add the selected text as a to-do on its source pane (shown in the Notes modal). */
export function createTaskFromSelection(paneId: string, text: string): void {
  const ws = useWorkspace.getState()
  const pane = ws.panes[paneId]
  if (!pane) {
    toast('Could not find the pane for this selection', 'error')
    return
  }
  const item: TodoItem = { id: uid(), text: text.trim(), done: false }
  ws.updatePane(paneId, { todos: [...(pane.todos ?? []), item] })
  toast('Added to pane to-dos', 'ok')
}

/**
 * Open a NEW agent pane running the same agent CLI (and folder) as the source
 * pane, then paste the given text into it as a prompt for the user to review.
 * Used by both "move selection to new agent" and the enhancer's "open in new pane".
 */
export function openTextInNewAgentPane(sourcePaneId: string, text: string): void {
  const ws = useWorkspace.getState()
  const src = ws.panes[sourcePaneId]
  const command = src?.agent?.command ?? ws.defaultAgent
  const cwd = src?.agent?.cwd
  const newId = ws.addPane('ai', 'column', { agentCommand: command, agentCwd: cwd })
  if (!newId) {
    toast('Too many panes — close one first', 'info')
    return
  }

  const payload = text.trim()
  // Wait for the new agent to boot (first output), give its input box a moment
  // to render, then paste the text. We do NOT auto-submit — the user reviews it.
  let bootTries = 0
  let pasteTries = 0
  const paste = (): void => {
    const pty = useWorkspace.getState().panes[newId]?.agent?.ptyId
    if (pty) {
      window.api.writePty(pty, bracketPaste(payload))
      toast('Sent to a new agent pane — review and press Enter', 'ok')
      return
    }
    if (pasteTries++ < 100) window.setTimeout(paste, 200)
  }
  const waitBoot = (): void => {
    if (isTerminalStarted(newId)) {
      window.setTimeout(paste, 1200)
      return
    }
    if (bootTries++ < 100) window.setTimeout(waitBoot, 200)
  }
  window.setTimeout(waitBoot, 400)
}
