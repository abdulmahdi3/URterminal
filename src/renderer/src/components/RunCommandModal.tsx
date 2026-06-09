import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, TerminalSquare } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toasts'

const ESC = String.fromCharCode(27)
const bracketPaste = (s: string): string => `${ESC}[200~${s}${ESC}[201~`

/**
 * Run one command across every shell pane in the current workspace at once —
 * e.g. `git pull` or `npm test` in a row of repos. Each shell gets the command
 * pasted + submitted. Agent panes are skipped (the command would land in their
 * prompt, not a shell).
 */
export default function RunCommandModal(): JSX.Element | null {
  const show = useUi((s) => s.showRunCommand)
  const setShow = useUi((s) => s.setShowRunCommand)
  const panes = useWorkspace((s) => s.panes)
  const [cmd, setCmd] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const shells = useMemo(
    () => Object.values(panes).filter((p) => p.type === 'shell' && p.shell?.ptyId),
    [panes]
  )

  useEffect(() => {
    if (show) {
      setCmd('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [show])

  if (!show) return null

  const run = (): void => {
    const line = cmd.trim()
    if (!line) return
    if (!shells.length) {
      toast('No shell panes in this workspace', 'info')
      setShow(false)
      return
    }
    for (const p of shells) {
      const pty = p.shell!.ptyId!
      window.api.writePty(pty, bracketPaste(line))
      window.setTimeout(() => window.api.writePty(pty, '\r'), 150)
    }
    toast(`Ran in ${shells.length} shell${shells.length === 1 ? '' : 's'}`, 'ok')
    setShow(false)
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal runcmd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="runcmd-title">
            <TerminalSquare size={16} />
            <span>Run in all shells</span>
            <span className="runcmd-count">
              {shells.length} shell{shells.length === 1 ? '' : 's'}
            </span>
          </div>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>
        <div className="modal-body runcmd-body">
          <input
            ref={inputRef}
            className="input mono runcmd-input"
            placeholder="e.g. git pull  ·  npm test"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                run()
              }
            }}
          />
          <div className="runcmd-actions">
            <button className="btn" onClick={() => setShow(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={run} disabled={!cmd.trim() || !shells.length}>
              <Play size={13} /> Run
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
