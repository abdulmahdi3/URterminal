import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  Star,
  Plus,
  Download,
  X,
  Copy,
  MoreHorizontal,
  TerminalSquare,
  KeyRound,
  Clock3,
  Activity,
  Globe,
  Trash2,
  Play,
  Server,
  Eye
} from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useSettings } from '@renderer/store/settings'
import { toast } from '@renderer/store/toasts'
import {
  hostTarget,
  blankHost,
  upsertHost,
  deleteHost,
  connectHost
} from '@renderer/lib/ssh'
import type { SshHost, SshKeyInfo, SshCredential, SshAuthMethod } from '@shared/types'

type GroupBy = 'folder' | 'last' | 'most' | 'favorites'
type Ping = number | null | undefined // ms | offline | not-yet-pinged

/** A row in the Credentials vault (an on-disk identity key or a saved password). */
interface CredItem {
  id: string
  kind: 'key' | 'password'
  name: string
  meta: string
  /** right-aligned detail: a fingerprint (keys) or masked dots (passwords) */
  trailing: string
  trailingMono: boolean
  /** what the copy button writes to the clipboard */
  copyText: string
  /** present for passwords — removes the credential from the vault */
  onForget?: () => void
}

/** Relative "12m ago" / "2d ago" label from an epoch-ms timestamp. */
function relTime(ms?: number): string {
  if (!ms) return 'never'
  const d = Math.max(0, Date.now() - ms)
  const m = Math.floor(d / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  const w = Math.floor(days / 7)
  if (w < 5) return `${w}w ago`
  const mo = Math.floor(days / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/** Abbreviate a fingerprint to "SHA256:n8Xq…4kP2" for the credentials list. */
function shortFingerprint(fp?: string): string {
  if (!fp) return ''
  const b = fp.replace(/^SHA256:/, '')
  return b.length > 12 ? `SHA256:${b.slice(0, 4)}…${b.slice(-4)}` : fp
}

/** Short auth label for the stat card ("id_ed25519" / "Password" / "Ask"). */
function authLabel(h: SshHost): string {
  if (h.authMethod === 'key') return h.identityFile ? h.identityFile.split(/[/\\]/).pop()! : 'SSH key'
  if (h.authMethod === 'password') return 'Password'
  return 'Ask each time'
}

export default function SshManagerModal(): JSX.Element | null {
  const open = useUi((s) => s.showSshPrompt)
  const setOpen = useUi((s) => s.setShowSshPrompt)
  const hosts = useSettings((s) => s.settings?.prefs.sshSavedHosts ?? [])
  const recents = useSettings((s) => s.settings?.prefs.sshHosts ?? [])

  const [tab, setTab] = useState<'connections' | 'credentials'>('connections')
  const [groupBy, setGroupBy] = useState<GroupBy>('folder')
  const [query, setQuery] = useState('')
  const [credQuery, setCredQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SshHost | null>(null)
  const [pings, setPings] = useState<Record<string, Ping>>({})
  const [keys, setKeys] = useState<SshKeyInfo[]>([])
  const [creds, setCreds] = useState<SshCredential[]>([])
  const [password, setPassword] = useState('')
  const [savePassword, setSavePassword] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')

  // One-time migration: surface legacy recent targets as ungrouped saved hosts so
  // nothing the user connected to before the manager existed is lost.
  useEffect(() => {
    if (!open) return
    const existing = new Set(hosts.map((h) => hostTarget(h)))
    const missing = recents.filter((t) => !existing.has(t))
    if (missing.length && hosts.length === 0) {
      const seeded = missing.map((t) => {
        const at = t.indexOf('@')
        const user = at >= 0 ? t.slice(0, at) : ''
        let rest = at >= 0 ? t.slice(at + 1) : t
        let port = 22
        const c = rest.lastIndexOf(':')
        if (c >= 0 && !Number.isNaN(parseInt(rest.slice(c + 1), 10))) {
          port = parseInt(rest.slice(c + 1), 10)
          rest = rest.slice(0, c)
        }
        return blankHost({ name: rest, user, host: rest, port })
      })
      void useSettings.getState().patch({ prefs: { sshSavedHosts: seeded } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Reset transient UI when the modal opens.
  useEffect(() => {
    if (!open) return
    setMenuOpen(false)
    setTab('connections')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep a host selected whenever the list is non-empty (covers the async
  // seed/import filling the list after open).
  useEffect(() => {
    if (open && !selectedId && hosts.length) setSelectedId(hosts[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedId, hosts.length])

  // Sync the editor draft + auth UI to whichever host is selected.
  const selected = hosts.find((h) => h.id === selectedId) ?? null
  useEffect(() => {
    setDraft(selected ? { ...selected } : null)
    setPassword('')
    setSavePassword(true)
    setTagDraft('')
    setMenuOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Load identity keys + saved credentials once per open.
  useEffect(() => {
    if (!open) return
    void window.api.sshListKeys().then(setKeys)
    void window.api.sshListCredentials().then(setCreds)
  }, [open])

  // Ping every host for the online dots whenever the set of hosts changes.
  const idsKey = hosts.map((h) => h.id).join(',')
  useEffect(() => {
    if (!open) return
    let alive = true
    hosts.forEach((h) => {
      const target = hostTarget(h)
      if (!target) return
      void window.api.sshPing(target).then((ms) => {
        if (alive) setPings((p) => ({ ...p, [h.id]: ms }))
      })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey])

  // Re-ping just the selected host when its address changes (debounced) so the
  // detail badge stays honest while editing.
  const draftTarget = draft ? hostTarget(draft) : ''
  useEffect(() => {
    if (!open || !draft || !draftTarget) return
    const id = draft.id
    const t = window.setTimeout(() => {
      void window.api.sshPing(draftTarget).then((ms) => setPings((p) => ({ ...p, [id]: ms })))
    }, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTarget, open])

  const close = (): void => setOpen(false)

  // ---- host editing (local draft → persisted via upsertHost) ----
  const patchDraft = (patch: Partial<SshHost>): void => {
    if (!draft) return
    const next = { ...draft, ...patch }
    setDraft(next)
    upsertHost(next)
  }

  const onlineCount = hosts.filter((h) => typeof pings[h.id] === 'number').length

  // ---- sidebar grouping + search ----
  const filtered = hosts.filter((h) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      h.name.toLowerCase().includes(q) ||
      hostTarget(h).toLowerCase().includes(q) ||
      h.group.toLowerCase().includes(q) ||
      h.tags.some((t) => t.toLowerCase().includes(q))
    )
  })
  const groups = useMemo(() => {
    if (groupBy === 'favorites') return [{ title: 'FAVORITES', hosts: filtered.filter((h) => h.favorite) }]
    if (groupBy === 'most')
      return [{ title: 'MOST USED', hosts: [...filtered].sort((a, b) => b.sessionCount - a.sessionCount) }]
    if (groupBy === 'last')
      return [
        { title: 'LAST USED', hosts: [...filtered].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)) }
      ]
    const map = new Map<string, SshHost[]>()
    for (const h of filtered) {
      const g = h.group.trim() || 'Ungrouped'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(h)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, hs]) => ({ title, hosts: hs.sort((a, b) => a.name.localeCompare(b.name)) }))
  }, [filtered, groupBy])

  // All hooks above run unconditionally; only now is it safe to bail on a closed
  // modal (an early return before a hook breaks the Rules of Hooks → render crash).
  if (!open) return null

  // ---- credentials vault (identity keys + saved passwords, unified + searchable) ----
  const keyHostCount = (path: string): number => hosts.filter((h) => h.identityFile === path).length
  const pwHostCount = (target: string): number => hosts.filter((h) => hostTarget(h) === target).length
  const credItems: CredItem[] = [
    ...keys.map((k) => ({
      id: `key:${k.path}`,
      kind: 'key' as const,
      name: k.name,
      meta: [k.type ?? 'SSH key', k.bits ? `${k.bits}-bit` : null, `${keyHostCount(k.path)} hosts`]
        .filter(Boolean)
        .join(' · '),
      trailing: shortFingerprint(k.fingerprint),
      trailingMono: true,
      copyText: k.fingerprint || k.path
    })),
    ...creds.map((c) => {
      const n = pwHostCount(c.target)
      return {
        id: `pw:${c.target}`,
        kind: 'password' as const,
        name: c.target,
        meta: `Saved password · ${n} host${n === 1 ? '' : 's'}`,
        trailing: '••••••••••',
        trailingMono: false,
        copyText: c.target,
        onForget: () => void deleteCredential(c.target)
      }
    })
  ]
  const cq = credQuery.trim().toLowerCase()
  const filteredCreds = cq
    ? credItems.filter((c) => `${c.name} ${c.meta}`.toLowerCase().includes(cq))
    : credItems

  // ---- actions ----
  const newHost = (): void => {
    const h = blankHost({ name: 'new-host', group: groupBy === 'folder' && selected ? selected.group : '' })
    upsertHost(h)
    setSelectedId(h.id)
  }

  const importConfig = async (): Promise<void> => {
    const parsed = await window.api.sshImportConfig()
    if (!parsed.length) {
      toast('No hosts found in ~/.ssh/config', 'info')
      return
    }
    const existing = new Set(hosts.map((h) => hostTarget(h)))
    const add: SshHost[] = []
    for (const c of parsed) {
      const h = blankHost({
        name: c.name,
        user: c.user,
        host: c.host,
        port: c.port,
        identityFile: c.identityFile,
        authMethod: c.identityFile ? 'key' : 'ask'
      })
      if (!existing.has(hostTarget(h))) add.push(h)
    }
    if (!add.length) {
      toast('All ~/.ssh/config hosts already saved', 'info')
      return
    }
    void useSettings.getState().patch({ prefs: { sshSavedHosts: [...hosts, ...add] } })
    toast(`Imported ${add.length} host${add.length > 1 ? 's' : ''} from ~/.ssh/config`, 'ok')
  }

  const doConnect = (keepOpen: boolean): void => {
    if (!draft) return
    const id = connectHost(draft, {
      password: draft.authMethod !== 'key' ? password : undefined,
      save: draft.authMethod === 'password' && savePassword
    })
    if (id && !keepOpen) close()
  }

  const duplicateHost = (): void => {
    if (!draft) return
    // Omit id + usage stats so blankHost mints a fresh id and the copy starts clean.
    const { id: _id, lastUsedAt: _last, sessionCount: _n, ...rest } = draft
    const copy = blankHost({ ...rest, name: `${draft.name || draft.host} copy` })
    upsertHost(copy)
    setSelectedId(copy.id)
    setMenuOpen(false)
  }

  const removeSelected = (): void => {
    if (!draft) return
    deleteHost(draft.id)
    setMenuOpen(false)
    const rest = hosts.filter((h) => h.id !== draft.id)
    setSelectedId(rest[0]?.id ?? null)
  }

  const deleteCredential = async (target: string): Promise<void> => {
    await window.api.sshDeleteCredential(target)
    setCreds(await window.api.sshListCredentials())
    toast('Credential removed', 'ok')
  }

  const addTag = (): void => {
    const t = tagDraft.trim()
    if (!t || !draft || draft.tags.includes(t)) {
      setTagDraft('')
      return
    }
    patchDraft({ tags: [...draft.tags, t] })
    setTagDraft('')
  }

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal ssh-mgr" onMouseDown={(e) => e.stopPropagation()}>
        {/* ---- header ---- */}
        <div className="sshm-head">
          <div className="sshm-head-title">
            <span className="sshm-head-icon">
              <Eye size={18} />
            </span>
            <div>
              <h2>SSH connections</h2>
              <div className="sshm-head-sub">
                {hosts.length} hosts · <span className="sshm-online">{onlineCount} online</span> ·{' '}
                {credItems.length} saved credential{credItems.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <div className="sshm-head-actions">
            <button className="btn sshm-import" onClick={importConfig} title="Import hosts from ~/.ssh/config">
              <Download size={14} />
              <span>
                Import
                <small>~/.ssh/config</small>
              </span>
            </button>
            <button className="btn primary sshm-newhost" onClick={newHost}>
              <Plus size={14} /> New host
            </button>
            <button className="icon-btn" onClick={close} title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="sshm-body">
          {/* ---- left sidebar ---- */}
          <div className="sshm-side">
            <div className="sshm-tabs">
              <button className={tab === 'connections' ? 'on' : ''} onClick={() => setTab('connections')}>
                <Server size={14} /> Connections
              </button>
              <button className={tab === 'credentials' ? 'on' : ''} onClick={() => setTab('credentials')}>
                <KeyRound size={14} /> Credentials
              </button>
            </div>

            {tab === 'connections' ? (
              <>
                <div className="sshm-search">
                  <Search size={14} />
                  <input
                    placeholder="Search hosts, tags, IPs…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="sshm-groupby">
                  {(
                    [
                      ['folder', 'Folder'],
                      ['last', 'Last used'],
                      ['most', 'Most used'],
                      ['favorites', 'Favorites']
                    ] as [GroupBy, string][]
                  ).map(([k, label]) => (
                    <button key={k} className={groupBy === k ? 'on' : ''} onClick={() => setGroupBy(k)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="sshm-list">
                  {groups.every((g) => g.hosts.length === 0) && (
                    <div className="sshm-empty-list">
                      No hosts. Click <b>New host</b> or <b>Import</b>.
                    </div>
                  )}
                  {groups.map((g) =>
                    g.hosts.length === 0 ? null : (
                      <div key={g.title} className="sshm-group">
                        <div className="sshm-group-head">
                          {g.title.toUpperCase()}
                          <span className="sshm-group-count">{g.hosts.length}</span>
                        </div>
                        {g.hosts.map((h) => {
                          const ping = pings[h.id]
                          const dot =
                            ping === undefined ? 'pending' : typeof ping === 'number' ? 'online' : 'offline'
                          return (
                            <button
                              key={h.id}
                              className={`sshm-row${selectedId === h.id ? ' on' : ''}`}
                              onClick={() => setSelectedId(h.id)}
                              onDoubleClick={() => {
                                setSelectedId(h.id)
                                const id = connectHost(h, {})
                                if (id) close()
                              }}
                            >
                              <span className={`sshm-dot ${dot}`} />
                              <span className="sshm-row-main">
                                <span className="sshm-row-name">
                                  {h.name || h.host}
                                  {h.favorite && <Star size={11} className="sshm-fav" />}
                                </span>
                                <span className="sshm-row-target">{hostTarget(h) || h.host}</span>
                              </span>
                              <span className="sshm-row-meta">
                                {typeof ping === 'number' ? `${ping}ms` : relTime(h.lastUsedAt)}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="sshm-search">
                  <Search size={14} />
                  <input
                    placeholder="Search credentials…"
                    value={credQuery}
                    onChange={(e) => setCredQuery(e.target.value)}
                  />
                </div>
                <div className="sshm-list sshm-creds">
                  {filteredCreds.length === 0 && (
                    <div className="sshm-empty-list">
                      {credItems.length === 0 ? 'No saved credentials.' : 'No credentials match.'}
                    </div>
                  )}
                  {filteredCreds.map((c) => (
                    <div key={c.id} className={`sshm-cred-row ${c.kind}`}>
                      <span className={`sshm-cred-badge ${c.kind}`}>
                        {c.kind === 'key' ? <KeyRound size={15} /> : <Eye size={15} />}
                      </span>
                      <span className="sshm-cred-main">
                        <span className="sshm-cred-target">{c.name}</span>
                        <span className="sshm-cred-type">{c.meta}</span>
                      </span>
                      <span className={`sshm-cred-trail${c.trailingMono ? ' mono' : ''}`}>
                        {c.trailing}
                      </span>
                      <span className="sshm-cred-actions">
                        <button
                          className="icon-btn"
                          title="Copy"
                          onClick={() => {
                            void navigator.clipboard.writeText(c.copyText)
                            toast('Copied', 'ok')
                          }}
                        >
                          <Copy size={14} />
                        </button>
                        {c.onForget && (
                          <button className="icon-btn danger sshm-cred-forget" title="Forget credential" onClick={c.onForget}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ---- right detail / editor (shown on both tabs) ---- */}
          {draft ? (
            <HostDetail
              draft={draft}
              ping={pings[draft.id]}
              keys={keys}
              password={password}
              savePassword={savePassword}
              tagDraft={tagDraft}
              menuOpen={menuOpen}
              onPatch={patchDraft}
              onPassword={setPassword}
              onSavePassword={setSavePassword}
              onTagDraft={setTagDraft}
              onAddTag={addTag}
              onToggleMenu={() => setMenuOpen((v) => !v)}
              onDuplicate={duplicateHost}
              onDelete={removeSelected}
            />
          ) : (
            <div className="sshm-detail sshm-detail-empty">
              <Server size={42} />
              <p>Select a host, or create a new one.</p>
              <button className="btn primary" onClick={newHost}>
                <Plus size={14} /> New host
              </button>
            </div>
          )}
        </div>

        {/* ---- footer ---- */}
        <div className="sshm-foot">
          {draft && (
            <>
              <button className="btn primary sshm-connect" onClick={() => doConnect(false)}>
                <Play size={14} /> Connect
              </button>
              <button className="btn" onClick={() => doConnect(true)} title="Open another pane and keep this open">
                <Plus size={14} /> New pane
              </button>
            </>
          )}
          <button className="btn sshm-cancel" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/** The right-hand editor for a single host. */
function HostDetail(props: {
  draft: SshHost
  ping: Ping
  keys: SshKeyInfo[]
  password: string
  savePassword: boolean
  tagDraft: string
  menuOpen: boolean
  onPatch: (p: Partial<SshHost>) => void
  onPassword: (v: string) => void
  onSavePassword: (v: boolean) => void
  onTagDraft: (v: string) => void
  onAddTag: () => void
  onToggleMenu: () => void
  onDuplicate: () => void
  onDelete: () => void
}): JSX.Element {
  const { draft, ping, keys } = props
  const target = hostTarget(draft)
  const status =
    ping === undefined ? { cls: 'pending', text: 'checking…' } : typeof ping === 'number' ? { cls: 'online', text: `connected · ${ping} ms` } : { cls: 'offline', text: 'offline' }
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the "more" menu when clicking anywhere outside it.
  useEffect(() => {
    if (!props.menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) props.onToggleMenu()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.menuOpen])

  // connection string = user@host (port is its own field)
  const connStr = draft.user ? `${draft.user}@${draft.host}` : draft.host
  const setConn = (v: string): void => {
    const at = v.indexOf('@')
    props.onPatch({ user: at >= 0 ? v.slice(0, at) : '', host: at >= 0 ? v.slice(at + 1) : v })
  }

  const setAuth = (m: SshAuthMethod): void =>
    props.onPatch({ authMethod: m, identityFile: m === 'key' ? draft.identityFile || keys[0]?.path : draft.identityFile })

  return (
    <div className="sshm-detail">
      <div className="sshm-detail-head">
        <div className="sshm-detail-id">
          <h3>
            {draft.name || draft.host || 'untitled'}
            <button
              className={`sshm-fav-btn${draft.favorite ? ' on' : ''}`}
              title={draft.favorite ? 'Unfavorite' : 'Favorite'}
              onClick={() => props.onPatch({ favorite: !draft.favorite })}
            >
              <Star size={16} />
            </button>
          </h3>
          <code className="sshm-detail-ssh">ssh {target || '…'}</code>
        </div>
        <div className="sshm-detail-tools">
          <span className={`sshm-status ${status.cls}`}>
            <span className="sshm-dot" />
            {status.text}
          </span>
          <button
            className="icon-btn"
            title="Copy ssh command"
            onClick={() => {
              void navigator.clipboard.writeText(`ssh ${target}`)
              toast('Copied ssh command', 'ok')
            }}
          >
            <Copy size={15} />
          </button>
          <div className="sshm-menu-wrap" ref={menuRef}>
            <button className="icon-btn" title="More" onClick={props.onToggleMenu}>
              <MoreHorizontal size={16} />
            </button>
            {props.menuOpen && (
              <div className="sshm-menu">
                <button onClick={props.onDuplicate}>
                  <Copy size={13} /> Duplicate host
                </button>
                <button className="danger" onClick={props.onDelete}>
                  <Trash2 size={13} /> Delete host
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* stat cards */}
      <div className="sshm-stats">
        <StatCard icon={<Clock3 size={13} />} label="Last used" value={relTime(draft.lastUsedAt)} />
        <StatCard icon={<Activity size={13} />} label="Sessions" value={String(draft.sessionCount ?? 0)} />
        <StatCard icon={<Globe size={13} />} label="Group" value={draft.group || 'Ungrouped'} />
        <StatCard icon={<KeyRound size={13} />} label="Auth" value={authLabel(draft)} />
      </div>

      {/* tags */}
      <div className="sshm-tags">
        {draft.tags.map((t) => (
          <span key={t} className="sshm-tag">
            {t}
            <button onClick={() => props.onPatch({ tags: draft.tags.filter((x) => x !== t) })} title="Remove tag">
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="sshm-tag-input"
          placeholder="+ tag"
          value={props.tagDraft}
          onChange={(e) => props.onTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onAddTag()
            if (e.key === 'Backspace' && !props.tagDraft && draft.tags.length)
              props.onPatch({ tags: draft.tags.slice(0, -1) })
          }}
          onBlur={props.onAddTag}
        />
      </div>

      <div className="sshm-divider" />

      {/* name + group */}
      <div className="sshm-grid2">
        <Field label="NAME">
          <input className="input" value={draft.name} onChange={(e) => props.onPatch({ name: e.target.value })} placeholder="prod-web-1" />
        </Field>
        <Field label="GROUP">
          <input className="input" value={draft.group} onChange={(e) => props.onPatch({ group: e.target.value })} placeholder="Production" />
        </Field>
      </div>

      {/* connection string + port */}
      <div className="sshm-grid-conn">
        <Field label="CONNECTION STRING">
          <div className="sshm-input-icon">
            <TerminalSquare size={15} />
            <input className="input" value={connStr} onChange={(e) => setConn(e.target.value)} placeholder="root@72.62.152.235" spellCheck={false} />
          </div>
        </Field>
        <Field label="PORT">
          <input
            className="input"
            type="number"
            value={draft.port}
            onChange={(e) => props.onPatch({ port: parseInt(e.target.value, 10) || 22 })}
          />
        </Field>
      </div>

      {/* authentication */}
      <Field label="AUTHENTICATION">
        <div className="sshm-auth">
          {(
            [
              ['key', 'SSH key', <KeyRound size={14} key="k" />],
              ['password', 'Password', <Eye size={14} key="p" />],
              ['ask', 'Ask each time', <Clock3 size={14} key="a" />]
            ] as [SshAuthMethod, string, JSX.Element][]
          ).map(([m, label, icon]) => (
            <button key={m} className={draft.authMethod === m ? 'on' : ''} onClick={() => setAuth(m)}>
              {icon} {label}
            </button>
          ))}
        </div>
      </Field>

      {/* auth detail (varies by method) */}
      {draft.authMethod === 'key' ? (
        <Field label="IDENTITY FILE">
          <div className="sshm-input-icon">
            <KeyRound size={15} />
            <select
              className="input"
              value={draft.identityFile ?? ''}
              onChange={(e) => props.onPatch({ identityFile: e.target.value || undefined })}
            >
              <option value="">Default keys / ssh-agent</option>
              {keys.map((k) => (
                <option key={k.path} value={k.path}>
                  ~/.ssh/{k.name}
                  {k.type ? ` — ${k.type}` : ''}
                  {k.bits ? ` · ${k.bits}-bit` : ''}
                </option>
              ))}
              {draft.identityFile && !keys.some((k) => k.path === draft.identityFile) && (
                <option value={draft.identityFile}>{draft.identityFile}</option>
              )}
            </select>
          </div>
        </Field>
      ) : (
        <Field label="PASSWORD">
          <input
            className="input"
            type="password"
            placeholder={
              draft.authMethod === 'ask'
                ? 'Typed at connect — never stored'
                : '(leave blank to use a saved password)'
            }
            value={props.password}
            onChange={(e) => props.onPassword(e.target.value)}
          />
        </Field>
      )}

      {draft.authMethod === 'password' && (
        <label className="sshm-vault">
          <input type="checkbox" checked={props.savePassword} onChange={(e) => props.onSavePassword(e.target.checked)} />
          <span>
            <b>Save credentials to vault</b>
            <small>Stored encrypted in the OS keychain, never in plaintext.</small>
          </span>
        </label>
      )}
      {draft.authMethod === 'ask' && (
        <div className="sshm-ask-note">
          <Clock3 size={14} /> Used for this connection only — nothing is written to disk.
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: JSX.Element; label: string; value: string }): JSX.Element {
  return (
    <div className="sshm-stat">
      <div className="sshm-stat-label">
        {icon} {label}
      </div>
      <div className="sshm-stat-value" title={value}>
        {value}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="sshm-field">
      <span className="sshm-field-label">{label}</span>
      {children}
    </label>
  )
}
