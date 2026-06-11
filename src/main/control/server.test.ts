import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ControlServer,
  isAuthorized,
  parseOpenSpec,
  generateControlToken,
  type ControlHooks
} from './server'
import type { ControlCreatePane } from '@shared/types'

describe('isAuthorized', () => {
  it('accepts a matching bearer header', () => {
    expect(isAuthorized('tok', 'Bearer tok', null)).toBe(true)
  })
  it('accepts a matching ?token=', () => {
    expect(isAuthorized('tok', undefined, 'tok')).toBe(true)
  })
  it('rejects a wrong or missing token', () => {
    expect(isAuthorized('tok', 'Bearer nope', null)).toBe(false)
    expect(isAuthorized('tok', undefined, null)).toBe(false)
  })
  it('never accepts when no token is configured', () => {
    expect(isAuthorized('', undefined, '')).toBe(false)
    expect(isAuthorized('', 'Bearer ', '')).toBe(false)
  })
})

describe('parseOpenSpec', () => {
  it('defaults to an ai pane and trims fields', () => {
    expect(parseOpenSpec({ command: '  claude  ', cwd: ' /x ' })).toEqual({
      type: 'ai',
      command: 'claude',
      cwd: '/x',
      shell: undefined
    })
  })
  it('honors shell type', () => {
    expect(parseOpenSpec({ type: 'shell', shell: 'pwsh' })).toEqual({
      type: 'shell',
      shell: 'pwsh',
      command: undefined,
      cwd: undefined
    })
  })
})

describe('generateControlToken', () => {
  it('is a 48-char hex string, unique per call', () => {
    const a = generateControlToken()
    const b = generateControlToken()
    expect(a).toMatch(/^[0-9a-f]{48}$/)
    expect(a).not.toBe(b)
  })
})

describe('ControlServer (loopback)', () => {
  const TOKEN = 'test-token-123'
  let server: ControlServer
  let base: string
  let opened: ControlCreatePane[]
  let inputs: Array<{ ptyId: string; data: string }>

  const hooks: ControlHooks = {
    version: () => '9.9.9',
    listPanes: () => [{ ptyId: 'p1', paneId: 'pane1', pid: 100, shell: 'claude', startedAt: 0 }],
    sendInput: (ptyId, data) => {
      if (ptyId !== 'p1') return false
      inputs.push({ ptyId, data })
      return true
    },
    openPane: (spec) => opened.push(spec)
  }

  beforeEach(async () => {
    opened = []
    inputs = []
    server = new ControlServer(hooks)
    const status = await server.start({ enabled: true, port: 0, token: TOKEN })
    expect(status.running).toBe(true)
    base = `http://127.0.0.1:${status.port}`
  })
  afterEach(async () => {
    await server.stop()
  })

  it('serves /health without auth', async () => {
    const r = await fetch(`${base}/health`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, version: '9.9.9' })
  })

  it('401s a protected route without a token', async () => {
    const r = await fetch(`${base}/panes`)
    expect(r.status).toBe(401)
  })

  it('lists panes with a valid bearer token', async () => {
    const r = await fetch(`${base}/panes`, { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { panes: unknown[] }
    expect(body.panes).toHaveLength(1)
  })

  it('sends input to a live pane (bracketed paste + submit)', async () => {
    const r = await fetch(`${base}/input?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ptyId: 'p1', text: 'ls' })
    })
    expect(r.status).toBe(200)
    expect(inputs).toHaveLength(1)
    expect(inputs[0].data).toBe('\x1b[200~ls\x1b[201~\r') // submitted by default
  })

  it('404s input to an unknown pane', async () => {
    const r = await fetch(`${base}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ ptyId: 'nope', text: 'x' })
    })
    expect(r.status).toBe(404)
  })

  it('opens a pane on POST /panes', async () => {
    const r = await fetch(`${base}/panes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ type: 'ai', command: 'claude', cwd: '/repo' })
    })
    expect(r.status).toBe(202)
    expect(opened).toEqual([{ type: 'ai', command: 'claude', cwd: '/repo', shell: undefined }])
  })

  it('stop() frees the port and disabled start does not listen', async () => {
    await server.stop()
    expect(server.isRunning()).toBe(false)
    const status = await server.start({ enabled: false, port: 0, token: TOKEN })
    expect(status.running).toBe(false)
  })
})
