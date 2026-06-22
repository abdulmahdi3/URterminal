import { useEffect } from 'react'
import { useWorkspace } from '../store/workspace'
import { getAutoCrew } from '../lib/uregantAutoCrew'

/**
 * Mounts once at app root. When the "auto-connect" preference is on, any `claude`
 * pane opened in a folder gets the Uregant MCP bridge + crew wired automatically
 * (once per folder). Opt-in; no-op when off.
 */
export function useUregantAutoCrew(): void {
  useEffect(() => {
    const connected = new Set<string>()
    const maybeConnect = (panes: Record<string, { type: string; agent?: { command?: string; cwd?: string } }>): void => {
      if (!getAutoCrew()) return
      for (const p of Object.values(panes)) {
        if (p.type !== 'ai' || p.agent?.command !== 'claude') continue
        const cwd = p.agent?.cwd
        if (!cwd || connected.has(cwd)) continue
        connected.add(cwd)
        void window.api.uregant.connectCrew(cwd)
      }
    }
    maybeConnect(useWorkspace.getState().panes)
    const unsub = useWorkspace.subscribe((s) => maybeConnect(s.panes))
    return unsub
  }, [])
}
