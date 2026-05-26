import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
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
  const cwd = pane.shell?.cwd ?? getHome()
  const args = pane.shell?.args
  return (
    <TerminalPane
      paneId={pane.id}
      shell={pane.shell?.shell || undefined}
      shellArgs={args}
      cwd={cwd}
      startupCommand={pane.shell?.startupCommand}
      onReady={(ptyId, resolved) =>
        // Keep an explicit binary (e.g. "wsl.exe") as-is; only adopt the resolved
        // name when the pane launched the blank OS-default shell.
        updatePane(pane.id, {
          shell: { shell: pane.shell?.shell || resolved, args, ptyId, cwd }
        })
      }
    />
  )
}
