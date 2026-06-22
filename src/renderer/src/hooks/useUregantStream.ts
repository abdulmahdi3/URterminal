import { useEffect } from 'react'
import { useUregant } from '../store/uregant'
import { executeTool } from '../lib/uregantTools'

/**
 * Mounts ONCE at app root (App.tsx). Routes the main-process loop's events:
 *  - uregant:delta  -> append live assistant text
 *  - uregant:state  -> mirror the authoritative run snapshot
 *  - uregant:exec-tool -> execute a pane tool (useWorkspace/terminalPool) and
 *    reply with the result (this is how the main controller drives panes).
 * Each subscription returns an unsubscribe that runs on cleanup.
 */
export function useUregantStream(): void {
  useEffect(() => {
    const offDelta = window.api.uregant.onDelta((e) => useUregant.getState()._delta(e.paneId, e.delta))
    const offState = window.api.uregant.onState((e) => useUregant.getState()._state(e))
    const offExec = window.api.uregant.onExecTool(async (e) => {
      const result = await executeTool({ function: { name: e.name, arguments: e.args } })
      window.api.uregant.toolResult(e.callId, result)
    })
    return () => {
      offDelta()
      offState()
      offExec()
    }
  }, [])
}
