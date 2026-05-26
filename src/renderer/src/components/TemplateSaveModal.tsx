import { useEffect, useState } from 'react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { templateFromPane, addTemplate } from '@renderer/lib/templates'
import { toast } from '@renderer/store/toasts'

/** Save the active pane's configuration as a named, reusable template. */
export default function TemplateSaveModal(): JSX.Element | null {
  const paneId = useUi((s) => s.savingTemplatePaneId)
  const setPaneId = useUi((s) => s.setSavingTemplatePaneId)
  const pane = useWorkspace((s) => (paneId ? s.panes[paneId] : null))
  const [name, setName] = useState('')

  useEffect(() => {
    if (pane) setName(pane.title || '')
  }, [pane])

  if (!paneId || !pane) return null

  const close = (): void => setPaneId(null)
  const save = (): void => {
    const tpl = templateFromPane(pane, name.trim() || pane.title || 'Template')
    if (!tpl) {
      toast('Only agent and shell panes can be saved as templates', 'info')
      close()
      return
    }
    addTemplate(tpl)
    toast(`Saved template: ${tpl.name}`, 'ok')
    close()
  }

  const summary =
    pane.type === 'ai'
      ? `${pane.agent?.command ?? 'agent'}${pane.agent?.cwd ? ` · ${pane.agent.cwd}` : ''}`
      : `${pane.shell?.shell || 'OS shell'}${pane.shell?.cwd ? ` · ${pane.shell.cwd}` : ''}`

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Save pane as template</h2>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="hint">{summary}</p>
          <label className="settings-label">Template name</label>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            style={{ marginTop: 6 }}
          />
          <div className="settings-actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={save} disabled={!name.trim()}>
              Save template
            </button>
            <button className="btn" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
