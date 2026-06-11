import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import type { ControlCreatePane, ControlServerStatus } from '@shared/types'

/**
 * Local HTTP control server (#17). Bound to 127.0.0.1 only and gated by a bearer
 * token, it lets local scripts drive URterminal: list panes, open a pane, and
 * send input/prompts to a pane. The app is the host — this is just a thin,
 * loopback-only remote for automation (mirrors the Telegram bridge's role).
 *
 * Endpoints (all but /health require `Authorization: Bearer <token>` or ?token=):
 *   GET  /health            → { ok, version }                 (no auth)
 *   GET  /panes             → { panes: [{ ptyId, paneId, shell, pid, startedAt }] }
 *   POST /input  {ptyId,text,submit?} → write text to a pane (submit defaults true)
 *   POST /panes  {type,command?,shell?,cwd?} → ask the app to open a new pane
 *
 * Everything is loopback + token gated; binding to 127.0.0.1 keeps it off the
 * network entirely.
 */

const ESC = String.fromCharCode(27)
/** Bracketed-paste wrap so the receiving CLI treats input as a paste, not keystrokes. */
const bracketPaste = (s: string): string => `${ESC}[200~${s}${ESC}[201~`

export interface ControlPane {
  ptyId: string
  paneId: string
  pid: number
  shell: string
  startedAt: number
}

export interface ControlHooks {
  version: () => string
  listPanes: () => ControlPane[]
  /** Returns false if no live pane has that ptyId. */
  sendInput: (ptyId: string, data: string) => boolean
  openPane: (spec: ControlCreatePane) => void
}

export interface ControlConfig {
  enabled: boolean
  port: number
  token: string
}

/** A fresh, URL-safe-ish bearer token. */
export function generateControlToken(): string {
  return randomBytes(24).toString('hex')
}

/** Pure auth check: a request is allowed iff it presents the expected token. */
export function isAuthorized(expected: string, authHeader?: string | string[], queryToken?: string | null): boolean {
  if (!expected) return false // never accept when no token is configured
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader
  if (header && header === `Bearer ${expected}`) return true
  return queryToken === expected
}

/** Normalize an open-pane request body into a ControlCreatePane. */
export function parseOpenSpec(body: Record<string, unknown>): ControlCreatePane {
  const type = body.type === 'shell' ? 'shell' : 'ai'
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  return { type, command: str(body.command), shell: str(body.shell), cwd: str(body.cwd) }
}

export class ControlServer {
  private server: Server | null = null
  private status: ControlServerStatus = { running: false }
  private token = ''

  constructor(private hooks: ControlHooks) {}

  isRunning(): boolean {
    return this.status.running
  }
  getStatus(): ControlServerStatus {
    return this.status
  }

  /** Apply config: (re)start when enabled, stop when not. Never throws. */
  async start(cfg: ControlConfig): Promise<ControlServerStatus> {
    await this.stop()
    if (!cfg.enabled) {
      this.status = { running: false }
      return this.status
    }
    if (!cfg.token) {
      this.status = { running: false, error: 'No access token set' }
      return this.status
    }
    this.token = cfg.token
    return new Promise((resolve) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.on('error', (e) => {
        this.server = null
        this.status = { running: false, error: (e as Error).message }
        resolve(this.status)
      })
      // 127.0.0.1 only — never expose on the network.
      server.listen(cfg.port, '127.0.0.1', () => {
        this.server = server
        const addr = server.address()
        const port = typeof addr === 'object' && addr ? addr.port : cfg.port
        this.status = { running: true, port }
        resolve(this.status)
      })
    })
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    this.status = { running: false }
    if (s) await new Promise<void>((r) => s.close(() => r()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const path = url.pathname.replace(/\/+$/, '') || '/'

      if (req.method === 'GET' && (path === '/health' || path === '/')) {
        return send(res, 200, { ok: true, version: this.hooks.version() })
      }
      if (!isAuthorized(this.token, req.headers['authorization'], url.searchParams.get('token'))) {
        return send(res, 401, { error: 'unauthorized' })
      }
      if (req.method === 'GET' && path === '/panes') {
        return send(res, 200, { panes: this.hooks.listPanes() })
      }
      if (req.method === 'POST' && path === '/input') {
        const body = await readJson(req)
        const ptyId = typeof body.ptyId === 'string' ? body.ptyId : ''
        const text = typeof body.text === 'string' ? body.text : ''
        if (!ptyId || !text) return send(res, 400, { error: 'ptyId and text are required' })
        const submit = body.submit !== false
        const data = bracketPaste(text) + (submit ? '\r' : '')
        const ok = this.hooks.sendInput(ptyId, data)
        return send(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'no live pane with that ptyId' })
      }
      if (req.method === 'POST' && path === '/panes') {
        const body = await readJson(req)
        this.hooks.openPane(parseOpenSpec(body))
        return send(res, 202, { ok: true })
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 400, { error: (e as Error).message })
    }
  }
}

function send(res: ServerResponse, code: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(json)
}

/** Read and JSON-parse a request body (cap at 1 MB; {} for an empty body). */
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) reject(new Error('request body too large'))
    })
    req.on('end', () => {
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>)
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}
