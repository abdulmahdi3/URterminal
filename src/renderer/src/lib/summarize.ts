import { useWorkspace } from '@renderer/store/workspace'
import { getPromptHistory, getInputLine, setInputLine } from '@renderer/lib/terminalPool'
import { toast } from '@renderer/store/toasts'
import { flashCopied } from '@renderer/store/copied'

const DEL = String.fromCharCode(127) // backspace keystroke

/** Collapse whitespace; trim a single prompt to keep the recap readable. */
function clean(p: string, max = 240): string {
  const t = p.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t
}

/**
 * The prompts the user actually submitted in a pane this session, cleaned and
 * de-duplicated. Comes from real keystroke history (not the scrolled buffer), so
 * it's free of the agent's tool-call noise and any pasted-back summaries.
 */
function sessionPrompts(paneId: string): string[] {
  const raw = getPromptHistory(paneId).map((p) => clean(p)).filter(Boolean)
  // Drop consecutive duplicates and obvious slash-only commands.
  const out: string[] = []
  for (const p of raw) {
    if (p === out[out.length - 1]) continue
    out.push(p)
  }
  return out
}

/** A one-line recap of the session's prompts, suitable to type into a prompt. */
export function buildSessionRecap(paneId: string): string | null {
  const prompts = sessionPrompts(paneId)
  if (!prompts.length) return null
  const list = prompts.map((p, i) => `(${i + 1}) ${p}`).join('  ')
  return `Recap of what I've asked so far this session: ${list}`
}

/**
 * Summarize the active pane's session and insert the recap straight into its
 * input line — typed as plain text (NOT a bracketed paste), so agents like
 * Claude show it in full for review instead of collapsing it to a
 * "[Pasted text +N lines]" placeholder. Falls back to the clipboard when the
 * pane has no live process to type into.
 */
export function summarizeActiveSession(): void {
  const ws = useWorkspace.getState()
  const id = ws.activePaneId
  if (!id) {
    toast('Focus a pane first', 'info')
    return
  }
  const recap = buildSessionRecap(id)
  if (!recap) {
    toast('No prompts to summarize yet', 'info')
    return
  }
  const pane = ws.panes[id]
  const ptyId = pane?.agent?.ptyId || pane?.shell?.ptyId
  if (!ptyId) {
    void navigator.clipboard
      .writeText(recap)
      .then(() => {
        flashCopied()
        toast('Session recap copied', 'ok')
      })
      .catch(() => toast('Could not copy recap', 'error'))
    return
  }
  // Single line (no newlines) typed directly — no paste placeholder, and it
  // won't submit until the user reviews and presses Enter.
  const typed = recap.replace(/\s*\r?\n\s*/g, ' ').trim()
  const current = getInputLine(id)
  if (current.length) window.api.writePty(ptyId, DEL.repeat(current.length))
  window.api.writePty(ptyId, typed)
  setInputLine(id, typed)
  toast('Session recap inserted — review and press Enter', 'ok')
}
