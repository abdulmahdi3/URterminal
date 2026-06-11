import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'

/**
 * Open panes requested by the local control server (#17). The server (main
 * process, 127.0.0.1) handles listing panes and sending input directly via the
 * PTY, but opening a pane needs the renderer since it owns the layout — so it
 * forwards an `onControlOpenPane` event that we turn into an addPane here.
 */
export function useControlServer(): void {
  useEffect(() => {
    return window.api.onControlOpenPane(({ type, command, shell, cwd }) => {
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
  }, [])
}
