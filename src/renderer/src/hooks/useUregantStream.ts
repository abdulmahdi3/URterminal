import { useEffect } from 'react'
import { useUregant } from '../store/uregant'
import { useUregantPulls } from '../store/uregantPulls'
import { executeTool } from '../lib/uregantTools'
import { maybeSpeakState } from '../lib/voice'

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
    const offState = window.api.uregant.onState((e) => {
      useUregant.getState()._state(e)
      maybeSpeakState(e)
    })
    const offExec = window.api.uregant.onExecTool(async (e) => {
      const result = await executeTool({ function: { name: e.name, arguments: e.args } })
      window.api.uregant.toolResult(e.callId, result)
    })
    const offPull = window.api.uregant.onPullProgress((e) => useUregantPulls.getState()._progress(e))
    return () => {
      offDelta()
      offState()
      offExec()
      offPull()
    }
  }, [])
}
