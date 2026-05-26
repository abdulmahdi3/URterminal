import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { useBroadcastStore } from '@renderer/store/broadcast'
import { getInputLine, clearInputLine } from '@renderer/lib/terminalPool'
import { toast } from '@renderer/store/toasts'

const ESC = String.fromCharCode(27)
const bracketPaste = (s: string): string => `${ESC}[200~${s}${ESC}[201~`

function ptyOf(paneId: string): string | undefined {
  const pane = useWorkspace.getState().panes[paneId]
  return pane?.type === 'ai' ? pane.agent?.ptyId : pane?.shell?.ptyId
}

/**
 * Send the active pane's currently-typed line to every broadcast member at once:
 * the active pane submits its own line, each member gets the same text pasted and
 * submitted. Returns the number of panes the text reached (0 = nothing happened).
 */
export function broadcastActiveLine(): number {
  const ws = useWorkspace.getState()
  const activeId = ws.activePaneId
  if (!activeId) return 0
  const line = getInputLine(activeId).trim()
  if (!line) {
    toast('Type a prompt in the active pane first', 'info')
    return 0
  }
  const members = useBroadcastStore.getState().members.filter((id) => id !== activeId && ws.panes[id])

  // Submit the active pane's own typed line.
  const activePty = ptyOf(activeId)
  if (activePty) window.api.writePty(activePty, '\r')
  clearInputLine(activeId)

  // Paste + submit the same line into every member pane.
  let reached = activePty ? 1 : 0
  for (const id of members) {
    const pty = ptyOf(id)
    if (!pty) continue
    window.api.writePty(pty, bracketPaste(line))
    window.setTimeout(() => window.api.writePty(pty, '\r'), 150)
    clearInputLine(id)
    reached += 1
  }
  toast(`Broadcast to ${reached} pane${reached !== 1 ? 's' : ''}`, 'ok')
  return reached
}

/**
 * While broadcast mode is armed, Ctrl+Enter fans the active pane's typed line
 * out to all members. Uses a capture-phase listener so xterm never sees the
 * keystroke (no stray newline inserted into the active terminal).
 */
export function useBroadcast(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!useBroadcastStore.getState().enabled) return
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter' || e.shiftKey) return
      e.preventDefault()
      e.stopPropagation()
      broadcastActiveLine()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
