import { useEffect, useState } from 'react'
import { useUi } from '@renderer/store/ui'
import { useSettings } from '@renderer/store/settings'
import { connectSsh } from '@renderer/lib/ssh'

/**
 * Collect an SSH target + password and open a session. The host field is
 * pre-filled with the most recent connection; recent hosts are listed below and
 * reconnect using their saved password (if any).
 */
export default function SshConnectModal(): JSX.Element | null {
  const open = useUi((s) => s.showSshPrompt)
  const setOpen = useUi((s) => s.setShowSshPrompt)
  const hosts = useSettings((s) => s.settings?.prefs.sshHosts ?? [])
  const servers = useSettings((s) => s.settings?.prefs.sshServers ?? [])
  const [host, setHost] = useState('')
  const [password, setPassword] = useState('')
  const [save, setSave] = useState(false)

  // Initialize the fields once, when the modal opens — depend only on `open`
  // (the `hosts` selector returns a fresh array each render, so depending on it
  // would reset the input on every keystroke).
  useEffect(() => {
    if (open) {
      setHost(useSettings.getState().settings?.prefs.sshHosts?.[0] ?? '')
      setPassword('')
      setSave(false)
    }
  }, [open])

  if (!open) return null

  const close = (): void => setOpen(false)
  // Manual connect uses the typed host + password (+ save choice). Clicking a
  // recent host reconnects with its saved password (pwd left blank → main looks
  // one up), so no need to retype.
  const connect = (target?: string): void => {
    const value = (target ?? host).trim()
    if (!value) return
    if (target) connectSsh(target, '', false)
    else connectSsh(value, password, save)
    close()
  }

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>SSH connect</h2>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <label className="settings-label">ssh user@host</label>
          <input
            className="input"
            autoFocus
            placeholder="user@host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
            style={{ marginTop: 6 }}
          />
          <label className="settings-label" style={{ marginTop: 10 }}>
            Password
          </label>
          <input
            className="input"
            type="password"
            placeholder="(leave blank to use a saved password)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
            style={{ marginTop: 6 }}
          />
          <label className="ssh-save">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
            <span>Save credentials</span>
          </label>
          {servers.length > 0 && (
            <div className="ssh-recent">
              <div className="ssh-recent-head">Saved servers</div>
              {servers.map((s) => (
                <button
                  key={s.id}
                  className="ssh-recent-item"
                  title={`ssh ${s.target}${s.agentOnConnect ? ` · opens ${s.agentOnConnect}` : ''}`}
                  onClick={() => {
                    connectSsh(s.target, '', false, { agentOnConnect: s.agentOnConnect })
                    close()
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {hosts.length > 0 && (
            <div className="ssh-recent">
              <div className="ssh-recent-head">Recent</div>
              {hosts.map((h) => (
                <button key={h} className="ssh-recent-item" onClick={() => connect(h)} title={`ssh ${h}`}>
                  {h}
                </button>
              ))}
            </div>
          )}
          <div className="settings-actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => connect()} disabled={!host.trim()}>
              Connect
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
