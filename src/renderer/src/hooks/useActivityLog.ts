import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { useActivity } from '@renderer/store/activity'
import { onPaneTurnComplete } from '@renderer/store/paneStatus'
import { getFullText, onTerminalInput } from '@renderer/lib/terminalPool'
import { answerBlocks } from './useChainForwarding'

// Strip arrow keys / bracketed-paste escapes from raw keystrokes.
const INPUT_ESC = new RegExp('\\u001B\\[[0-9;]*[~A-Za-z]|\\u001B[O][A-Za-z]?', 'g')

/**
 * Records a timeline of submitted prompts and agent answer blocks per AI pane
 * (reusing the answer-block detector), for later Markdown export.
 */
export function useActivityLog(): void {
  useEffect(() => {
    const bufs = new Map<string, string>()
    const lastAnswer = new Map<string, string>()
    const isAi = (id: string): boolean => useWorkspace.getState().panes[id]?.type === 'ai'
    const titleOf = (id: string): string => {
      const p = useWorkspace.getState().panes[id]
      return p?.title || p?.agent?.command || id.slice(0, 6)
    }

    const offInput = onTerminalInput((paneId, data) => {
      if (!isAi(paneId)) return
      let buf = bufs.get(paneId) ?? ''
      for (const ch of data.replace(INPUT_ESC, '')) {
        const code = ch.charCodeAt(0)
        if (code === 13 || code === 10) {
          const prompt = buf.trim()
          buf = ''
          if (prompt) useActivity.getState().add({ ts: Date.now(), paneId, paneTitle: titleOf(paneId), role: 'prompt', text: prompt })
        } else if (code === 127 || code === 8) {
          buf = buf.slice(0, -1)
        } else if (code >= 32) {
          buf += ch
        }
      }
      bufs.set(paneId, buf)
    })

    const offTurn = onPaneTurnComplete((paneId) => {
      if (!isAi(paneId)) return
      const blocks = answerBlocks(getFullText(paneId))
      const last = blocks[blocks.length - 1]?.trim()
      if (!last || last === lastAnswer.get(paneId)) return
      lastAnswer.set(paneId, last)
      useActivity.getState().add({ ts: Date.now(), paneId, paneTitle: titleOf(paneId), role: 'answer', text: last })
    })

    return () => {
      offInput()
      offTurn()
    }
  }, [])
}
