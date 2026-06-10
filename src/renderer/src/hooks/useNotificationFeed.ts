import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { onPaneTurnComplete } from '@renderer/store/paneStatus'
import { useNotifications } from '@renderer/store/notifications'
import { useUpdater } from '@renderer/store/updater'
import { useSettings } from '@renderer/store/settings'

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
        // Mirror to Discord/Slack if a webhook is configured.
        const prefs = useSettings.getState().settings?.prefs
        const msg = `✅ ${name} finished a turn${pane.agent?.cwd ? ` in ${pane.agent.cwd}` : ''}.`
        if (prefs?.discordWebhook) window.api.postWebhook(prefs.discordWebhook, msg)
        if (prefs?.slackWebhook) window.api.postWebhook(prefs.slackWebhook, msg)
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
