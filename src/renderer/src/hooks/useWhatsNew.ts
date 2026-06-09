import { useEffect, useRef } from 'react'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { notesSince } from '@renderer/lib/whatsNew'

/**
 * On the first launch after an update, open the "What's new" tour for EVERY
 * version released since the user last looked — so updating 0.3.14 → 0.3.17
 * shows 0.3.15, 0.3.16 and 0.3.17 in one combined tour. A first-time install
 * (no `lastSeenVersion`) sees only the latest update's notes.
 *
 * Runs once, after settings load (so `lastSeenVersion` is available) and after
 * we read the real app version from the main process.
 */
export function useWhatsNew(): void {
  const settings = useSettings((s) => s.settings)
  const done = useRef(false)

  useEffect(() => {
    if (done.current || !settings) return
    done.current = true
    void (async () => {
      const { version } = await window.api.getAppInfo()
      const versions = notesSince(settings.prefs.lastSeenVersion, version).map((n) => n.version)
      if (versions.length) useUi.getState().setWhatsNewVersions(versions)
    })()
  }, [settings])
}
