import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import TerminalPane from './TerminalPane'

export default function ShellPane({ pane }: { pane: Pane }): JSX.Element {
  const updatePane = useWorkspace((s) => s.updatePane)
  return (
    <TerminalPane
      paneId={pane.id}
      onReady={(ptyId, shell) => updatePane(pane.id, { shell: { shell, ptyId } })}
    />
  )
}
