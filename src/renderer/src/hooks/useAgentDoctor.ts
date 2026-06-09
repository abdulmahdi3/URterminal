import { useEffect, useRef } from 'react'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { refreshAgentAvailability } from '@renderer/lib/agents'

/**
 * First-run onboarding: the very first time the app runs, probe for installed
 * agent CLIs; if none are found, open the agent doctor so the user gets an
 * install checklist instead of an empty launcher. Shown at most once (tracked by
 * the `agentSetupSeen` pref) — afterwards it's only reachable from the palette.
 */
export function useAgentDoctor(): void {
  const settings = useSettings((s) => s.settings)
  const done = useRef(false)

  useEffect(() => {
    if (done.current || !settings) return
    if (settings.prefs.agentSetupSeen) {
      done.current = true
      return
    }
    done.current = true
    let cancelled = false
    void refreshAgentAvailability().then((avail) => {
      if (cancelled) return
      if (avail.size === 0) useUi.getState().setShowAgentDoctor(true)
      // Mark seen either way so we never auto-interrupt again.
      void useSettings.getState().patch({ prefs: { agentSetupSeen: true } })
    })
    return () => {
      cancelled = true
    }
  }, [settings])
}
