import { useEffect } from 'react'
import { useOrChat } from '@renderer/store/orchat'

/**
 * App-level router: feeds OpenRouter stream events into the chat store, keyed by
 * paneId. Mounted once (like `useStreamData`) so a stream keeps accumulating even
 * if its pane unmounts during a zoom/drag rearrange.
 */
export function useOpenRouterStream(): void {
  useEffect(() => {
    const offDelta = window.api.openrouter.onDelta((e) =>
      useOrChat.getState().appendDelta(e.paneId, e.delta)
    )
    const offDone = window.api.openrouter.onDone((e) =>
      useOrChat.getState().endTurn(e.paneId, e.usage)
    )
    const offError = window.api.openrouter.onError((e) =>
      useOrChat.getState().failTurn(e.paneId, e.message)
    )
    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [])
}
