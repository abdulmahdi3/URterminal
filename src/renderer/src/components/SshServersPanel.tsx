import { useState } from 'react'
import { Plug, Pencil, Trash2, Bot } from 'lucide-react'
import type { SshServer } from '@shared/types'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { connectSsh } from '@renderer/lib/ssh'
import { getAgents } from '@renderer/lib/agents'
import { AGENT_LABELS } from '@shared/providers'
import { uid } from '@renderer/lib/snippets'

/**
 * Manage a list of named SSH servers (the "ssh management" feature). Each server
 * stores a label, a target ("user@host[:port]"), and an optional agent to launch
 * inside the session on connect. Servers are saved in prefs.sshServers; passwords
 * are saved (encrypted, in the main process) the first time you connect with the
 * "save password" option, keyed by the target.
 */
export default function SshServersPanel(): JSX.Element {
  const servers = useSettings((s) => s.settings?.prefs.sshServers ?? [])
  const patch = useSettings((s) => s.patch)
  const setShowSettings = useUi((s) => s.setShowSettings)
  const agents = getAgents()

  const [editId, setEditId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [target, setTarget] = useState('')
  const [agent, setAgent] = useState('') // '' = don't open an agent
  const [password, setPassword] = useState('')
  const [savePw, setSavePw] = useState(false)

  const reset = (): void => {
    setEditId(null)
    setLabel('')
    setTarget('')
    setAgent('')
    setPassword('')
    setSavePw(false)
  }

  const persist = (): SshServer | null => {
    const t = target.trim()
    if (!t) return null
    const entry: SshServer = {
      id: editId ?? uid(),
      label: label.trim() || t,
      target: t,
      agentOnConnect: agent || undefined
    }
    const next = editId ? servers.map((s) => (s.id === editId ? entry : s)) : [...servers, entry]
    void patch({ prefs: { sshServers: next } })
    return entry
  }

  const saveOnly = (): void => {
    if (persist()) reset()
  }

  const saveAndConnect = (): void => {
    const entry = persist()
    if (!entry) return
    connectSsh(entry.target, password, savePw, { agentOnConnect: entry.agentOnConnect })
    reset()
    setShowSettings(false)
  }

  const startEdit = (s: SshServer): void => {
    setEditId(s.id)
    setLabel(s.label)
    setTarget(s.target)
    setAgent(s.agentOnConnect ?? '')
    setPassword('')
    setSavePw(false)
  }

  const remove = (id: string): void =>
    void patch({ prefs: { sshServers: servers.filter((s) => s.id !== id) } })

  const connectSaved = (s: SshServer): void => {
    connectSsh(s.target, '', false, { agentOnConnect: s.agentOnConnect })
    setShowSettings(false)
  }

  return (
    <div className="ssh-mgr">
      <span className="hint settings-block-hint">
        Save the servers you connect to often. Passwords are stored encrypted via the OS keychain
        when you connect with “save password”, and never leave this machine.
      </span>

      {servers.length > 0 && (
        <div className="snippet-list">
          {servers.map((s) => (
            <div className="snippet-item" key={s.id}>
              <div className="snippet-item-head">
                <span className="snippet-name">{s.label}</span>
                {s.agentOnConnect && (
                  <span className="ssh-agent-tag" title={`Opens ${AGENT_LABELS[s.agentOnConnect] ?? s.agentOnConnect} on connect`}>
                    <Bot size={11} /> {AGENT_LABELS[s.agentOnConnect] ?? s.agentOnConnect}
                  </span>
                )}
                <button className="btn primary sm ssh-mgr-connect" title={`ssh ${s.target}`} onClick={() => connectSaved(s)}>
                  <Plug size={12} /> Connect
                </button>
                <button className="icon-btn" title="Edit" onClick={() => startEdit(s)}>
                  <Pencil size={13} />
                </button>
                <button className="icon-btn danger" title="Delete" onClick={() => remove(s.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
              <code className="ssh-mgr-target">{s.target}</code>
            </div>
          ))}
        </div>
      )}

      <div className="snippet-add ssh-mgr-form">
        <div className="snippet-add-row">
          <input className="input" placeholder="Label (e.g. Prod box)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="input mono" placeholder="user@host:port" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div className="snippet-add-row">
          <select className="select" value={agent} onChange={(e) => setAgent(e.target.value)} title="Open an agent inside the session on connect">
            <option value="">Don’t open an agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>Open {a.label} on connect</option>
            ))}
          </select>
          <input
            className="input"
            type="password"
            placeholder="Password (optional)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <label className="ssh-save">
          <input type="checkbox" checked={savePw} onChange={(e) => setSavePw(e.target.checked)} />
          <span>Save password (encrypted) when connecting</span>
        </label>
        <div className="settings-actions">
          <button className="btn primary" onClick={saveAndConnect} disabled={!target.trim()}>
            <Plug size={13} /> {editId ? 'Save & connect' : 'Add & connect'}
          </button>
          <button className="btn" onClick={saveOnly} disabled={!target.trim()}>
            {editId ? 'Save changes' : 'Add server'}
          </button>
          {editId && (
            <button className="btn ghost" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
