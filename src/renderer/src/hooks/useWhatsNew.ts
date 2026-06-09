import { useEffect, useRef } from 'react'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { latestNotes } from '@renderer/lib/whatsNew'

/**
 * On the first launch after an update, open the "What's new" tour for the
 * newest authored release notes the user hasn't acknowledged yet. Runs once,
 * after settings have loaded so we can read the persisted `lastSeenVersion`
 * (which stores the notes version last dismissed, NOT the raw app version — this
 * keeps the trigger robust even if a build ships without its own notes entry).
 *
 *   • newest notes ≠ last acknowledged → open the tour (records it on dismiss)
 *   • newest notes already seen        → do nothing
 *   • no notes authored at all          → do nothing
 */
export function useWhatsNew(): void {
  const settings = useSettings((s) => s.settings)
  const done = useRef(false)

  useEffect(() => {
    if (done.current || !settings) return
    done.current = true
    const latest = latestNotes()
    if (!latest) return
    if (latest.version === settings.prefs.lastSeenVersion) return
    useUi.getState().setWhatsNewVersion(latest.version)
  }, [settings])
}
