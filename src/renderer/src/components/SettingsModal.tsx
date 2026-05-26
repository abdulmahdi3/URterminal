import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Check, Search, Trash2 } from 'lucide-react'
import type { ProviderId } from '@shared/types'
import { PROVIDER_LABELS, DEFAULT_MODELS, AGENTS, AGENT_LABELS, latestModel } from '@shared/providers'
import { uid } from '@renderer/lib/snippets'
import { SUPPORTED_LANGUAGES } from '@renderer/i18n/i18n'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
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

type KeyProvider = 'anthropic' | 'openai' | 'gemini'
const KEY_PROVIDERS: KeyProvider[] = ['anthropic', 'openai', 'gemini']

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

export default function SettingsModal(): JSX.Element | null {
  const { t } = useTranslation()
  const show = useUi((s) => s.showSettings)
  const setShow = useUi((s) => s.setShowSettings)
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

  // two-pane navigation + filtering
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('providers')
  const contentRef = useRef<HTMLDivElement>(null)
  const sectionEls = useRef<Record<string, HTMLElement | null>>({})

  // WSL distros + agent availability are detected asynchronously.
  useEffect(() => {
    void refreshWslDistros().then(() => setShells(getShellSpecs()))
    void refreshAgentAvailability().then((s) => setAvailableAgents(new Set(s)))
  }, [])

  useEffect(() => {
    if (settings) setOllamaUrl(settings.providers.ollama.baseUrl)
  }, [settings])

  useEffect(() => {
    if (!settings) return
    const models = DEFAULT_MODELS[settings.defaultProvider]
    setDefaultModels(models)
    // Keep the default model up to date: if none chosen or it's no longer a known
    // model for this provider, snap to the latest (top of the list).
    if (!settings.defaultModel || !models.includes(settings.defaultModel)) {
      void patch({ defaultModel: latestModel(settings.defaultProvider) })
    }
  }, [settings?.defaultProvider])

  if (!show || !settings) return null

  // Map the stored default shell (binary + args) back to a spec id for the <select>.
  const currentShellId = ((): string => {
    if (!settings.defaultShell) return 'default'
    const argsKey = (settings.defaultShellArgs ?? []).join(' ')
    const match = shells.find(
      (s) => s.file === settings.defaultShell && (s.args ?? []).join(' ') === argsKey
    )
    return match?.id ?? 'default'
  })()

  const saveKey = (provider: ProviderId): void => {
    const key = keyInputs[provider]
    if (!key) return
    void patch({ providerKey: { provider, key } })
    setKeyInputs((s) => ({ ...s, [provider]: '' }))
  }
  const clearKey = (provider: ProviderId): void =>
    void patch({ providerKey: { provider, key: null } })

  const snippets = settings.prefs.snippets ?? []
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

  // ---- section metadata (drives the sidebar nav + search filtering) ----
  const labels = {
    providers: [PROVIDER_LABELS.anthropic, PROVIDER_LABELS.openai, PROVIDER_LABELS.gemini, PROVIDER_LABELS.ollama],
    telegram: [t('settings.telegramToken'), t('settings.telegramDefaultChat'), 'Allowed chats'],
    defaults: [t('settings.defaultProvider'), t('settings.defaultModel'), 'Default agent', 'Default terminal'],
    notifications: [
      'Desktop notification when an agent finishes',
      'Play a sound when an agent finishes',
      'Send a Telegram message when a linked pane finishes'
    ],
    startup: ['Reopen the last workspace (panes + layout) on launch'],
    snippets: ['Snippets'],
    appearance: ['Terminal font', 'Font size', t('settings.language'), 'Accent Color']
  }
  const SECTIONS: { id: keyof typeof labels; title: string }[] = [
    { id: 'providers', title: t('settings.providers') },
    { id: 'telegram', title: t('settings.telegram') },
    { id: 'defaults', title: t('settings.defaults') },
    { id: 'notifications', title: 'Notifications' },
    { id: 'startup', title: 'Startup' },
    { id: 'snippets', title: 'Snippets' },
    { id: 'appearance', title: t('settings.appearance') }
  ]

  const q = query.trim().toLowerCase()
  const match = (label: string): boolean => !q || label.toLowerCase().includes(q)
  const sectionVisible = (id: keyof typeof labels, title: string): boolean =>
    !q || title.toLowerCase().includes(q) || labels[id].some((l) => l.toLowerCase().includes(q))

  const visibleSections = SECTIONS.filter((s) => sectionVisible(s.id, s.title))

  // Jump the content panel to a section (instant — no smooth scroll by convention).
  const goTo = (id: string): void => {
    setActive(id)
    const root = contentRef.current
    const el = sectionEls.current[id]
    if (root && el) root.scrollTop = el.offsetTop
  }
  // Scroll-spy: highlight the section currently at the top of the content panel.
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

  const sectionRef =
    (id: string) =>
    (el: HTMLElement | null): void => {
      sectionEls.current[id] = el
    }

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
          {/* ---- sidebar: search + section tabs ---- */}
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

          {/* ---- scrollable content ---- */}
          <div className="settings-content" ref={contentRef} onScroll={onScroll}>
            {visibleSections.length === 0 && (
              <p className="settings-empty">No settings match “{query}”.</p>
            )}

            {/* Providers */}
            {sectionVisible('providers', t('settings.providers')) && (
              <section className="settings-section" ref={sectionRef('providers')}>
                <h3>{t('settings.providers')}</h3>
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
                  <div className="settings-row">
                    <label className="settings-label">{PROVIDER_LABELS.ollama}</label>
                    <div className="settings-control">
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
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Telegram */}
            {sectionVisible('telegram', t('settings.telegram')) && (
              <section className="settings-section" ref={sectionRef('telegram')}>
                <h3>{t('settings.telegram')}</h3>
                {match(t('settings.telegramToken')) && (
                  <div className="settings-row">
                    <label className="settings-label">{t('settings.telegramToken')}</label>
                    <div className="settings-control">
                      <input
                        className="input"
                        type="password"
                        placeholder={
                          settings.telegram.tokenSet
                            ? `•••• ${settings.telegram.tokenPreview ?? ''}`
                            : t('settings.telegramToken')
                        }
                        value={tgToken}
                        onChange={(e) => setTgToken(e.target.value)}
                      />
                      <div className="settings-actions">
                        <KeyStatus set={settings.telegram.tokenSet} />
                        <button
                          className="btn primary"
                          disabled={!tgToken}
                          onClick={() => {
                            void patch({ telegramToken: tgToken })
                            setTgToken('')
                          }}
                        >
                          {t('settings.save')}
                        </button>
                        <button
                          className="btn danger"
                          disabled={!settings.telegram.tokenSet}
                          onClick={() => patch({ telegramToken: null })}
                        >
                          {t('settings.clear')}
                        </button>
                        <button className="btn" onClick={() => window.api.restartTelegram().catch(() => {})}>
                          {t('settings.restart')}
                        </button>
                      </div>
                      <span className={'hint ' + (settings.telegram.running ? 'ok' : '')}>
                        {t('settings.telegramStatus')}:{' '}
                        {settings.telegram.running ? t('settings.telegramRunning') : t('settings.telegramStopped')}
                      </span>
                    </div>
                  </div>
                )}
                {match(t('settings.telegramDefaultChat')) && (
                  <div className="settings-row">
                    <label className="settings-label">{t('settings.telegramDefaultChat')}</label>
                    <div className="settings-control">
                      <input
                        className="input"
                        defaultValue={settings.telegram.defaultChatId ?? ''}
                        onBlur={(e) => patch({ telegramDefaultChatId: e.target.value || null })}
                      />
                    </div>
                  </div>
                )}
                {match('Allowed chats') && (
                  <div className="settings-row">
                    <label className="settings-label">Allowed chats</label>
                    <div className="settings-control">
                      <textarea
                        className="input mono"
                        rows={3}
                        defaultValue={(settings.prefs.telegramChatWhitelist ?? []).join('\n')}
                        placeholder="One chat ID per line"
                        onBlur={(e) => {
                          const ids = Array.from(
                            new Set(
                              e.target.value
                                .split(/[\s,]+/)
                                .map((v) => v.trim())
                                .filter((v) => /^-?\d+$/.test(v))
                            )
                          )
                          patch({ prefs: { telegramChatWhitelist: ids } })
                        }}
                      />
                      <span className="hint">
                        Only these chat IDs may control the app (one per line). Empty = allow any chat
                        that messages the bot.
                      </span>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Defaults */}
            {sectionVisible('defaults', t('settings.defaults')) && (
              <section className="settings-section" ref={sectionRef('defaults')}>
                <h3>{t('settings.defaults')}</h3>
                {match(t('settings.defaultProvider')) && (
                  <div className="settings-row">
                    <label className="settings-label">{t('settings.defaultProvider')}</label>
                    <div className="settings-control">
                      <select
                        className="select"
                        value={settings.defaultProvider}
                        onChange={(e) => patch({ defaultProvider: e.target.value as ProviderId, defaultModel: '' })}
                      >
                        {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
                          <option key={p} value={p}>
                            {PROVIDER_LABELS[p]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {match(t('settings.defaultModel')) && (
                  <div className="settings-row">
                    <label className="settings-label">{t('settings.defaultModel')}</label>
                    <div className="settings-control">
                      <select
                        className="select"
                        value={settings.defaultModel}
                        onChange={(e) => patch({ defaultModel: e.target.value })}
                      >
                        {!defaultModels.includes(settings.defaultModel) && settings.defaultModel && (
                          <option value={settings.defaultModel}>{settings.defaultModel}</option>
                        )}
                        {defaultModels.map((m, i) => (
                          <option key={m} value={m}>
                            {m}
                            {i === 0 ? ' — latest' : ''}
                          </option>
                        ))}
                      </select>
                      <span className="hint">Defaults to the latest model; updates as new ones ship.</span>
                    </div>
                  </div>
                )}
                {match('Default agent') && (
                  <div className="settings-row">
                    <label className="settings-label">Default agent</label>
                    <div className="settings-control">
                      <select
                        className="select"
                        value={settings.defaultAgent}
                        onChange={(e) => patch({ defaultAgent: e.target.value })}
                      >
                        {AGENTS.map((a) => {
                          const unavailable = availableAgents.size > 0 && !availableAgents.has(a)
                          return (
                            <option key={a} value={a} disabled={unavailable}>
                              {AGENT_LABELS[a]}
                            </option>
                          )
                        })}
                      </select>
                      <span className="hint">New AI panes launch this CLI by default.</span>
                    </div>
                  </div>
                )}
                {match('Default terminal') && (
                  <div className="settings-row">
                    <label className="settings-label">Default terminal</label>
                    <div className="settings-control">
                      <select
                        className="select"
                        value={currentShellId}
                        onChange={(e) => {
                          if (e.target.value === 'default') {
                            void patch({ defaultShell: '', defaultShellArgs: [] })
                            return
                          }
                          const spec = shells.find((s) => s.id === e.target.value)
                          if (spec) void patch({ defaultShell: spec.file, defaultShellArgs: spec.args ?? [] })
                        }}
                      >
                        <option value="default">OS default</option>
                        {shells.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <span className="hint">New shell panes launch this by default.</span>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Notifications */}
            {sectionVisible('notifications', 'Notifications') && (
              <section className="settings-section" ref={sectionRef('notifications')}>
                <h3>Notifications</h3>
                <div className="settings-toggle-list">
                  {match(labels.notifications[0]) && (
                    <label className="settings-toggle">
                      <span>{labels.notifications[0]}</span>
                      <input
                        type="checkbox"
                        checked={!!settings.prefs.notifyOnDone}
                        onChange={(e) => patch({ prefs: { notifyOnDone: e.target.checked } })}
                      />
                    </label>
                  )}
                  {match(labels.notifications[1]) && (
                    <label className="settings-toggle">
                      <span>{labels.notifications[1]}</span>
                      <input
                        type="checkbox"
                        checked={!!settings.prefs.notifySound}
                        onChange={(e) => patch({ prefs: { notifySound: e.target.checked } })}
                      />
                    </label>
                  )}
                  {match(labels.notifications[2]) && (
                    <label className="settings-toggle">
                      <span>{labels.notifications[2]}</span>
                      <input
                        type="checkbox"
                        checked={!!settings.prefs.telegramNotifyOnDone}
                        onChange={(e) => patch({ prefs: { telegramNotifyOnDone: e.target.checked } })}
                      />
                    </label>
                  )}
                </div>
              </section>
            )}

            {/* Startup */}
            {sectionVisible('startup', 'Startup') && (
              <section className="settings-section" ref={sectionRef('startup')}>
                <h3>Startup</h3>
                <div className="settings-toggle-list">
                  <label className="settings-toggle">
                    <span>{labels.startup[0]}</span>
                    <input
                      type="checkbox"
                      checked={!!settings.prefs.autoRestore}
                      onChange={(e) => patch({ prefs: { autoRestore: e.target.checked } })}
                    />
                  </label>
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
                          <button
                            className="icon-btn danger snippet-del"
                            title={t('settings.clear')}
                            onClick={() => removeSnippet(s.id)}
                          >
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
                    <input
                      className="input"
                      placeholder="Snippet name"
                      value={snipName}
                      onChange={(e) => setSnipName(e.target.value)}
                    />
                    <select
                      className="select snippet-add-kind"
                      value={snipKind}
                      onChange={(e) => setSnipKind(e.target.value as 'prompt' | 'shell')}
                    >
                      <option value="prompt">prompt</option>
                      <option value="shell">shell</option>
                    </select>
                  </div>
                  <textarea
                    className="input mono"
                    rows={3}
                    placeholder="Body — e.g. Review {{file}} for bugs"
                    value={snipBody}
                    onChange={(e) => setSnipBody(e.target.value)}
                  />
                  <div className="settings-actions">
                    <button
                      className="btn primary"
                      onClick={addSnippet}
                      disabled={!snipName.trim() || !snipBody.trim()}
                    >
                      Add snippet
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Appearance */}
            {sectionVisible('appearance', t('settings.appearance')) && (
              <section className="settings-section" ref={sectionRef('appearance')}>
                <h3>{t('settings.appearance')}</h3>
                {match('Terminal font') && (
                  <div className="settings-row">
                    <label className="settings-label">Terminal font</label>
                    <div className="settings-control">
                      <input
                        className="input mono"
                        placeholder="Default (JetBrains Mono)"
                        defaultValue={settings.prefs.fontFamily}
                        onBlur={(e) => patch({ prefs: { fontFamily: e.target.value.trim() } })}
                      />
                      <span className="hint">Font family for all terminals (empty = built-in mono).</span>
                    </div>
                  </div>
                )}
                {match('Font size') && (
                  <div className="settings-row">
                    <label className="settings-label">Font size</label>
                    <div className="settings-control">
                      <select
                        className="select"
                        value={settings.prefs.fontSize || 13}
                        onChange={(e) => patch({ prefs: { fontSize: Number(e.target.value) } })}
                      >
                        {[10, 11, 12, 13, 14, 15, 16, 18, 20].map((n) => (
                          <option key={n} value={n}>
                            {n}px
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {match(t('settings.language')) && (
                  <div className="settings-row">
                    <label className="settings-label">{t('settings.language')}</label>
                    <div className="settings-control">
                      <select
                        className="select"
                        value={settings.language}
                        onChange={(e) => patch({ language: e.target.value })}
                      >
                        {SUPPORTED_LANGUAGES.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {match('Accent Color') && (
                  <div className="settings-row">
                    <label className="settings-label">Accent Color</label>
                    <div className="settings-control">
                      <div className="color-picker-row">
                        {ACCENT_PRESETS.map((p) => (
                          <button
                            key={p.value}
                            className={clsx('color-swatch', settings.accentColor === p.value && 'active')}
                            style={{ background: p.value }}
                            onClick={() => patch({ accentColor: p.value })}
                            title={p.label}
                          />
                        ))}
                        <label className="color-custom-label" title="Custom color">
                          <input
                            type="color"
                            value={settings.accentColor || '#4c8dff'}
                            onChange={(e) => patch({ accentColor: e.target.value })}
                            className="color-custom-input"
                          />
                          <span
                            className={clsx(
                              'color-swatch',
                              'color-custom-preview',
                              !ACCENT_PRESETS.some((p) => p.value === settings.accentColor) && 'active'
                            )}
                            style={{ background: settings.accentColor || '#4c8dff' }}
                          >
                            <span className="color-custom-plus">+</span>
                          </span>
                        </label>
                      </div>
                      <span className="hint">Changes the UI accent color globally.</span>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
