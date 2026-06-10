import { useEffect, useRef, useState } from 'react'
import { AtSign, Loader2, CornerDownLeft } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { pasteText, focusTerminal } from '@renderer/lib/terminalPool'
import { toast } from '@renderer/store/toasts'

const SUGGESTIONS = [
  { ref: '@diff', label: 'uncommitted git diff' },
  { ref: '@staged', label: 'staged git diff' },
  { ref: '@git:3', label: 'last 3 commits + patches' },
  { ref: '@file:src/app.ts', label: 'a file (add :10-40 for a range)' },
  { ref: '@url:https://…', label: 'a web page as text' }
]

/**
 * Insert a context reference into the active pane: type @diff / @staged / @git:N
 * / @file:path / @url:… and URterminal expands it (git, file, fetched page) and
 * pastes the real content into the focused agent — so you can attach context the
 * agent can't pull on its own. cwd comes from the active pane.
 */
export default function InsertReferenceModal(): JSX.Element | null {
  const show = useUi((s) => s.showInsertReference)
  const setShow = useUi((s) => s.setShowInsertReference)
  const activeId = useWorkspace((s) => s.activePaneId)
  const pane = useWorkspace((s) => (activeId ? s.panes[activeId] : undefined))
  const cwd = pane?.type === 'ai' ? pane.agent?.cwd : pane?.shell?.cwd
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (show) {
      setRef('')
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [show])

  if (!show) return null

  const insert = (value?: string): void => {
    const r = (value ?? ref).trim()
    if (!r || busy) return
    if (!activeId) {
      toast('Focus a pane first', 'info')
      return
    }
    setBusy(true)
    void window.api
      .expandReference(r, cwd ?? '')
      .then((res) => {
        if (!res.ok || !res.content) {
          toast(res.error ?? 'Could not expand that reference', 'error')
          setBusy(false)
          return
        }
        pasteText(activeId, res.content)
        focusTerminal(activeId)
        setShow(false)
      })
      .catch((e: Error) => {
        toast(e.message, 'error')
        setBusy(false)
      })
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal runcmd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="runcmd-title">
            <AtSign size={16} />
            <span>Insert context reference</span>
          </div>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>
        <div className="modal-body runcmd-body">
          <input
            ref={inputRef}
            className="input mono runcmd-input"
            placeholder="@diff   ·   @git:3   ·   @file:path:10-40   ·   @url:https://…"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                insert()
              }
            }}
          />
          <div className="ref-suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s.ref} className="ref-chip" onClick={() => setRef(s.ref)} title={s.label}>
                {s.ref}
              </button>
            ))}
          </div>
          <div className="runcmd-actions">
            <button className="btn" onClick={() => setShow(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => insert()} disabled={!ref.trim() || busy}>
              {busy ? <Loader2 size={13} className="spin" /> : <CornerDownLeft size={13} />} Insert
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
