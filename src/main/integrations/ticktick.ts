import { shell } from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import type { SettingsStore } from '../settings/store'
import type {
  TickTickProject,
  TickTickProjectData,
  TickTickTask
} from '@shared/types'

/**
 * TickTick OAuth + REST client (main-process only).
 *
 * The user registers their own app on developer.ticktick.com with the redirect
 * URI set to OAUTH_REDIRECT_URI below and pastes the resulting client_id /
 * client_secret into Settings → Integrations. `connect()` then spins up a
 * temporary loopback HTTP server, opens TickTick's authorize page in the
 * default browser, catches the redirect, swaps the auth code for an access
 * token, and stores it (encrypted) via SettingsStore.
 *
 * REST calls all carry `Authorization: Bearer <accessToken>` per TickTick's
 * Open API; on 401 we clear the token so the renderer can prompt for reconnect.
 */
const OAUTH_PORT = 23123
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_PORT}/callback`
const OAUTH_SCOPE = 'tasks:write tasks:read'
const API_BASE = 'https://api.ticktick.com/open/v1'

export class TickTickError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'TickTickError'
  }
}

export class TickTickClient {
  /** Only one OAuth flow at a time — clicking Connect twice cancels the previous. */
  private inFlightAbort: AbortController | null = null

  constructor(private settings: SettingsStore) {}

  /** Whether the user has both the access token and the app credentials set. */
  isReady(): boolean {
    const token = this.settings.getIntegrationToken('ticktick')
    const { clientId, clientSecret } = this.settings.getTickTickClient()
    return !!token && !!clientId && !!clientSecret
  }

  // ---- OAuth ------------------------------------------------------------

  /**
   * Run the full OAuth code-grant flow. Returns when the access token has
   * been exchanged and saved (or throws on cancel / error).
   */
  async connect(): Promise<void> {
    const { clientId, clientSecret } = this.settings.getTickTickClient()
    if (!clientId || !clientSecret) {
      throw new TickTickError(
        'Missing TickTick client_id / client_secret. Register an app on developer.ticktick.com first.'
      )
    }
    // Cancel any previous in-flight flow.
    this.inFlightAbort?.abort()
    const abort = new AbortController()
    this.inFlightAbort = abort

    const state = randomBytes(16).toString('hex')
    const code = await this.runLoopback(state, abort.signal)
    if (abort.signal.aborted) throw new TickTickError('OAuth cancelled')
    const token = await this.exchangeCode(clientId, clientSecret, code)
    this.settings.setTickTickToken(token)
    this.inFlightAbort = null
  }

  /** Forget the saved access token. The user keeps their client_id/secret. */
  disconnect(): void {
    this.inFlightAbort?.abort()
    this.inFlightAbort = null
    this.settings.setTickTickToken(null)
  }

  /**
   * Start a one-shot HTTP server on localhost:OAUTH_PORT, open the TickTick
   * authorize URL in the browser, and resolve with the `code` query param
   * from the redirect (verifying state matches).
   */
  private runLoopback(state: string, signal: AbortSignal): Promise<string> {
    const { clientId } = this.settings.getTickTickClient()
    return new Promise<string>((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse): void => {
        const url = new URL(req.url ?? '/', `http://localhost:${OAUTH_PORT}`)
        if (url.pathname !== '/callback') {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        const err = url.searchParams.get('error')
        const html = (body: string): string =>
          `<!doctype html><html><body style="font-family:sans-serif;padding:40px;text-align:center">${body}</body></html>`
        if (err) {
          res.setHeader('content-type', 'text/html')
          res.end(html(`<h2>TickTick authorization failed</h2><p>${err}</p><p>You can close this tab.</p>`))
          server.close()
          reject(new TickTickError(`TickTick rejected: ${err}`))
          return
        }
        if (!code || returnedState !== state) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(html('<h2>Bad request</h2><p>Missing code or state mismatch.</p>'))
          server.close()
          reject(new TickTickError('Invalid OAuth callback (state mismatch).'))
          return
        }
        res.setHeader('content-type', 'text/html')
        res.end(html('<h2>Connected to URterminal ✅</h2><p>You can close this tab and return to the app.</p>'))
        server.close()
        resolve(code)
      })

      server.on('error', (e) => reject(new TickTickError(`Loopback server failed: ${(e as Error).message}`)))
      signal.addEventListener('abort', () => {
        try { server.close() } catch { /* ignore */ }
        reject(new TickTickError('OAuth cancelled'))
      })
      server.listen(OAUTH_PORT, '127.0.0.1', () => {
        const authorize = new URL('https://ticktick.com/oauth/authorize')
        authorize.searchParams.set('client_id', clientId!)
        authorize.searchParams.set('scope', OAUTH_SCOPE)
        authorize.searchParams.set('state', state)
        authorize.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI)
        authorize.searchParams.set('response_type', 'code')
        void shell.openExternal(authorize.toString())
      })
    })
  }

  /** Swap the authorization code for an access token (Basic Auth client creds). */
  private async exchangeCode(clientId: string, clientSecret: string, code: string): Promise<string> {
    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      scope: OAUTH_SCOPE,
      redirect_uri: OAUTH_REDIRECT_URI
    })
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const r = await fetch('https://ticktick.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`
      },
      body
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new TickTickError(`Token exchange failed: ${r.status} ${text}`.trim(), r.status)
    }
    const json = (await r.json()) as { access_token?: string }
    if (!json.access_token) throw new TickTickError('Token exchange returned no access_token')
    return json.access_token
  }

  // ---- REST API ---------------------------------------------------------

  /** Internal fetch wrapper: attaches bearer token, surfaces 401 by clearing the token. */
  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.settings.getIntegrationToken('ticktick')
    if (!token) throw new TickTickError('Not connected to TickTick.', 401)
    const r = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {})
      }
    })
    if (r.status === 401) {
      this.settings.setTickTickToken(null)
      throw new TickTickError('TickTick token expired — please reconnect.', 401)
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new TickTickError(`TickTick ${r.status}: ${text}`.trim(), r.status)
    }
    // Some endpoints (complete / delete) return empty body — guard JSON parse.
    const text = await r.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  listProjects(): Promise<TickTickProject[]> {
    return this.call<TickTickProject[]>('/project')
  }

  /** Create a new list/project. TickTick returns the created project. */
  createProject(input: {
    name: string
    color?: string
    viewMode?: string
    kind?: string
  }): Promise<TickTickProject> {
    return this.call<TickTickProject>('/project', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  }

  /** Permanently delete a project (and its tasks) on TickTick. */
  deleteProject(projectId: string): Promise<void> {
    return this.call<void>(`/project/${encodeURIComponent(projectId)}`, { method: 'DELETE' })
  }

  getProjectData(projectId: string): Promise<TickTickProjectData> {
    return this.call<TickTickProjectData>(`/project/${encodeURIComponent(projectId)}/data`)
  }

  createTask(input: {
    projectId: string
    title: string
    content?: string
    desc?: string
    dueDate?: string
    startDate?: string
    isAllDay?: boolean
    priority?: number
    tags?: string[]
    items?: Array<{ title: string; status?: number; sortOrder?: number }>
  }): Promise<TickTickTask> {
    return this.call<TickTickTask>('/task', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  }

  /**
   * Update an existing task. TickTick's update endpoint requires the task id
   * and projectId in the body; everything else is a merge. Returns the
   * server's view of the task so we can sync local state.
   */
  updateTask(input: Partial<TickTickTask> & { id: string; projectId: string }): Promise<TickTickTask> {
    return this.call<TickTickTask>(`/task/${encodeURIComponent(input.id)}`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  }

  completeTask(projectId: string, taskId: string): Promise<void> {
    return this.call<void>(
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
      { method: 'POST' }
    )
  }

  deleteTask(projectId: string, taskId: string): Promise<void> {
    return this.call<void>(
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
      { method: 'DELETE' }
    )
  }
}
