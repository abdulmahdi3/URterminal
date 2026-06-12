import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'

/**
 * React to the local control server / web dashboard (#17, #25). The server (main
 * process, 127.0.0.1) lists panes and sends input straight through the PTY, but
 * anything that touches the layout — open/close a pane, switch workspace — needs
 * the renderer since it owns that state. We turn the forwarded events into the
 * matching store actions here.
 */
export function useControlServer(): void {
  useEffect(() => {
    const offOpen = window.api.onControlOpenPane(({ type, command, shell, cwd }) => {
      const ws = useWorkspace.getState()
      if (type === 'shell') {
        const id = ws.addPane('shell', undefined, { shell })
        if (id) ws.updatePane(id, { shell: { shell: shell || '', cwd } })
      } else {
        const cmd = command || 'claude'
        const id = ws.addPane('ai', undefined, { agentCommand: cmd })
        if (!id) return
        // preserve the pinned sessionId addPane just created — only add the folder
        const agent = useWorkspace.getState().panes[id]?.agent
        ws.updatePane(id, { agent: { ...agent, command: cmd, cwd }, title: cmd })
      }
    })
    const offClose = window.api.onControlClosePane((paneId) => {
      if (useWorkspace.getState().panes[paneId]) useWorkspace.getState().removePane(paneId)
    })
    const offSwitch = window.api.onControlSwitchWorkspace((id) => {
      useWorkspaces.getState().switchTo(id)
    })
    return () => {
      offOpen()
      offClose()
      offSwitch()
    }
  }, [])
}
