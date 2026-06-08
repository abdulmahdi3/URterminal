import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { isTerminalStarted } from '@renderer/lib/terminalPool'
import TerminalPane from './TerminalPane'

function getHome(): string | undefined {
  try {
    // process.env is available in Electron renderer with sandbox:false
    return (process as NodeJS.Process).env.HOME ?? (process as NodeJS.Process).env.USERPROFILE
  } catch {
    return undefined
  }
}

export default function ShellPane({ pane }: { pane: Pane }): JSX.Element {
  const updatePane = useWorkspace((s) => s.updatePane)
  const removePane = useWorkspace((s) => s.removePane)
  const cwd = pane.shell?.cwd ?? getHome()
  const args = pane.shell?.args
  const ssh = pane.shell?.ssh

  // Show a loader until the session/shell prints its first output — SSH panes
  // read "Connecting…", local shells (incl. WSL distros like Kali) "Starting…".
  // Re-mounts after zoom report started=true immediately (no flash).
  const [started, setStarted] = useState(() => isTerminalStarted(pane.id))
  const booting = !started

  // Safety net: a silent shell shouldn't leave the loader spinning forever.
  // SSH can legitimately take a while to connect, so only auto-clear local shells.
  useEffect(() => {
    if (started || ssh) return
    const t = window.setTimeout(() => setStarted(true), 8000)
    return () => window.clearTimeout(t)
  }, [started, ssh])

  return (
    <div className="agent-pane">
      {booting && (
        <div className="agent-booting">
          <Loader2 size={26} className="spin" />
          <div className="booting-text">
            {ssh ? (
              <>
                Connecting to <b>{ssh.target}</b>…
              </>
            ) : (
              <>
                Starting <b>{pane.title || pane.shell?.shell || 'shell'}</b>…
              </>
            )}
          </div>
        </div>
      )}
      <TerminalPane
        paneId={pane.id}
        shell={pane.shell?.shell || undefined}
        shellArgs={args}
        cwd={cwd}
        startupCommand={pane.shell?.startupCommand}
        ssh={ssh}
        // An SSH pane closes itself when the session ends (disconnect / `exit`).
        onExit={ssh ? () => removePane(pane.id) : undefined}
        onStarted={() => setStarted(true)}
        onReady={(ptyId, resolved) =>
          // Keep an explicit binary (e.g. "wsl.exe") or the SSH marker as-is; only
          // adopt the resolved name when the pane launched the blank OS-default shell.
          updatePane(pane.id, {
            shell: { ...pane.shell, shell: pane.shell?.shell || (ssh ? '' : resolved), args, ptyId, cwd }
          })
        }
      />
    </div>
  )
}
