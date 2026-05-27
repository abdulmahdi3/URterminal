import { useSettings } from '@renderer/store/settings'
import { isTerminalStarted } from '@renderer/lib/terminalPool'

/**
 * Returns true if the pane may be closed. When "confirm before close" is on and
 * the pane's process has actually started (i.e. something is running), ask the
 * user first. Used by both the header close button and the close command.
 */
export function confirmPaneClose(paneId: string): boolean {
  const prefs = useSettings.getState().settings?.prefs
  if (!prefs?.confirmClose) return true
  if (!isTerminalStarted(paneId)) return true
  return window.confirm('This pane has a running process. Close it anyway?')
}
