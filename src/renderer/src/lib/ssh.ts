import { useWorkspace } from '@renderer/store/workspace'
import { useSettings } from '@renderer/store/settings'
import { setSshCreds } from '@renderer/lib/terminalPool'
import { toast } from '@renderer/store/toasts'
import type { SshHost } from '@shared/types'

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** Build the live "user@host[:port]" target string for a host. */
export function hostTarget(h: { user: string; host: string; port: number }): string {
  const userPart = h.user.trim() ? `${h.user.trim()}@` : ''
  const portPart = h.port && h.port !== 22 ? `:${h.port}` : ''
  return `${userPart}${h.host.trim()}${portPart}`
}

/** A blank host with sensible defaults, ready for the editor. */
export function blankHost(partial: Partial<SshHost> = {}): SshHost {
  return {
    id: uid(),
    name: '',
    user: '',
    host: '',
    port: 22,
    group: '',
    tags: [],
    favorite: false,
    authMethod: 'password',
    identityFile: undefined,
    sessionCount: 0,
    ...partial
  }
}

/** The current saved-hosts list. */
function hosts(): SshHost[] {
  return useSettings.getState().settings?.prefs.sshSavedHosts ?? []
}

/** Persist the whole saved-hosts list. */
export function saveHosts(next: SshHost[]): void {
  void useSettings.getState().patch({ prefs: { sshSavedHosts: next } })
}

/** Insert or replace a host by id. */
export function upsertHost(host: SshHost): void {
  const list = hosts()
  const i = list.findIndex((h) => h.id === host.id)
  saveHosts(i < 0 ? [...list, host] : list.map((h) => (h.id === host.id ? host : h)))
}

/** Remove a host by id. */
export function deleteHost(id: string): void {
  saveHosts(hosts().filter((h) => h.id !== id))
}

/**
 * Record a successful connect: bump the host's usage stats and push the target
 * to the recents list. Both prefs are written in ONE patch so the two writes
 * can't race each other's round-trip.
 */
function recordConnect(hostId: string, target: string): void {
  const list = hosts()
  const sshSavedHosts = list.map((h) =>
    h.id === hostId ? { ...h, lastUsedAt: Date.now(), sessionCount: (h.sessionCount ?? 0) + 1 } : h
  )
  const prev = useSettings.getState().settings?.prefs.sshHosts ?? []
  const sshHosts = [target, ...prev.filter((h) => h !== target)].slice(0, 8)
  void useSettings.getState().patch({ prefs: { sshSavedHosts, sshHosts } })
}

interface ConnectOpts {
  /** freshly-typed password (used for "Ask each time" / password auth) */
  password?: string
  /** persist the password (encrypted, in the main process) */
  save?: boolean
}

/**
 * Open a new pane connected to a saved host, honoring its auth method. The
 * session streams through the pty channels like any shell; the pane closes when
 * the session ends. Usage stats are bumped and the target is remembered.
 */
export function connectHost(host: SshHost, opts: ConnectOpts = {}): string | null {
  const target = hostTarget(host)
  if (!host.host.trim()) {
    toast('Host is required', 'info')
    return null
  }
  const label = host.name.trim() || target
  const ws = useWorkspace.getState()
  const id = ws.addPane('shell', undefined, { label })
  if (!id) {
    toast('Max 9 panes reached', 'info')
    return null
  }
  ws.updatePane(id, { shell: { shell: '', ssh: { target } }, title: label })
  setSshCreds(id, {
    password: opts.password || undefined,
    savePassword: opts.save,
    authMethod: host.authMethod,
    identityFile: host.authMethod === 'key' ? host.identityFile : undefined
  })
  recordConnect(host.id, target)
  return id
}

/**
 * Quick-connect to a raw "user@host" target with a password (no saved host).
 * Kept for the command palette / recents that only carry a target string.
 */
export function connectSsh(target: string, password: string, save: boolean): void {
  const value = target.trim()
  if (!value) return
  const { username, host, port } = splitTarget(value)
  connectHost(
    blankHost({ user: username, host, port, name: value, authMethod: 'password' }),
    { password, save }
  )
}

/** Parse "user@host[:port]" → parts (mirror of the main-side parser). */
function splitTarget(target: string): { username: string; host: string; port: number } {
  const at = target.indexOf('@')
  const username = at >= 0 ? target.slice(0, at) : ''
  let rest = at >= 0 ? target.slice(at + 1) : target
  let port = 22
  const colon = rest.lastIndexOf(':')
  if (colon >= 0) {
    const p = parseInt(rest.slice(colon + 1), 10)
    if (!Number.isNaN(p)) {
      rest = rest.slice(0, colon)
      port = p
    }
  }
  return { username, host: rest, port }
}
