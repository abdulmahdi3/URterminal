import { useEffect, useState } from 'react'
import type { GitStatus } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'

/** The active pane's working directory (agent cwd or shell cwd), if any. */
function useActiveCwd(): string | undefined {
  const activeId = useWorkspace((s) => s.activePaneId)
  const pane = useWorkspace((s) => (activeId ? s.panes[activeId] : undefined))
  if (!pane) return undefined
  return pane.type === 'ai' ? pane.agent?.cwd : pane.shell?.cwd
}

/**
 * Polls git status for the active pane's folder so the status bar can show its
 * branch + dirty state. Polls every 5s while a cwd is focused, re-fetching
 * immediately when the focused folder changes. Non-git folders resolve to null.
 */
export function useGitStatus(): GitStatus | null {
  const cwd = useActiveCwd()
  const [status, setStatus] = useState<GitStatus | null>(null)

  useEffect(() => {
    if (!cwd) {
      setStatus(null)
      return
    }
    let stop = false
    const poll = (): void => {
      void window.api
        .gitStatus(cwd)
        .then((g) => {
          if (!stop) setStatus(g)
        })
        .catch(() => {})
    }
    poll()
    const id = window.setInterval(poll, 5000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [cwd])

  return status
}
