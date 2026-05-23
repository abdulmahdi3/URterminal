import { useEffect } from 'react'
import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { getLeaves } from '@renderer/lib/mosaicTree'
import { getScreenText, onTerminalInput } from '@renderer/lib/terminalPool'

// How long the source pane must be quiet before the result is "done". The
// agent's spinner emits frames while processing, so output only goes idle once
// it has finished and rendered its answer.
const IDLE_MS = 1500

interface SrcState {
  armed: boolean
  timer: number
  lastSent: string
  /** answer blocks already on screen when the turn started (to skip old ones) */
  baseBlocks: Set<string>
}

function ptyOf(pane: Pane | undefined): string | undefined {
  return pane?.agent?.ptyId || pane?.shell?.ptyId
}

/**
 * Extract claude's answer blocks from a screen capture. Claude marks each
 * assistant reply with a leading "●"; continuation lines are indented. Echoed
 * prompts ("❯ …"), status ("✻ …"), the welcome/input boxes (│ ╭ ╰) and rules
 * (────) are NOT answers and are skipped.
 */
function answerBlocks(text: string): string[] {
  const blocks: string[] = []
  let cur: string[] | null = null
  const isBoundary = (t: string): boolean =>
    /^[❯✻⏵╭╮╰╯│]/.test(t) || (t.length > 0 && /^[─-╿\s]+$/.test(t))
  const flush = (): void => {
    if (cur) {
      const b = cur.join('\n').replace(/\s+$/, '').trim()
      if (b) blocks.push(b)
      cur = null
    }
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const t = line.trim()
    if (/^●/.test(t)) {
      flush()
      cur = [t.replace(/^●\s?/, '')]
    } else if (cur) {
      if (isBoundary(t)) flush()
      else cur.push(line.replace(/^ {1,2}/, '')) // drop claude's 2-space render indent
    }
  }
  flush()
  return blocks
}

/**
 * Chain piping: when a pane's chain arrow is active, ONLY claude's answer (its
 * "●" reply blocks for the just-finished turn) is pasted into the next pane.
 * The processing stream, banner, echoed prompt, status and input box are never
 * forwarded. Chains A→B→C.
 */
export function useChainForwarding(): void {
  useEffect(() => {
    const state = new Map<string, SrcState>()
    const get = (id: string): SrcState => {
      let s = state.get(id)
      if (!s) {
        s = { armed: false, timer: 0, lastSent: '', baseBlocks: new Set() }
        state.set(id, s)
      }
      return s
    }
    const arm = (id: string): void => {
      const s = get(id)
      if (!s.armed) {
        s.armed = true
        s.baseBlocks = new Set(answerBlocks(getScreenText(id)))
      }
    }

    const nextTarget = (sourceId: string): Pane | null => {
      const ws = useWorkspace.getState()
      const leaves = getLeaves(ws.layout)
      const idx = leaves.indexOf(sourceId)
      if (idx < 0 || idx >= leaves.length - 1) return null
      return ws.panes[leaves[idx + 1]] ?? null
    }

    const flush = (sourceId: string): void => {
      const st = get(sourceId)
      st.armed = false
      const target = nextTarget(sourceId)
      const targetPty = ptyOf(target ?? undefined)
      if (!target || !targetPty) return
      // only the answer blocks that are new this turn
      const fresh = answerBlocks(getScreenText(sourceId)).filter((b) => !st.baseBlocks.has(b))
      const result = fresh.join('\n\n').trim()
      if (!result || result === st.lastSent) return
      st.lastSent = result
      if (target.pipeForward) arm(target.id)
      // Paste the result, then submit with a discrete Enter shortly after — a \r
      // in the same chunk as the paste gets swallowed into the pasted text and
      // doesn't register as "submit".
      window.api.writePty(targetPty, `\x1b[200~${result}\x1b[201~`)
      window.setTimeout(() => window.api.writePty(targetPty, '\r'), 150)
    }

    const offInput = onTerminalInput((paneId) => {
      if (useWorkspace.getState().panes[paneId]?.pipeForward) arm(paneId)
    })

    const offData = window.api.onPtyData((e) => {
      if (!useWorkspace.getState().panes[e.paneId]?.pipeForward) return
      const st = get(e.paneId)
      if (!st.armed) return
      window.clearTimeout(st.timer)
      st.timer = window.setTimeout(() => flush(e.paneId), IDLE_MS)
    })

    return () => {
      offInput()
      offData()
      state.forEach((s) => window.clearTimeout(s.timer))
    }
  }, [])
}
