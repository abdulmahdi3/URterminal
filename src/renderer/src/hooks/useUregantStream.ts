import { useEffect } from 'react'
import { useUregant } from '../store/uregant'

/**
 * Mounts ONCE at app root (App.tsx), like useOpenRouterStream. Routes Uregant's
 * main->renderer stream events into the loop store, keyed by paneId. Each
 * subscription returns an unsubscribe that runs on cleanup.
 */
export function useUregantStream(): void {
  useEffect(() => {
    const offDelta = window.api.uregant.onDelta((e) => useUregant.getState()._delta(e.paneId, e.delta))
    const offDone = window.api.uregant.onDone((e) => useUregant.getState()._done(e.paneId, e.result))
    const offError = window.api.uregant.onError((e) => useUregant.getState()._error(e.paneId, e.message))
    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [])
}
