import { useEffect, useState } from 'react'
import { Plug, Trash2, Plus, FolderOpen } from 'lucide-react'
import type { McpServer } from '@shared/types'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toasts'

/**
 * Curate the active pane folder's `.mcp.json` — the file agents like Claude Code
 * read to discover MCP servers. URterminal just edits that file; the agent hosts
 * the servers. Changes apply on the agent's next launch in that folder.
 */
export default function McpModal(): JSX.Element | null {
  const show = useUi((s) => s.showMcp)
  const setShow = useUi((s) => s.setShowMcp)
  const activeId = useWorkspace((s) => s.activePaneId)
  const pane = useWorkspace((s) => (activeId ? s.panes[activeId] : undefined))
  const cwd = (pane?.type === 'ai' ? pane.agent?.cwd : pane?.shell?.cwd) ?? ''
  const [servers, setServers] = useState<McpServer[]>([])
  const [draft, setDraft] = useState<McpServer>({ name: '', command: '', args: [] })
  const [argsText, setArgsText] = useState('')

  useEffect(() => {
    if (show && cwd) void window.api.readMcp(cwd).then(setServers)
    if (show) {
      setDraft({ name: '', command: '', args: [] })
      setArgsText('')
    }
  }, [show, cwd])

  if (!show) return null

  const persist = (next: McpServer[]): void => {
    setServers(next)
    void window.api.writeMcp(cwd, next).then((r) => {
      if (!r.ok) toast(r.error ?? 'Could not write .mcp.json', 'error')
    })
  }
  const add = (): void => {
    if (!draft.name.trim() || !draft.command.trim()) return
    const args = argsText.split(/\s+/).filter(Boolean)
    persist([...servers.filter((s) => s.name !== draft.name.trim()), { ...draft, args }])
    setDraft({ name: '', command: '', args: [] })
    setArgsText('')
    toast(`Added MCP server “${draft.name.trim()}”`, 'ok')
  }
  const remove = (name: string): void => persist(servers.filter((s) => s.name !== name))

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal doctor" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="doctor-title">
            <Plug size={16} />
            <span>MCP servers</span>
          </div>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>
        <div className="modal-body doctor-body">
          {!cwd ? (
            <div className="doctor-hint">Focus an agent/shell pane that has a folder first.</div>
          ) : (
            <>
              <div className="doctor-hint">
                <FolderOpen size={12} /> {cwd}/.mcp.json — agents load these on next launch here.
              </div>
              {servers.map((s) => (
                <div className="doctor-row ok" key={s.name}>
                  <span className="doctor-name">
                    {s.name}
                    <span className="doctor-bin">
                      {s.command} {s.args.join(' ')}
                    </span>
                  </span>
                  <button className="icon-btn danger doctor-action" title="Remove" onClick={() => remove(s.name)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <div className="mcp-add">
                <input
                  className="input"
                  placeholder="name (e.g. filesystem)"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <input
                  className="input mono"
                  placeholder="command (e.g. npx)"
                  value={draft.command}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                />
                <input
                  className="input mono"
                  placeholder="args (space-separated)"
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                />
                <button className="btn primary" onClick={add} disabled={!draft.name.trim() || !draft.command.trim()}>
                  <Plus size={13} /> Add
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
