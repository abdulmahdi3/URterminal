import { useState } from 'react'
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

  // For SSH panes, show a "Connecting…" loader until the session prints its first
  // output. Re-mounts after zoom report started=true immediately (no flash).
  const [started, setStarted] = useState(() => isTerminalStarted(pane.id))
  const connecting = !!ssh && !started

  return (
    <div className="agent-pane">
      {connecting && (
        <div className="agent-booting">
          <Loader2 size={26} className="spin" />
          <div className="booting-text">
            Connecting to <b>{ssh!.target}</b>…
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
