import { useWorkspace } from '@renderer/store/workspace'
import { getInputLine, clearInputLine } from '@renderer/lib/terminalPool'
import { toast } from '@renderer/store/toasts'

const ESC = String.fromCharCode(27)
const DEL = String.fromCharCode(127) // backspace/delete keystroke
const bracketPaste = (s: string): string => `${ESC}[200~${s}${ESC}[201~`

/**
 * "AI prompt enhancer depend on memory": take what the user has typed (but not
 * yet sent) in an agent pane, rewrite it via the learning model using the brain
 * memory as context, then replace the typed text with the improved version for
 * the user to review and send. Does NOT auto-submit.
 */
export async function enhancePromptFor(paneId: string): Promise<void> {
  const pane = useWorkspace.getState().panes[paneId]
  if (!pane || pane.type !== 'ai') {
    toast('Focus an agent pane first', 'info')
    return
  }
  const ptyId = pane.agent?.ptyId
  if (!ptyId) {
    toast('Agent is not ready yet', 'info')
    return
  }
  const raw = getInputLine(paneId).trim()
  if (!raw) {
    toast('Type a prompt in the agent, then enhance it', 'info')
    return
  }

  toast('Enhancing prompt with memory…', 'info')
  let enhanced: string
  try {
    enhanced = (await window.api.learning.enhance(raw, pane.agent?.cwd)).trim()
  } catch (e) {
    toast(`Enhance failed: ${(e as Error).message}`, 'error')
    return
  }
  if (!enhanced) {
    toast('Enhancer returned nothing', 'error')
    return
  }

  // Delete whatever is currently typed (backspaces over the reconstructed line),
  // then paste the rewrite. The user reviews it and presses Enter to send.
  const current = getInputLine(paneId)
  if (current.length) window.api.writePty(ptyId, DEL.repeat(current.length))
  clearInputLine(paneId)
  window.api.writePty(ptyId, bracketPaste(enhanced))
  toast('Prompt enhanced — review and press Enter', 'ok')
}

/** Enhance the prompt in the currently active agent pane. */
export function enhanceActivePrompt(): void {
  const id = useWorkspace.getState().activePaneId
  if (!id) {
    toast('Focus an agent pane first', 'info')
    return
  }
  void enhancePromptFor(id)
}
