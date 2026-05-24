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
  return (
    <TerminalPane
      paneId={pane.id}
      shell={pane.shell?.shell || undefined}
      cwd={cwd}
      onReady={(ptyId, shell) => updatePane(pane.id, { shell: { shell, ptyId, cwd } })}
    />
  )
}
