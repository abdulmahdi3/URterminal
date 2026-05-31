import { useWorkspace } from '@renderer/store/workspace'
import { useSettings } from '@renderer/store/settings'
import { setSshCreds } from '@renderer/lib/terminalPool'
import { toast } from '@renderer/store/toasts'
import { agentLaunch, agentDescriptor } from '@shared/providers'

/** Optional connection extras (e.g. an agent to launch right after connecting). */
export interface SshConnectExtras {
  /** agent command id to run inside the session once connected (e.g. "claude") */
  agentOnConnect?: string
}

/**
 * Open a new pane that connects to `target` ("user@host[:port]") over SSH using
 * the given password. The session runs through the main-process ssh2 client and
 * streams into the pane like a normal terminal; when it closes, the pane closes
 * (wired via ShellPane's onExit). The target is remembered for next time, and
 * the password is optionally saved (encrypted, in the main process). If
 * `extras.agentOnConnect` is set, that agent is launched inside the session
 * right after it connects.
 */
export function connectSsh(
  target: string,
  password: string,
  save: boolean,
  extras: SshConnectExtras = {}
): void {
  const host = target.trim()
  if (!host) return

  const ws = useWorkspace.getState()
  const id = ws.addPane('shell', undefined, { label: host })
  if (!id) {
    toast('Max 9 panes reached', 'info')
    return
  }
  // Mark the pane as an SSH session; the password is passed out-of-band (never
  // persisted on the pane / in session snapshots).
  ws.updatePane(id, { shell: { shell: '', ssh: { target: host } }, title: host })
  // Translate the agent id into the bare remote command line (e.g. "claude").
  const startupCommand = extras.agentOnConnect
    ? (() => {
        const launch = agentLaunch(agentDescriptor(extras.agentOnConnect), extras.agentOnConnect)
        return [launch.command, ...launch.args].join(' ')
      })()
    : undefined
  setSshCreds(id, { password: password || undefined, savePassword: save, startupCommand })

  // Remember the target as the most recent connection (dedup, cap the list).
  const prev = useSettings.getState().settings?.prefs.sshHosts ?? []
  const sshHosts = [host, ...prev.filter((h) => h !== host)].slice(0, 8)
  void useSettings.getState().patch({ prefs: { sshHosts } })
}
