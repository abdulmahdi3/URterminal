import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { onPaneTurnComplete } from '@renderer/store/paneStatus'
import { useNotifications } from '@renderer/store/notifications'
import { useUpdater } from '@renderer/store/updater'

/**
 * Funnels the app's scattered signals into the unified notification center:
 *  • an agent finishing a turn (the same event that drives desktop alerts),
 *  • a new version becoming available / ready to install.
 * It's additive — anywhere else can call `useNotifications.getState().push(...)`.
 */
export function useNotificationFeed(): void {
  // Agent turn-complete → one "finished" entry per agent pane.
  useEffect(
    () =>
      onPaneTurnComplete((paneId) => {
        const pane = useWorkspace.getState().panes[paneId]
        if (!pane || pane.type !== 'ai') return
        const name = pane.title || pane.agent?.command || 'Agent'
        useNotifications.getState().push({ kind: 'agent', title: `${name} finished`, body: 'Idle and ready.' })
      }),
    []
  )

  // Update available / ready → one entry per version (deduped by version).
  useEffect(() => {
    let lastVersion = ''
    return useUpdater.subscribe((s) => {
      if ((s.phase === 'downloading' || s.phase === 'ready') && s.version && s.version !== lastVersion) {
        lastVersion = s.version
        useNotifications.getState().push({
          kind: 'update',
          title: `Update ${s.version} available`,
          body: s.phase === 'ready' ? 'Ready to install.' : 'Downloading…'
        })
      }
    })
  }, [])
}
