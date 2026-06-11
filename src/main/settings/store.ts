import { safeStorage } from 'electron'
import Store from 'electron-store'
import type {
  ProviderId,
  SettingsPublic,
  SettingsPatch,
  ThemeName,
  AppPrefs,
  IntegrationId,
  IntegrationsPublic
} from '@shared/types'
import { DEFAULT_PREFS } from '@shared/types'
import {
  DEFAULT_MODELS,
  DEFAULT_OLLAMA_URL,
  DEFAULT_LMSTUDIO_URL,
  DEFAULT_AGENT
} from '@shared/providers'

interface RawSettings {
  providers: {
    anthropic: { keyEnc?: string }
    openai: { keyEnc?: string }
    gemini: { keyEnc?: string }
    ollama: { baseUrl: string }
    lmstudio: { baseUrl: string }
  }
  telegram: { tokenEnc?: string; defaultChatId?: string }
  /** saved SSH passwords, keyed by target ("user@host"), encrypted like API keys */
  ssh: { passwords: Record<string, string> }
  /** to-do service credentials. `tokenEnc` is the access token (encrypted).
      TickTick also stores the user's registered app clientId (plain) and
      clientSecret (encrypted) — they're needed to run its OAuth flow. */
  integrations: {
    todoist: { tokenEnc?: string; connectedAt?: number }
    ticktick: {
      tokenEnc?: string
      connectedAt?: number
      clientId?: string
      clientSecretEnc?: string
    }
    microsoftTodo: { tokenEnc?: string; connectedAt?: number }
    googleTasks: { tokenEnc?: string; connectedAt?: number }
    notion: { tokenEnc?: string; connectedAt?: number }
  }
  defaultProvider: ProviderId
  defaultModel: string
  defaultAgent: string
  defaultShell: string
  defaultShellArgs: string[]
  theme: ThemeName
  accentColor: string
  prefs: AppPrefs
}

const DEFAULTS: RawSettings = {
  providers: {
    anthropic: {},
    openai: {},
    gemini: {},
    ollama: { baseUrl: DEFAULT_OLLAMA_URL },
    lmstudio: { baseUrl: DEFAULT_LMSTUDIO_URL }
  },
  telegram: {},
  ssh: { passwords: {} },
  integrations: {
    todoist: {},
    ticktick: {},
    microsoftTodo: {},
    googleTasks: {},
    notion: {}
  },
  defaultProvider: 'anthropic',
  defaultModel: DEFAULT_MODELS.anthropic[0],
  defaultAgent: DEFAULT_AGENT,
  defaultShell: '',
  defaultShellArgs: [],
  theme: 'dark',
  accentColor: '#4c8dff',
  prefs: DEFAULT_PREFS
}

function encrypt(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plain).toString('base64')
  }
  // Fallback (e.g. OS keychain unavailable): mark as plain so we can still read it.
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
}

function decrypt(stored: string | undefined): string | undefined {
  if (!stored) return undefined
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
  } catch {
    return undefined
  }
  return undefined
}

function preview(key: string | undefined): string | undefined {
  if (!key) return undefined
  const tail = key.slice(-4)
  return `••••${tail}`
}

export class SettingsStore {
  private store = new Store<RawSettings>({ name: 'urterminal-settings', defaults: DEFAULTS })

  private raw(): RawSettings {
    // electron-store merges defaults, but nested objects may be partial.
    const s = this.store.store
    return {
      ...DEFAULTS,
      ...s,
      providers: {
        anthropic: { ...s.providers?.anthropic },
        openai: { ...s.providers?.openai },
        gemini: { ...s.providers?.gemini },
        ollama: { baseUrl: s.providers?.ollama?.baseUrl || DEFAULT_OLLAMA_URL },
        lmstudio: { baseUrl: s.providers?.lmstudio?.baseUrl || DEFAULT_LMSTUDIO_URL }
      },
      telegram: { ...s.telegram },
      ssh: { passwords: { ...s.ssh?.passwords } },
      integrations: {
        todoist: { ...(s.integrations?.todoist ?? {}) },
        ticktick: { ...(s.integrations?.ticktick ?? {}) },
        microsoftTodo: { ...(s.integrations?.microsoftTodo ?? {}) },
        googleTasks: { ...(s.integrations?.googleTasks ?? {}) },
        notion: { ...(s.integrations?.notion ?? {}) }
      },
      prefs: { ...DEFAULT_PREFS, ...s.prefs }
    }
  }

  private integrationsPublic(s: RawSettings): IntegrationsPublic {
    const view = (id: IntegrationId): { connected: boolean; connectedAt?: number } => {
      const slot = s.integrations[id]
      return { connected: !!slot?.tokenEnc, connectedAt: slot?.connectedAt }
    }
    const tt = s.integrations.ticktick
    return {
      todoist: view('todoist'),
      ticktick: {
        connected: !!tt?.tokenEnc,
        connectedAt: tt?.connectedAt,
        clientId: tt?.clientId,
        clientSecretSet: !!tt?.clientSecretEnc
      },
      microsoftTodo: view('microsoftTodo'),
      googleTasks: view('googleTasks'),
      notion: view('notion')
    }
  }

  getPublic(telegramRunning = false, botUsername?: string, telegramError?: string): SettingsPublic {
    const s = this.raw()
    const aKey = decrypt(s.providers.anthropic.keyEnc)
    const oKey = decrypt(s.providers.openai.keyEnc)
    const gKey = decrypt(s.providers.gemini.keyEnc)
    const tToken = decrypt(s.telegram.tokenEnc)
    return {
      providers: {
        anthropic: { keySet: !!aKey, keyPreview: preview(aKey) },
        openai: { keySet: !!oKey, keyPreview: preview(oKey) },
        gemini: { keySet: !!gKey, keyPreview: preview(gKey) },
        ollama: { baseUrl: s.providers.ollama.baseUrl },
        lmstudio: { baseUrl: s.providers.lmstudio.baseUrl }
      },
      telegram: {
        tokenSet: !!tToken,
        tokenPreview: preview(tToken),
        defaultChatId: s.telegram.defaultChatId,
        running: telegramRunning,
        botUsername,
        error: telegramError
      },
      defaultProvider: s.defaultProvider,
      defaultModel: s.defaultModel,
      defaultAgent: s.defaultAgent || DEFAULT_AGENT,
      defaultShell: s.defaultShell || '',
      defaultShellArgs: s.defaultShellArgs || [],
      theme: s.theme,
      accentColor: s.accentColor || '#4c8dff',
      prefs: { ...DEFAULT_PREFS, ...s.prefs },
      integrations: this.integrationsPublic(s)
    }
  }

  /** Decrypted token for a to-do service (undefined if none stored). */
  getIntegrationToken(id: IntegrationId): string | undefined {
    return decrypt(this.raw().integrations[id]?.tokenEnc)
  }

  /** TickTick OAuth credentials (clientId + decrypted clientSecret) for the OAuth flow. */
  getTickTickClient(): { clientId?: string; clientSecret?: string } {
    const tt = this.raw().integrations.ticktick
    return { clientId: tt?.clientId, clientSecret: decrypt(tt?.clientSecretEnc) }
  }

  /** Store the TickTick access token returned by the OAuth `/oauth/token` exchange. */
  setTickTickToken(token: string | null): void {
    const s = this.raw()
    const cur = s.integrations.ticktick ?? {}
    if (token) {
      s.integrations.ticktick = { ...cur, tokenEnc: encrypt(token), connectedAt: Date.now() }
    } else {
      s.integrations.ticktick = { ...cur, tokenEnc: undefined, connectedAt: undefined }
    }
    this.store.set(s)
  }

  /** Store/clear the access token for any to-do integration (e.g. on a 401). */
  setIntegrationToken(id: IntegrationId, token: string | null): void {
    const s = this.raw()
    const cur = s.integrations[id] ?? {}
    if (token) s.integrations[id] = { ...cur, tokenEnc: encrypt(token), connectedAt: Date.now() }
    else s.integrations[id] = { ...cur, tokenEnc: undefined, connectedAt: undefined }
    this.store.set(s)
  }

  getPrefs(): AppPrefs {
    return { ...DEFAULT_PREFS, ...this.raw().prefs }
  }

  getApiKey(provider: ProviderId): string | undefined {
    const s = this.raw()
    if (provider === 'anthropic') return decrypt(s.providers.anthropic.keyEnc)
    if (provider === 'openai') return decrypt(s.providers.openai.keyEnc)
    if (provider === 'gemini') return decrypt(s.providers.gemini.keyEnc)
    return undefined
  }

  getOllamaBaseUrl(): string {
    return this.raw().providers.ollama.baseUrl
  }

  getLmstudioBaseUrl(): string {
    return this.raw().providers.lmstudio.baseUrl
  }

  /** Base URL for a local provider (Ollama / LM Studio); '' for the others. */
  getLocalBaseUrl(provider: ProviderId): string {
    if (provider === 'ollama') return this.getOllamaBaseUrl()
    if (provider === 'lmstudio') return this.getLmstudioBaseUrl()
    return ''
  }

  getTelegramToken(): string | undefined {
    return decrypt(this.raw().telegram.tokenEnc)
  }

  getTelegramDefaultChat(): string | undefined {
    return this.raw().telegram.defaultChatId
  }

  /** Decrypted saved SSH password for a target ("user@host"), if one was saved. */
  getSshPassword(target: string): string | undefined {
    return decrypt(this.raw().ssh.passwords[target])
  }

  /** Save (or, with null, forget) the SSH password for a target. */
  setSshPassword(target: string, password: string | null): void {
    const s = this.raw()
    if (password) s.ssh.passwords[target] = encrypt(password)
    else delete s.ssh.passwords[target]
    this.store.set(s)
  }

  patch(patch: SettingsPatch): void {
    const s = this.raw()

    if (patch.providerKey) {
      const { provider, key } = patch.providerKey
      if (provider === 'ollama' || provider === 'lmstudio') {
        // local providers use a baseUrl, not a key
      } else {
        const enc = key ? encrypt(key) : undefined
        s.providers[provider] = enc ? { keyEnc: enc } : {}
      }
    }
    if (patch.ollamaBaseUrl !== undefined) {
      s.providers.ollama.baseUrl = patch.ollamaBaseUrl || DEFAULT_OLLAMA_URL
    }
    if (patch.lmstudioBaseUrl !== undefined) {
      s.providers.lmstudio.baseUrl = patch.lmstudioBaseUrl || DEFAULT_LMSTUDIO_URL
    }
    if (patch.telegramToken !== undefined) {
      s.telegram.tokenEnc = patch.telegramToken ? encrypt(patch.telegramToken) : undefined
    }
    if (patch.telegramDefaultChatId !== undefined) {
      s.telegram.defaultChatId = patch.telegramDefaultChatId || undefined
    }
    if (patch.defaultProvider) s.defaultProvider = patch.defaultProvider
    if (patch.defaultModel !== undefined) s.defaultModel = patch.defaultModel
    if (patch.defaultAgent !== undefined) s.defaultAgent = patch.defaultAgent
    if (patch.defaultShell !== undefined) s.defaultShell = patch.defaultShell
    if (patch.defaultShellArgs !== undefined) s.defaultShellArgs = patch.defaultShellArgs
    if (patch.theme) s.theme = patch.theme
    if (patch.accentColor) s.accentColor = patch.accentColor
    if (patch.prefs) s.prefs = { ...DEFAULT_PREFS, ...s.prefs, ...patch.prefs }
    if (patch.integrationToken) {
      const { id, token } = patch.integrationToken
      const cur = s.integrations[id] ?? {}
      if (token) s.integrations[id] = { ...cur, tokenEnc: encrypt(token), connectedAt: Date.now() }
      else s.integrations[id] = { ...cur, tokenEnc: undefined, connectedAt: undefined }
    }
    if (patch.tickTickClientId !== undefined) {
      const cur = s.integrations.ticktick ?? {}
      s.integrations.ticktick = { ...cur, clientId: patch.tickTickClientId || undefined }
    }
    if (patch.tickTickClientSecret !== undefined) {
      const cur = s.integrations.ticktick ?? {}
      s.integrations.ticktick = {
        ...cur,
        clientSecretEnc: patch.tickTickClientSecret ? encrypt(patch.tickTickClientSecret) : undefined
      }
    }

    this.store.set(s)
  }
}
