import { useEffect } from 'react'
import { useStreams } from '@renderer/store/streams'

/**
 * App-level router: feed every pty:data/pty:exit into the stream store. It's a
 * no-op for panes that didn't start a stream turn (appendData/endTurn ignore
 * unknown panes), so this safely coexists with xterm panes — and it lives above
 * the pane components so a stream keeps accumulating even if its pane unmounts
 * (zoom / drag-rearrange) mid-turn.
 */
export function useStreamData(): void {
  useEffect(() => {
    const offData = window.api.onPtyData((e) => useStreams.getState().appendData(e.paneId, e.data))
    const offExit = window.api.onPtyExit((e) => useStreams.getState().endTurn(e.paneId))
    return () => {
      offData()
      offExit()
    }
  }, [])
}
