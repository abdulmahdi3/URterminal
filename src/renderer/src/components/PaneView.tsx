import { useWorkspace } from '@renderer/store/workspace'
import EmptyPane from './EmptyPane'
import AiPane from './AiPane'
import ShellPane from './ShellPane'

export default function PaneView({ paneId }: { paneId: string }): JSX.Element {
  const pane = useWorkspace((s) => s.panes[paneId])
  const setActive = useWorkspace((s) => s.setActive)
  const activePaneId = useWorkspace((s) => s.activePaneId)

  if (!pane) return <div className="pane-placeholder">—</div>

  return (
    <div
      className={'pane-body' + (activePaneId === paneId ? ' active' : '')}
      onMouseDown={() => setActive(paneId)}
    >
      {pane.type === 'empty' && <EmptyPane paneId={paneId} />}
      {pane.type === 'ai' && <AiPane pane={pane} />}
      {pane.type === 'shell' && <ShellPane pane={pane} />}
    </div>
  )
}
