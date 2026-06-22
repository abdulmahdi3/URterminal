#!/usr/bin/env node
/**
 * uregant-mcp — a local stdio MCP server that gives an MCP client (e.g. a Claude
 * Code pane) control of URterminal's panes (UREGANT_PLAN.md §8, Phase 3).
 *
 * It is a thin translator: MCP tool calls -> URterminal's loopback ControlServer
 * HTTP API (127.0.0.1:<port>, Bearer <token>). Port + token are read from a
 * config file (written by URterminal into userData) passed via --config <path>,
 * so no secret is committed to the repo's .mcp.json.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdin/stdout (MCP 2024-11-05).
 * Self-contained — no dependencies; uses Node 18+ global fetch.
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const ci = argv.indexOf('--config')
const configPath = ci >= 0 ? argv[ci + 1] : null

let PORT = 0
let TOKEN = ''
try {
  if (configPath) {
    const c = JSON.parse(readFileSync(configPath, 'utf8'))
    PORT = Number(c.port) || 0
    TOKEN = String(c.token || '')
  }
} catch {
  /* config unreadable — tools will report the bridge is offline */
}

const TOOLS = [
  {
    name: 'list_panes',
    description: 'List the open panes in URterminal (paneId, shell/agent, pid).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'open_pane',
    description: 'Open a new pane. type "shell" for a terminal, "ai" to launch an agent CLI. Then call list_panes to get its paneId.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['shell', 'ai'] },
        command: { type: 'string', description: 'agent CLI for ai panes, e.g. "claude"' },
        shell: { type: 'string', description: 'shell binary for shell panes' },
        cwd: { type: 'string', description: 'working directory' }
      },
      required: ['type']
    }
  },
  {
    name: 'write_to_pane',
    description: 'Type text into a pane. submit=true (default) presses Enter to run it.',
    inputSchema: {
      type: 'object',
      properties: {
        paneId: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean' }
      },
      required: ['paneId', 'text']
    }
  },
  {
    name: 'read_pane',
    description: "Read a pane's recent output (ANSI-stripped, last ~40k chars).",
    inputSchema: { type: 'object', properties: { paneId: { type: 'string' } }, required: ['paneId'] }
  },
  {
    name: 'close_pane',
    description: 'Close a pane by id.',
    inputSchema: { type: 'object', properties: { paneId: { type: 'string' } }, required: ['paneId'] }
  }
]

async function ctl(method, path, body) {
  if (!PORT || !TOKEN) {
    throw new Error('URterminal control server not configured — open the Uregant cockpit → Agents → Connect.')
  }
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  if (!res.ok) throw new Error(json.error || `control server HTTP ${res.status}`)
  return json
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'list_panes': {
      const r = await ctl('GET', '/panes')
      return JSON.stringify(r.panes ?? [])
    }
    case 'open_pane': {
      await ctl('POST', '/panes', { type: args.type, command: args.command, shell: args.shell, cwd: args.cwd })
      return 'Pane opening — call list_panes to get its paneId.'
    }
    case 'write_to_pane': {
      await ctl('POST', '/input', { paneId: args.paneId, text: String(args.text ?? ''), submit: args.submit !== false })
      return 'sent'
    }
    case 'read_pane': {
      const r = await ctl('GET', `/pane/output?paneId=${encodeURIComponent(String(args.paneId ?? ''))}`)
      return String(r.output ?? '')
    }
    case 'close_pane': {
      await ctl('POST', '/panes/close', { paneId: args.paneId })
      return 'closed'
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32000, message } })

async function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    reply(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'uregant-panes', version: '1.0.0' }
    })
  } else if (method === 'tools/list') {
    reply(id, { tools: TOOLS })
  } else if (method === 'tools/call') {
    try {
      const text = await callTool(params?.name, params?.arguments || {})
      reply(id, { content: [{ type: 'text', text }] })
    } catch (e) {
      reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true })
    }
  } else if (method === 'ping') {
    reply(id, {})
  } else if (id !== undefined && !String(method || '').startsWith('notifications/')) {
    fail(id, `Unknown method: ${method}`)
  }
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    void handle(msg)
  }
})
