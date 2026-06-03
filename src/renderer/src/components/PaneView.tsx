import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { usePaneStatus } from '@renderer/store/paneStatus'
import EmptyPane from './EmptyPane'
import AiPane from './AiPane'
import ShellPane from './ShellPane'

export default function PaneView({ paneId }: { paneId: string }): JSX.Element {
  const pane = useWorkspace((s) => s.panes[paneId])
  const setActive = useWorkspace((s) => s.setActive)
  const activePaneId = useWorkspace((s) => s.activePaneId)
  const entering = useWorkspace((s) => !!s.entering[paneId])
  const closing = useWorkspace((s) => !!s.closing[paneId])
  // "Agent finished" glow: set when this pane's turn completes while unfocused.
  const done = usePaneStatus((s) => !!s.done[paneId])
  const clearDone = usePaneStatus((s) => s.clearDone)

  if (!pane) return <div className="pane-placeholder">—</div>

  const focus = (): void => {
    setActive(paneId)
    if (done) clearDone(paneId) // looking at the pane acknowledges it
  }

  return (
    <div
      className={clsx(
        'pane-body',
        activePaneId === paneId && 'active',
        done && 'pane-done',
        entering && 'pane-entering',
        closing && 'pane-exiting'
      )}
      data-pane-id={paneId}
      onMouseDown={focus}
    >
      {pane.type === 'empty' && <EmptyPane paneId={paneId} />}
      {pane.type === 'ai' && <AiPane pane={pane} />}
      {pane.type === 'shell' && <ShellPane pane={pane} />}
    </div>
  )
}
