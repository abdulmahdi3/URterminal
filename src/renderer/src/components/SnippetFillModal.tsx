import { useEffect, useMemo, useState } from 'react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { parseVariables, fillTemplate } from '@renderer/lib/snippets'
import { injectText } from '@renderer/lib/inject'
import { toast } from '@renderer/store/toasts'

/** Collects {{variable}} values for a snippet, then pastes the filled text. */
export default function SnippetFillModal(): JSX.Element | null {
  const snippet = useUi((s) => s.fillSnippet)
  const setFillSnippet = useUi((s) => s.setFillSnippet)
  const vars = useMemo(() => (snippet ? parseVariables(snippet.body) : []), [snippet])
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    setValues({})
  }, [snippet])

  if (!snippet) return null

  const close = (): void => setFillSnippet(null)
  const apply = (): void => {
    const filled = fillTemplate(snippet.body, values)
    const id = useWorkspace.getState().activePaneId
    if (!id || !injectText(id, filled, false)) toast('No active pane to insert into', 'info')
    close()
  }

  const preview = fillTemplate(snippet.body, values)

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Fill “{snippet.name}”</h2>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {vars.map((v, i) => (
            <div className="settings-row" key={v}>
              <label className="settings-label">{v}</label>
              <div className="settings-control">
                <input
                  className="input"
                  autoFocus={i === 0}
                  value={values[v] ?? ''}
                  onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && apply()}
                />
              </div>
            </div>
          ))}
          <label className="settings-label" style={{ marginTop: 8 }}>
            Preview
          </label>
          <pre className="snippet-preview">{preview}</pre>
          <div className="settings-actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={apply}>
              Insert
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
