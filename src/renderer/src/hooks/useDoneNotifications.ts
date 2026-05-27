import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { useSettings } from '@renderer/store/settings'
import { onPaneTurnComplete } from '@renderer/store/paneStatus'

function showDesktopNotification(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') {
      new Notification(title, { body })
    } else if (Notification.permission !== 'denied') {
      void Notification.requestPermission().then((p) => {
        if (p === 'granted') new Notification(title, { body })
      })
    }
  } catch {
    /* notifications unavailable — ignore */
  }
}

/**
 * Notification sound via WebAudio (no bundled asset). `volume` is 0–100; `name`
 * selects the timbre ('chime' = two-tone sine, 'beep' = single square blip).
 */
function playDoneSound(volume: number, name: 'chime' | 'beep'): void {
  const peak = Math.max(0, Math.min(1, volume / 100)) * 0.3
  if (peak <= 0) return
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const now = ctx.currentTime
    const beep = (freq: number, at: number, type: OscillatorType): void => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g)
      g.connect(ctx.destination)
      o.type = type
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, now + at)
      g.gain.exponentialRampToValueAtTime(peak, now + at + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.18)
      o.start(now + at)
      o.stop(now + at + 0.2)
    }
    if (name === 'beep') {
      beep(880, 0, 'square')
    } else {
      beep(660, 0, 'sine')
      beep(880, 0.14, 'sine')
    }
    window.setTimeout(() => void ctx.close(), 500)
  } catch {
    /* audio unavailable — ignore */
  }
}

/**
 * Desktop + sound notification when an agent finishes a turn. Driven by the
 * shared turn-complete event (which already skips the boot/banner turn) and
 * gated by the user's prefs.
 */
export function useDoneNotifications(): void {
  useEffect(
    () =>
      onPaneTurnComplete((paneId) => {
        const prefs = useSettings.getState().settings?.prefs
        if (!prefs || (!prefs.notifyOnDone && !prefs.notifySound)) return
        // "only when unfocused" suppresses both alerts while the app has focus.
        if (prefs.notifyOnlyUnfocused && document.hasFocus()) return
        const pane = useWorkspace.getState().panes[paneId]
        if (!pane || pane.type !== 'ai') return
        const name = pane.title || pane.agent?.command || 'Agent'
        if (prefs.notifyOnDone) showDesktopNotification(`${name} finished`, 'The agent is idle and ready.')
        if (prefs.notifySound) playDoneSound(prefs.notifyVolume ?? 60, prefs.notifySoundName ?? 'chime')
      }),
    []
  )
}
