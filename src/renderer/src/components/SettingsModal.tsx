import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Check, Search, Trash2, RotateCcw, Download, Upload, Keyboard } from 'lucide-react'
import type { ProviderId, AppPrefs, SettingsPatch, IntegrationId, IntegrationStatus } from '@shared/types'
import { DEFAULT_PREFS } from '@shared/types'
import {
  PROVIDER_LABELS,
  DEFAULT_MODELS,
  AGENTS,
  AGENT_LABELS,
  latestModel,
  DEFAULT_AGENT
} from '@shared/providers'
import { uid } from '@renderer/lib/snippets'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { toast } from '@renderer/store/toasts'
import { getShellSpecs, refreshWslDistros, type ShellSpec } from '@renderer/lib/shells'
import { getAvailableAgents, refreshAgentAvailability } from '@renderer/lib/agents'

const ACCENT_PRESETS = [
  { label: 'Blue', value: '#4c8dff' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Rose', value: '#f43f5e' },
]

// Common monospace families offered for terminals (layered over the built-in
// stack, so an unavailable one falls back gracefully). '' = built-in default.
const FONT_OPTIONS = [
  { value: '', label: 'Default (JetBrains Mono)' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'Cascadia Mono', label: 'Cascadia Mono' },
  { value: 'Consolas', label: 'Consolas' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Source Code Pro', label: 'Source Code Pro' },
  { value: 'Ubuntu Mono', label: 'Ubuntu Mono' },
  { value: 'Menlo', label: 'Menlo' },
  { value: 'Monaco', label: 'Monaco' }
]

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'amoled', label: 'AMOLED' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'forest', label: 'Forest' },
  { value: 'dusk', label: 'Dusk' }
]

type KeyProvider = 'anthropic' | 'openai' | 'gemini'
const KEY_PROVIDERS: KeyProvider[] = ['anthropic', 'openai', 'gemini']

/** Pref keys reset by each section's "Reset" button. */
const SECTION_PREF_KEYS: Record<string, (keyof AppPrefs)[]> = {
  terminal: [
    'cursorStyle', 'cursorBlink', 'lineHeight', 'letterSpacing', 'scrollback',
    'terminalPadding', 'showPaneHeaders', 'scrollSensitivity', 'terminalBell',
    'copyOnSelect', 'pasteOnRightClick'
  ],
  behavior: [
    'confirmClose', 'defaultShellCwd', 'autoSaveSeconds', 'maxRestorePanes',
    'focusNewPane', 'clearWorkspaceOnExit', 'autoRestore'
  ],
  notifications: [
    'notifyOnDone', 'notifySound', 'notifyOnlyUnfocused', 'notifyVolume', 'notifySoundName'
  ],
  appearance: ['appTheme', 'fontFamily', 'fontSize']
}

/** Small "Key set" / "Not set" status pill used by the key + token fields. */
function KeyStatus({ set }: { set: boolean }): JSX.Element {
  return (
    <span className={clsx('settings-status', set ? 'set' : 'unset')}>
      {set ? (
        <>
          <Check size={11} /> Key set
        </>
      ) : (
        'Not set'
      )}
    </span>
  )
}

/**
 * Metadata for the to-do service cards. Each service uses the connection
 * method that fits it best — Todoist and Notion offer simple personal tokens
 * we can paste; TickTick / Microsoft To Do / Google Tasks require a registered
 * OAuth client to fully sign in, so they fall back to "open the service" plus
 * an access-token paste once the user has one.
 */
type IntegrationKind = 'token' | 'oauth'
interface IntegrationMeta {
  id: IntegrationId
  name: string
  initials: string
  kind: IntegrationKind
  /** false = shown grayed-out with "Coming soon" — only TickTick is wired up right now */
  active: boolean
  desc: string
  /** where to get a token / sign in */
  setupUrl: string
  setupLabel: string
  /** placeholder shown in the token input */
  tokenPlaceholder: string
}
const INTEGRATIONS: IntegrationMeta[] = [
  {
    id: 'ticktick',
    name: 'TickTick',
    initials: 'TT',
    kind: 'oauth',
    active: true,
    desc: 'OAuth sign-in — paste a TickTick access token once you have one, or open TickTick to manage your tasks.',
    setupUrl: 'https://developer.ticktick.com/',
    setupLabel: 'TickTick developer portal',
    tokenPlaceholder: 'Access token'
  },
  {
    id: 'todoist',
    name: 'Todoist',
    initials: 'TD',
    kind: 'token',
    active: false,
    desc: 'Connect with a personal API token to sync your Todoist tasks alongside your notes.',
    setupUrl: 'https://app.todoist.com/app/settings/integrations/developer',
    setupLabel: 'Get my Todoist token',
    tokenPlaceholder: 'Personal API token'
  },
  {
    id: 'microsoftTodo',
    name: 'Microsoft To Do',
    initials: 'MS',
    kind: 'oauth',
    active: false,
    desc: 'Microsoft Graph access token. Use the Graph Explorer to generate one for the Tasks.ReadWrite scope.',
    setupUrl: 'https://developer.microsoft.com/en-us/graph/graph-explorer',
    setupLabel: 'Open Graph Explorer',
    tokenPlaceholder: 'Graph access token'
  },
  {
    id: 'googleTasks',
    name: 'Google Tasks',
    initials: 'GT',
    kind: 'oauth',
    active: false,
    desc: 'Google OAuth access token with the Tasks scope. Paste a token from the OAuth Playground to connect.',
    setupUrl: 'https://developers.google.com/oauthplayground/',
    setupLabel: 'Open OAuth Playground',
    tokenPlaceholder: 'OAuth access token'
  },
  {
    id: 'notion',
    name: 'Notion',
    initials: 'No',
    kind: 'token',
    active: false,
    desc: 'Create an internal integration in Notion, share a database with it, and paste its secret here.',
    setupUrl: 'https://www.notion.so/my-integrations',
    setupLabel: 'Create a Notion integration',
    tokenPlaceholder: 'Internal integration secret'
  }
]

/**
 * TickTick has its own form because it's the only integration that's actually
 * wired up. It needs the user's registered app credentials (clientId +
 * clientSecret) and runs a full OAuth code-grant flow via the main process.
 */
function TickTickCard({
  status,
  onSaveClient,
  onConnect,
  onDisconnect
}: {
  status: import('@shared/types').TickTickStatus
  onSaveClient: (clientId: string, clientSecret: string) => Promise<void>
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
}): JSX.Element {
  const [clientId, setClientId] = useState(status.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const credsReady = !!(clientId.trim() && (clientSecret.trim() || status.clientSecretSet))
  const connected = status.connected

  return (
    <div className={clsx('integration-card', connected && 'connected')}>
      <div className="integration-head">
        <span className="integration-logo ticktick">TT</span>
        <h4 className="integration-title">TickTick</h4>
        <span className={clsx('integration-status', connected && 'connected')}>
          {connected ? 'Connected' : credsReady ? 'Ready to connect' : 'Setup required'}
        </span>
      </div>
      <p className="integration-desc">
        Register an app on the TickTick developer portal with redirect URI{' '}
        <code>http://localhost:23123/callback</code>, then paste the client ID and secret here
        and click <strong>Connect</strong> to sign in.
      </p>

      <div className="integration-field">
        <label>Client ID</label>
        <input
          type="text"
          placeholder="Client ID from developer.ticktick.com"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="integration-field">
        <label>Client secret</label>
        <input
          type="password"
          placeholder={status.clientSecretSet ? '•••• saved' : 'Client secret'}
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>

      <div className="integration-actions">
        <button
          className="btn sm"
          disabled={busy || (!clientId.trim() && !clientSecret.trim())}
          onClick={async () => {
            setBusy(true)
            try {
              await onSaveClient(clientId.trim(), clientSecret.trim())
              setClientSecret('')
            } finally {
              setBusy(false)
            }
          }}
        >
          Save credentials
        </button>
        <button
          className="btn primary sm"
          disabled={busy || !credsReady}
          onClick={async () => {
            // Persist any unsaved creds first so the OAuth flow can read them.
            if (clientId.trim() || clientSecret.trim()) {
              await onSaveClient(clientId.trim(), clientSecret.trim())
              setClientSecret('')
            }
            setBusy(true)
            try {
              await onConnect()
            } finally {
              setBusy(false)
            }
          }}
        >
          {connected ? 'Reconnect' : 'Connect via OAuth'}
        </button>
        {connected && (
          <button
            className="btn danger sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onDisconnect()
              } finally {
                setBusy(false)
              }
            }}
          >
            Disconnect
          </button>
        )}
      </div>
      <div className="integration-help">
        <a href="https://developer.ticktick.com/" target="_blank" rel="noreferrer">
          Open TickTick developer portal ↗
        </a>
      </div>
    </div>
  )
}

/** One card in the Integrations section — token input + connect/disconnect. */
function IntegrationCard({
  meta,
  status,
  onConnect,
  onDisconnect
}: {
  meta: IntegrationMeta
  status: IntegrationStatus
  onConnect: (token: string) => void
  onDisconnect: () => void
}): JSX.Element {
  const [token, setToken] = useState('')
  const connected = status.connected
  const disabled = !meta.active
  return (
    <div className={clsx('integration-card', connected && 'connected', disabled && 'inactive')}>
      <div className="integration-head">
        <span className={clsx('integration-logo', meta.id)}>{meta.initials}</span>
        <h4 className="integration-title">{meta.name}</h4>
        <span className={clsx('integration-status', connected && 'connected', disabled && 'inactive')}>
          {disabled ? 'Coming soon' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <p className="integration-desc">{meta.desc}</p>
      <div className="integration-actions">
        <input
          type="password"
          placeholder={meta.tokenPlaceholder}
          value={token}
          disabled={disabled}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !disabled && token.trim()) {
              onConnect(token.trim())
              setToken('')
            }
          }}
        />
        <button
          className="btn primary sm"
          disabled={disabled || !token.trim()}
          onClick={() => {
            onConnect(token.trim())
            setToken('')
          }}
        >
          {connected ? 'Update' : 'Connect'}
        </button>
        {connected && !disabled && (
          <button className="btn danger sm" onClick={onDisconnect} title="Disconnect">
            Disconnect
          </button>
        )}
      </div>
      <div className="integration-help">
        {disabled ? (
          <span>Not yet implemented — only TickTick can be connected for now.</span>
        ) : (
          <a href={meta.setupUrl} target="_blank" rel="noreferrer">
            {meta.setupLabel} ↗
          </a>
        )}
      </div>
    </div>
  )
}

/** A labelled settings row (label column + control column). */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="settings-row">
      <label className="settings-label">{label}</label>
      <div className="settings-control">
        {children}
        {hint && <span className="hint">{hint}</span>}
      </div>
    </div>
  )
}

/** A single toggle row (label left, checkbox right) used inside toggle lists. */
function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="settings-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export default function SettingsModal(): JSX.Element | null {
  const { t } = useTranslation()
  const show = useUi((s) => s.showSettings)
  const setShow = useUi((s) => s.setShowSettings)
  const setShowShortcuts = useUi((s) => s.setShowShortcuts)
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)

  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [ollamaUrlError, setOllamaUrlError] = useState('')
  const [tgToken, setTgToken] = useState('')
  const [defaultModels, setDefaultModels] = useState<string[]>([])
  const [shells, setShells] = useState<ShellSpec[]>(getShellSpecs())
  const [availableAgents, setAvailableAgents] = useState<Set<string>>(getAvailableAgents())
  const [snipName, setSnipName] = useState('')
  const [snipKind, setSnipKind] = useState<'prompt' | 'shell'>('prompt')
  const [snipBody, setSnipBody] = useState('')
  const [appVersion, setAppVersion] = useState('')

  // two-pane navigation + filtering
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('providers')
  const contentRef = useRef<HTMLDivElement>(null)
  const sectionEls = useRef<Record<string, HTMLElement | null>>({})
  const importRef = useRef<HTMLInputElement>(null)

  // WSL distros + agent availability are detected asynchronously.
  useEffect(() => {
    void refreshWslDistros().then(() => setShells(getShellSpecs()))
    void refreshAgentAvailability().then((s) => setAvailableAgents(new Set(s)))
    void window.api.getAppInfo().then((i) => setAppVersion(i.version)).catch(() => {})
  }, [])

  useEffect(() => {
    if (settings) setOllamaUrl(settings.providers.ollama.baseUrl)
  }, [settings])

  useEffect(() => {
    if (!settings) return
    const models = DEFAULT_MODELS[settings.defaultProvider]
    setDefaultModels(models)
    if (!settings.defaultModel || !models.includes(settings.defaultModel)) {
      void patch({ defaultModel: latestModel(settings.defaultProvider) })
    }
  }, [settings?.defaultProvider])

  if (!show || !settings) return null
  const prefs = settings.prefs

  // Map the stored default shell (binary + args) back to a spec id for the <select>.
  const currentShellId = ((): string => {
    if (!settings.defaultShell) return 'default'
    const argsKey = (settings.defaultShellArgs ?? []).join(' ')
    const m = shells.find(
      (s) => s.file === settings.defaultShell && (s.args ?? []).join(' ') === argsKey
    )
    return m?.id ?? 'default'
  })()

  // ---- helpers ----
  const setPref = (p: Partial<AppPrefs>): void => void patch({ prefs: p })

  const saveKey = (provider: ProviderId): void => {
    const key = keyInputs[provider]
    if (!key) return
    void patch({ providerKey: { provider, key } })
    setKeyInputs((s) => ({ ...s, [provider]: '' }))
  }
  const clearKey = (provider: ProviderId): void => void patch({ providerKey: { provider, key: null } })

  const snippets = prefs.snippets ?? []
  const addSnippet = (): void => {
    if (!snipName.trim() || !snipBody.trim()) return
    void patch({
      prefs: {
        snippets: [...snippets, { id: uid(), name: snipName.trim(), body: snipBody, kind: snipKind }]
      }
    })
    setSnipName('')
    setSnipBody('')
  }
  const removeSnippet = (id: string): void =>
    void patch({ prefs: { snippets: snippets.filter((s) => s.id !== id) } })

  const resetSection = (id: string): void => {
    const keys = SECTION_PREF_KEYS[id]
    if (keys) {
      const p: Record<string, unknown> = {}
      for (const k of keys) p[k] = DEFAULT_PREFS[k]
      void patch({ prefs: p as Partial<AppPrefs> })
    }
    if (id === 'appearance') void patch({ accentColor: '#4c8dff' })
  }

  const exportSettings = (): void => {
    const data = {
      _app: 'urterminal',
      version: 1,
      prefs: settings.prefs,
      accentColor: settings.accentColor,
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      defaultAgent: settings.defaultAgent,
      defaultShell: settings.defaultShell,
      defaultShellArgs: settings.defaultShellArgs
    }
    void window.api
      .saveFile({ defaultName: 'urterminal-settings.json', contents: JSON.stringify(data, null, 2) })
      .then((r) => {
        if (r.ok) toast('Settings exported', 'ok')
        else if (!r.canceled) toast(`Export failed: ${r.error ?? 'unknown error'}`, 'error')
      })
  }

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file) return
    const reader = new FileReader()
    reader.onload = (): void => {
      try {
        const d = JSON.parse(String(reader.result)) as Record<string, unknown>
        const p: SettingsPatch = {}
        if (d.prefs && typeof d.prefs === 'object') p.prefs = d.prefs as Partial<AppPrefs>
        if (typeof d.accentColor === 'string') p.accentColor = d.accentColor
        if (typeof d.defaultProvider === 'string') p.defaultProvider = d.defaultProvider as ProviderId
        if (typeof d.defaultModel === 'string') p.defaultModel = d.defaultModel
        if (typeof d.defaultAgent === 'string') p.defaultAgent = d.defaultAgent
        if (typeof d.defaultShell === 'string') p.defaultShell = d.defaultShell
        if (Array.isArray(d.defaultShellArgs)) p.defaultShellArgs = d.defaultShellArgs as string[]
        void patch(p)
        toast('Settings imported', 'ok')
      } catch {
        toast('Invalid settings file', 'error')
      }
    }
    reader.readAsText(file)
  }

  const resetAllData = (): void => {
    if (!window.confirm('Reset ALL settings and clear saved sessions/workspace? This cannot be undone.')) return
    void patch({
      prefs: { ...DEFAULT_PREFS },
      accentColor: '#4c8dff',
      defaultAgent: DEFAULT_AGENT,
      defaultShell: '',
      defaultShellArgs: []
    })
    try {
      localStorage.removeItem('urterminal.shortcuts.v1')
      localStorage.removeItem('urterminal.workspace.v1')
      localStorage.removeItem('urterminal.autoRestore')
    } catch {
      /* ignore */
    }
    void window.api.writeSessions([])
    void window.api.writeLastSession({ panes: {}, layout: null, transcripts: {}, savedAt: Date.now() })
    window.setTimeout(() => location.reload(), 200)
  }

  // ---- section metadata (sidebar nav + search filtering) ----
  const labels: Record<string, string[]> = {
    providers: [PROVIDER_LABELS.anthropic, PROVIDER_LABELS.openai, PROVIDER_LABELS.gemini, PROVIDER_LABELS.ollama],
    defaults: [t('settings.defaultProvider'), t('settings.defaultModel'), 'Default agent', 'Default terminal'],
    terminal: [
      'Cursor style', 'Cursor blink', 'Line height', 'Letter spacing', 'Scrollback',
      'Terminal padding', 'Scroll sensitivity', 'Terminal bell sound', 'Copy on select',
      'Paste on right-click', 'Show pane title bars'
    ],
    appearance: ['Theme', 'Terminal font', 'Font size', 'Accent Color'],
    behavior: [
      'Default shell folder', 'Auto-save interval', 'Max restored panes',
      'Confirm before closing a running pane', 'Focus new pane on create',
      'Reopen last workspace on launch', 'Clear workspace on exit'
    ],
    notifications: [
      'Desktop notification when an agent finishes', 'Play a sound when an agent finishes',
      'Only notify when window is unfocused', 'Notification sound', 'Notification volume'
    ],
    telegram: [t('settings.telegramToken'), t('settings.telegramDefaultChat'), 'Allowed chats'],
    integrations: ['Integrations', 'Todoist', 'TickTick', 'Microsoft To Do', 'Google Tasks', 'Notion'],
    snippets: ['Snippets'],
    keyboard: ['Keyboard shortcuts'],
    about: ['About', 'Version', 'Export settings', 'Import settings', 'Reset all data']
  }
  const SECTIONS: { id: string; title: string }[] = [
    { id: 'providers', title: t('settings.providers') },
    { id: 'defaults', title: t('settings.defaults') },
    { id: 'terminal', title: 'Terminal' },
    { id: 'appearance', title: t('settings.appearance') },
    { id: 'behavior', title: 'Behavior' },
    { id: 'notifications', title: 'Notifications' },
    { id: 'telegram', title: t('settings.telegram') },
    { id: 'integrations', title: 'Integrations' },
    { id: 'snippets', title: 'Snippets' },
    { id: 'keyboard', title: 'Keyboard' },
    { id: 'about', title: 'About' }
  ]

  const q = query.trim().toLowerCase()
  const match = (label: string): boolean => !q || label.toLowerCase().includes(q)
  const sectionVisible = (id: string, title: string): boolean =>
    !q || title.toLowerCase().includes(q) || (labels[id] ?? []).some((l) => l.toLowerCase().includes(q))
  const visibleSections = SECTIONS.filter((s) => sectionVisible(s.id, s.title))

  const goTo = (id: string): void => {
    setActive(id)
    const root = contentRef.current
    const el = sectionEls.current[id]
    if (root && el) root.scrollTop = el.offsetTop
  }
  const onScroll = (): void => {
    const root = contentRef.current
    if (!root) return
    const y = root.scrollTop + 24
    let current = visibleSections[0]?.id
    for (const s of visibleSections) {
      const el = sectionEls.current[s.id]
      if (el && el.offsetTop <= y) current = s.id
    }
    if (current && current !== active) setActive(current)
  }
  const sectionRef = (id: string) => (el: HTMLElement | null): void => {
    sectionEls.current[id] = el
  }

  /** Section <h3> with an optional per-section reset button. */
  const Head = ({ id, title }: { id: string; title: string }): JSX.Element => (
    <div className="settings-section-head">
      <h3>{title}</h3>
      {SECTION_PREF_KEYS[id] && (
        <button className="btn ghost sm settings-reset" title="Reset this section to defaults" onClick={() => resetSection(id)}>
          <RotateCcw size={11} /> Reset
        </button>
      )}
    </div>
  )

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>

        <div className="settings-layout">
          <aside className="settings-nav">
            <div className="settings-search">
              <Search size={13} />
              <input
                className="settings-search-input"
                placeholder="Search settings…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <nav className="settings-nav-list">
              {SECTIONS.map((s) => {
                const dim = !visibleSections.some((v) => v.id === s.id)
                return (
                  <button
                    key={s.id}
                    className={clsx('settings-nav-item', active === s.id && 'active', dim && 'dim')}
                    onClick={() => goTo(s.id)}
                  >
                    {s.title}
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className="settings-content" ref={contentRef} onScroll={onScroll}>
            {visibleSections.length === 0 && (
              <p className="settings-empty">No settings match “{query}”.</p>
            )}

            {/* Providers */}
            {sectionVisible('providers', t('settings.providers')) && (
              <section className="settings-section" ref={sectionRef('providers')}>
                <Head id="providers" title={t('settings.providers')} />
                {KEY_PROVIDERS.map((p) => {
                  const meta = settings.providers[p]
                  if (!match(PROVIDER_LABELS[p])) return null
                  return (
                    <div className="settings-row" key={p}>
                      <label className="settings-label">{PROVIDER_LABELS[p]}</label>
                      <div className="settings-control">
                        <input
                          className="input"
                          type="password"
                          placeholder={meta.keySet ? `•••• ${meta.keyPreview ?? ''}` : t('settings.apiKey')}
                          value={keyInputs[p] ?? ''}
                          onChange={(e) => setKeyInputs((s) => ({ ...s, [p]: e.target.value }))}
                        />
                        <div className="settings-actions">
                          <KeyStatus set={meta.keySet} />
                          <button className="btn primary" onClick={() => saveKey(p)} disabled={!keyInputs[p]}>
                            {t('settings.save')}
                          </button>
                          <button className="btn danger" onClick={() => clearKey(p)} disabled={!meta.keySet}>
                            {t('settings.clear')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {match(PROVIDER_LABELS.ollama) && (
                  <Row label={PROVIDER_LABELS.ollama}>
                    <input
                      className={clsx('input', ollamaUrlError && 'input-error')}
                      value={ollamaUrl}
                      placeholder={t('settings.baseUrl')}
                      onChange={(e) => { setOllamaUrl(e.target.value); setOllamaUrlError('') }}
                      onBlur={() => {
                        if (!ollamaUrl) { patch({ ollamaBaseUrl: ollamaUrl }); return }
                        try {
                          const u = new URL(ollamaUrl)
                          if (!u.protocol.startsWith('http')) throw new Error()
                          setOllamaUrlError('')
                          patch({ ollamaBaseUrl: ollamaUrl })
                        } catch {
                          setOllamaUrlError('Must be a valid http:// or https:// URL')
                        }
                      }}
                    />
                    {ollamaUrlError && <span className="hint fail">{ollamaUrlError}</span>}
                  </Row>
                )}
              </section>
            )}

            {/* Defaults */}
            {sectionVisible('defaults', t('settings.defaults')) && (
              <section className="settings-section" ref={sectionRef('defaults')}>
                <Head id="defaults" title={t('settings.defaults')} />
                {match(t('settings.defaultProvider')) && (
                  <Row label={t('settings.defaultProvider')}>
                    <select
                      className="select"
                      value={settings.defaultProvider}
                      onChange={(e) => patch({ defaultProvider: e.target.value as ProviderId, defaultModel: '' })}
                    >
                      {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
                        <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                      ))}
                    </select>
                  </Row>
                )}
                {match(t('settings.defaultModel')) && (
                  <Row label={t('settings.defaultModel')} hint="Defaults to the latest model; updates as new ones ship.">
                    <select
                      className="select"
                      value={settings.defaultModel}
                      onChange={(e) => patch({ defaultModel: e.target.value })}
                    >
                      {!defaultModels.includes(settings.defaultModel) && settings.defaultModel && (
                        <option value={settings.defaultModel}>{settings.defaultModel}</option>
                      )}
                      {defaultModels.map((m, i) => (
                        <option key={m} value={m}>{m}{i === 0 ? ' — latest' : ''}</option>
                      ))}
                    </select>
                  </Row>
                )}
                {match('Default agent') && (
                  <Row label="Default agent" hint="New AI panes launch this CLI by default.">
                    <select className="select" value={settings.defaultAgent} onChange={(e) => patch({ defaultAgent: e.target.value })}>
                      {AGENTS.map((a) => {
                        const unavailable = availableAgents.size > 0 && !availableAgents.has(a)
                        return <option key={a} value={a} disabled={unavailable}>{AGENT_LABELS[a]}</option>
                      })}
                    </select>
                  </Row>
                )}
                {match('Default terminal') && (
                  <Row label="Default terminal" hint="New shell panes launch this by default.">
                    <select
                      className="select"
                      value={currentShellId}
                      onChange={(e) => {
                        if (e.target.value === 'default') { void patch({ defaultShell: '', defaultShellArgs: [] }); return }
                        const spec = shells.find((s) => s.id === e.target.value)
                        if (spec) void patch({ defaultShell: spec.file, defaultShellArgs: spec.args ?? [] })
                      }}
                    >
                      <option value="default">OS default</option>
                      {shells.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </Row>
                )}
              </section>
            )}

            {/* Terminal */}
            {sectionVisible('terminal', 'Terminal') && (
              <section className="settings-section" ref={sectionRef('terminal')}>
                <Head id="terminal" title="Terminal" />
                {match('Cursor style') && (
                  <Row label="Cursor style">
                    <select className="select" value={prefs.cursorStyle} onChange={(e) => setPref({ cursorStyle: e.target.value as AppPrefs['cursorStyle'] })}>
                      <option value="block">Block</option>
                      <option value="bar">Bar</option>
                      <option value="underline">Underline</option>
                    </select>
                  </Row>
                )}
                {match('Line height') && (
                  <Row label="Line height" hint="1.0 = default">
                    <input className="input" type="number" min={0.8} max={2.5} step={0.05} value={prefs.lineHeight}
                      onChange={(e) => setPref({ lineHeight: Number(e.target.value) || 1 })} />
                  </Row>
                )}
                {match('Letter spacing') && (
                  <Row label="Letter spacing" hint="px">
                    <input className="input" type="number" min={-2} max={8} step={0.5} value={prefs.letterSpacing}
                      onChange={(e) => setPref({ letterSpacing: Number(e.target.value) || 0 })} />
                  </Row>
                )}
                {match('Scrollback') && (
                  <Row label="Scrollback" hint="lines kept in the scroll buffer">
                    <input className="input" type="number" min={100} max={200000} step={500} value={prefs.scrollback}
                      onChange={(e) => setPref({ scrollback: Math.max(100, Number(e.target.value) || 5000) })} />
                  </Row>
                )}
                {match('Terminal padding') && (
                  <Row label="Terminal padding" hint="px around terminal contents">
                    <input className="input" type="number" min={0} max={40} step={1} value={prefs.terminalPadding}
                      onChange={(e) => setPref({ terminalPadding: Math.max(0, Number(e.target.value) || 0) })} />
                  </Row>
                )}
                {match('Scroll sensitivity') && (
                  <Row label="Scroll sensitivity" hint="mouse-wheel speed multiplier">
                    <input className="input" type="number" min={1} max={10} step={1} value={prefs.scrollSensitivity}
                      onChange={(e) => setPref({ scrollSensitivity: Math.max(1, Number(e.target.value) || 1) })} />
                  </Row>
                )}
                <div className="settings-toggle-list">
                  {match('Cursor blink') && <Toggle label="Cursor blink" checked={prefs.cursorBlink} onChange={(v) => setPref({ cursorBlink: v })} />}
                  {match('Terminal bell sound') && <Toggle label="Terminal bell sound" checked={prefs.terminalBell} onChange={(v) => setPref({ terminalBell: v })} />}
                  {match('Copy on select') && <Toggle label="Copy on select" checked={prefs.copyOnSelect} onChange={(v) => setPref({ copyOnSelect: v })} />}
                  {match('Paste on right-click') && <Toggle label="Paste on right-click" checked={prefs.pasteOnRightClick} onChange={(v) => setPref({ pasteOnRightClick: v })} />}
                  {match('Show pane title bars') && <Toggle label="Show pane title bars" checked={prefs.showPaneHeaders} onChange={(v) => setPref({ showPaneHeaders: v })} />}
                </div>
              </section>
            )}

            {/* Appearance */}
            {sectionVisible('appearance', t('settings.appearance')) && (
              <section className="settings-section" ref={sectionRef('appearance')}>
                <Head id="appearance" title={t('settings.appearance')} />
                {match('Theme') && (
                  <Row label="Theme" hint="Terminals stay dark; “System” follows your OS.">
                    <select className="select" value={prefs.appTheme} onChange={(e) => setPref({ appTheme: e.target.value })}>
                      {THEME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Row>
                )}
                {match('Terminal font') && (
                  <Row label="Terminal font" hint="Font family for all terminals.">
                    <select className="select" value={prefs.fontFamily} onChange={(e) => setPref({ fontFamily: e.target.value })}>
                      {!FONT_OPTIONS.some((f) => f.value === prefs.fontFamily) && prefs.fontFamily && (
                        <option value={prefs.fontFamily}>{prefs.fontFamily} (custom)</option>
                      )}
                      {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </Row>
                )}
                {match('Font size') && (
                  <Row label="Font size">
                    <select className="select" value={prefs.fontSize || 13} onChange={(e) => setPref({ fontSize: Number(e.target.value) })}>
                      {[10, 11, 12, 13, 14, 15, 16, 18, 20].map((n) => <option key={n} value={n}>{n}px</option>)}
                    </select>
                  </Row>
                )}
                {match('Accent Color') && (
                  <Row label="Accent Color" hint="Changes the UI accent color globally.">
                    <div className="color-picker-row">
                      {ACCENT_PRESETS.map((p) => (
                        <button key={p.value} className={clsx('color-swatch', settings.accentColor === p.value && 'active')}
                          style={{ background: p.value }} onClick={() => patch({ accentColor: p.value })} title={p.label} />
                      ))}
                      <label className="color-custom-label" title="Custom color">
                        <input type="color" value={settings.accentColor || '#4c8dff'}
                          onChange={(e) => patch({ accentColor: e.target.value })} className="color-custom-input" />
                        <span className={clsx('color-swatch', 'color-custom-preview', !ACCENT_PRESETS.some((p) => p.value === settings.accentColor) && 'active')}
                          style={{ background: settings.accentColor || '#4c8dff' }}>
                          <span className="color-custom-plus">+</span>
                        </span>
                      </label>
                    </div>
                  </Row>
                )}
              </section>
            )}

            {/* Behavior */}
            {sectionVisible('behavior', 'Behavior') && (
              <section className="settings-section" ref={sectionRef('behavior')}>
                <Head id="behavior" title="Behavior" />
                {match('Default shell folder') && (
                  <Row label="Default shell folder" hint="New shell panes open here (empty = home).">
                    <input className="input mono" placeholder="e.g. F:\\projects" defaultValue={prefs.defaultShellCwd}
                      onBlur={(e) => setPref({ defaultShellCwd: e.target.value.trim() })} />
                  </Row>
                )}
                {match('Auto-save interval') && (
                  <Row label="Auto-save interval" hint="seconds between workspace auto-saves">
                    <input className="input" type="number" min={1} max={120} step={1} value={prefs.autoSaveSeconds}
                      onChange={(e) => setPref({ autoSaveSeconds: Math.max(1, Number(e.target.value) || 1) })} />
                  </Row>
                )}
                {match('Max restored panes') && (
                  <Row label="Max restored panes" hint="0 = no limit">
                    <input className="input" type="number" min={0} max={9} step={1} value={prefs.maxRestorePanes}
                      onChange={(e) => setPref({ maxRestorePanes: Math.max(0, Number(e.target.value) || 0) })} />
                  </Row>
                )}
                <div className="settings-toggle-list">
                  {match('Confirm before closing a running pane') && <Toggle label="Confirm before closing a running pane" checked={prefs.confirmClose} onChange={(v) => setPref({ confirmClose: v })} />}
                  {match('Focus new pane on create') && <Toggle label="Focus new pane on create" checked={prefs.focusNewPane} onChange={(v) => setPref({ focusNewPane: v })} />}
                  {match('Reopen last workspace on launch') && <Toggle label="Reopen last workspace on launch" checked={prefs.autoRestore} onChange={(v) => setPref({ autoRestore: v })} />}
                  {match('Clear workspace on exit') && <Toggle label="Clear workspace on exit" checked={prefs.clearWorkspaceOnExit} onChange={(v) => setPref({ clearWorkspaceOnExit: v })} />}
                </div>
              </section>
            )}

            {/* Notifications */}
            {sectionVisible('notifications', 'Notifications') && (
              <section className="settings-section" ref={sectionRef('notifications')}>
                <Head id="notifications" title="Notifications" />
                <div className="settings-toggle-list">
                  {match('Desktop notification when an agent finishes') && <Toggle label="Desktop notification when an agent finishes" checked={prefs.notifyOnDone} onChange={(v) => setPref({ notifyOnDone: v })} />}
                  {match('Play a sound when an agent finishes') && <Toggle label="Play a sound when an agent finishes" checked={prefs.notifySound} onChange={(v) => setPref({ notifySound: v })} />}
                  {match('Only notify when window is unfocused') && <Toggle label="Only notify when window is unfocused" checked={prefs.notifyOnlyUnfocused} onChange={(v) => setPref({ notifyOnlyUnfocused: v })} />}
                </div>
                {match('Notification sound') && (
                  <Row label="Notification sound">
                    <select className="select" value={prefs.notifySoundName} onChange={(e) => setPref({ notifySoundName: e.target.value as AppPrefs['notifySoundName'] })}>
                      <option value="chime">Chime</option>
                      <option value="beep">Beep</option>
                    </select>
                  </Row>
                )}
                {match('Notification volume') && (
                  <Row label="Notification volume" hint={`${prefs.notifyVolume}%`}>
                    <input className="input" type="range" min={0} max={100} step={5} value={prefs.notifyVolume}
                      onChange={(e) => setPref({ notifyVolume: Number(e.target.value) })} />
                  </Row>
                )}
              </section>
            )}

            {/* Telegram */}
            {sectionVisible('telegram', t('settings.telegram')) && (
              <section className="settings-section" ref={sectionRef('telegram')}>
                <Head id="telegram" title={t('settings.telegram')} />
                {match(t('settings.telegramToken')) && (
                  <div className="settings-row">
                    <label className="settings-label">{t('settings.telegramToken')}</label>
                    <div className="settings-control">
                      <input
                        className="input"
                        type="password"
                        placeholder={settings.telegram.tokenSet ? `•••• ${settings.telegram.tokenPreview ?? ''}` : t('settings.telegramToken')}
                        value={tgToken}
                        onChange={(e) => setTgToken(e.target.value)}
                      />
                      <div className="settings-actions">
                        <KeyStatus set={settings.telegram.tokenSet} />
                        <button className="btn primary" disabled={!tgToken} onClick={() => { void patch({ telegramToken: tgToken }); setTgToken('') }}>
                          {t('settings.save')}
                        </button>
                        <button className="btn danger" disabled={!settings.telegram.tokenSet} onClick={() => patch({ telegramToken: null })}>
                          {t('settings.clear')}
                        </button>
                        <button className="btn" onClick={() => window.api.restartTelegram().catch(() => {})}>
                          {t('settings.restart')}
                        </button>
                        <button
                          className="btn"
                          disabled={!settings.telegram.running}
                          onClick={() =>
                            void window.api.testTelegram().then((r) =>
                              toast(r.ok ? 'Test message sent' : `Test failed: ${r.error ?? 'unknown'}`, r.ok ? 'ok' : 'error')
                            )
                          }
                        >
                          Send test
                        </button>
                      </div>
                      <span className={'hint ' + (settings.telegram.running ? 'ok' : '')}>
                        {t('settings.telegramStatus')}:{' '}
                        {settings.telegram.running
                          ? `${t('settings.telegramRunning')}${settings.telegram.botUsername ? ` · @${settings.telegram.botUsername}` : ''}`
                          : t('settings.telegramStopped')}
                      </span>
                      {settings.telegram.error && !settings.telegram.running && (
                        <span className="hint fail">⚠ {settings.telegram.error}</span>
                      )}
                    </div>
                  </div>
                )}
                {match(t('settings.telegramDefaultChat')) && (
                  <Row label={t('settings.telegramDefaultChat')}>
                    <input className="input" defaultValue={settings.telegram.defaultChatId ?? ''}
                      onBlur={(e) => patch({ telegramDefaultChatId: e.target.value || null })} />
                  </Row>
                )}
                {match('Allowed chats') && (
                  <Row label="Allowed chats" hint="Only these chat IDs may control the app (one per line). Empty = allow any chat.">
                    <textarea
                      className="input mono"
                      rows={3}
                      defaultValue={(settings.prefs.telegramChatWhitelist ?? []).join('\n')}
                      placeholder="One chat ID per line"
                      onBlur={(e) => {
                        const ids = Array.from(new Set(e.target.value.split(/[\s,]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v))))
                        patch({ prefs: { telegramChatWhitelist: ids } })
                      }}
                    />
                  </Row>
                )}
              </section>
            )}

            {/* Integrations — connect external to-do services */}
            {sectionVisible('integrations', 'Integrations') && (
              <section className="settings-section" ref={sectionRef('integrations')}>
                <h3>Integrations</h3>
                <span className="hint settings-block-hint">
                  Connect your favourite to-do services. Tokens are encrypted on disk
                  via the OS keychain and never leave this machine.
                </span>
                <div className="integrations-grid">
                  {INTEGRATIONS.map((meta) => {
                    if (meta.id === 'ticktick') {
                      const tt = settings.integrations?.ticktick ?? {
                        connected: false,
                        clientSecretSet: false
                      }
                      return (
                        <TickTickCard
                          key={meta.id}
                          status={tt}
                          onSaveClient={async (clientId, clientSecret) => {
                            const p: SettingsPatch = {}
                            if (clientId) p.tickTickClientId = clientId
                            if (clientSecret) p.tickTickClientSecret = clientSecret
                            if (Object.keys(p).length) await patch(p)
                          }}
                          onConnect={async () => {
                            try {
                              await window.api.tickTickConnect()
                              toast('TickTick connected', 'ok')
                            } catch (e) {
                              toast(`TickTick connect failed: ${(e as Error).message}`, 'error')
                            }
                          }}
                          onDisconnect={async () => {
                            try {
                              await window.api.tickTickDisconnect()
                              toast('TickTick disconnected', 'info')
                            } catch (e) {
                              toast(`Disconnect failed: ${(e as Error).message}`, 'error')
                            }
                          }}
                        />
                      )
                    }
                    return (
                      <IntegrationCard
                        key={meta.id}
                        meta={meta}
                        status={settings.integrations?.[meta.id] ?? { connected: false }}
                        onConnect={(token) => {
                          void patch({ integrationToken: { id: meta.id, token } })
                          toast(`${meta.name} connected`, 'ok')
                        }}
                        onDisconnect={() => {
                          void patch({ integrationToken: { id: meta.id, token: null } })
                          toast(`${meta.name} disconnected`, 'info')
                        }}
                      />
                    )
                  })}
                </div>
              </section>
            )}

            {/* Snippets */}
            {sectionVisible('snippets', 'Snippets') && (
              <section className="settings-section" ref={sectionRef('snippets')}>
                <h3>Snippets</h3>
                <span className="hint settings-block-hint">
                  Reusable prompts / commands; insert into the active pane from the command palette.
                  Use <code>{'{{name}}'}</code> for fill-in variables.
                </span>
                {snippets.length > 0 && (
                  <div className="snippet-list">
                    {snippets.map((s) => (
                      <div className="snippet-item" key={s.id}>
                        <div className="snippet-item-head">
                          <span className={clsx('snippet-kind', s.kind)}>{s.kind}</span>
                          <span className="snippet-name">{s.name}</span>
                          <button className="icon-btn danger snippet-del" title={t('settings.clear')} onClick={() => removeSnippet(s.id)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <pre className="snippet-preview">{s.body}</pre>
                      </div>
                    ))}
                  </div>
                )}
                <div className="snippet-add">
                  <div className="snippet-add-row">
                    <input className="input" placeholder="Snippet name" value={snipName} onChange={(e) => setSnipName(e.target.value)} />
                    <select className="select snippet-add-kind" value={snipKind} onChange={(e) => setSnipKind(e.target.value as 'prompt' | 'shell')}>
                      <option value="prompt">prompt</option>
                      <option value="shell">shell</option>
                    </select>
                  </div>
                  <textarea className="input mono" rows={3} placeholder="Body — e.g. Review {{file}} for bugs" value={snipBody} onChange={(e) => setSnipBody(e.target.value)} />
                  <div className="settings-actions">
                    <button className="btn primary" onClick={addSnippet} disabled={!snipName.trim() || !snipBody.trim()}>Add snippet</button>
                  </div>
                </div>
              </section>
            )}

            {/* Keyboard */}
            {sectionVisible('keyboard', 'Keyboard') && (
              <section className="settings-section" ref={sectionRef('keyboard')}>
                <h3>Keyboard</h3>
                <span className="hint settings-block-hint">
                  View and remap every shortcut, with per-key reset and a restore-defaults button.
                </span>
                <button className="btn" onClick={() => setShowShortcuts(true)}>
                  <Keyboard size={13} /> Open shortcuts editor
                </button>
              </section>
            )}

            {/* About */}
            {sectionVisible('about', 'About') && (
              <section className="settings-section" ref={sectionRef('about')}>
                <h3>About</h3>
                <Row label="Version">
                  <span className="settings-static">URterminal {appVersion || '—'}</span>
                </Row>
                <Row label="Settings file">
                  <div className="settings-actions">
                    <button className="btn" onClick={exportSettings}><Download size={13} /> Export…</button>
                    <button className="btn" onClick={() => importRef.current?.click()}><Upload size={13} /> Import…</button>
                    <input ref={importRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />
                  </div>
                </Row>
                <Row label="Reset" hint="Restore all settings to defaults and clear saved sessions/workspace.">
                  <div className="settings-actions">
                    <button className="btn danger" onClick={resetAllData}><Trash2 size={13} /> Reset all data</button>
                  </div>
                </Row>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
