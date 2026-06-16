import { Client } from 'ssh2'
import { connect as netConnect } from 'node:net'
import { readFileSync } from 'node:fs'

/**
 * The subset of node-pty's IPty that PtyManager actually calls. An SSH session
 * implements this so it can be "adopted" by the PtyManager and streamed to the
 * renderer through the exact same pty:data / pty:exit channels as a real shell.
 */
export interface PtyLike {
  readonly pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface SshConnectOpts {
  host: string
  port: number
  username: string
  password: string
  /** absolute path to a private key; when set, key auth is attempted */
  identityFile?: string
  cols: number
  rows: number
}

/**
 * Measure TCP reachability + round-trip latency to host:port. Resolves to the
 * connect time in ms when the port accepts, or null on timeout/refusal/error.
 * Used by the connections manager to show the green/red online dots + "14ms".
 */
export function tcpPing(host: string, port: number, timeoutMs = 4000): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now()
    let done = false
    const finish = (ms: number | null): void => {
      if (done) return
      done = true
      try {
        sock.destroy()
      } catch {
        /* noop */
      }
      resolve(ms)
    }
    const sock = netConnect({ host, port }, () => finish(Date.now() - start))
    sock.setTimeout(timeoutMs)
    sock.on('timeout', () => finish(null))
    sock.on('error', () => finish(null))
  })
}

/** Parse "user@host[:port]" into its parts (username may be empty → caller defaults it). */
export function parseSshTarget(target: string): { username: string; host: string; port: number } {
  const trimmed = target.trim()
  const at = trimmed.indexOf('@')
  const username = at >= 0 ? trimmed.slice(0, at) : ''
  let rest = at >= 0 ? trimmed.slice(at + 1) : trimmed
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

/**
 * Establish an SSH connection (ssh2) and expose it as a PtyLike. Output is
 * streamed via onData. Auth/connection failures are surfaced as red text and
 * the pane is LEFT OPEN so the reason stays readable (a clean disconnect still
 * closes it). Keystrokes typed before the shell channel is ready are buffered
 * and flushed on open.
 */
export function createSshPty(opts: SshConnectOpts): PtyLike {
  const conn = new Client()
  let stream: import('ssh2').ClientChannel | null = null
  const dataCbs: ((d: string) => void)[] = []
  const exitCbs: ((e: { exitCode: number }) => void)[] = []
  const pending: string[] = []
  let cols = Math.max(2, opts.cols)
  let rows = Math.max(1, opts.rows)
  let exited = false
  // Set once a failure has been reported. ssh2 fires `close` immediately after
  // `error`; without this guard that close would emitExit and tear the pane
  // down before the error ever rendered — the "connecting then the pane just
  // vanishes" bug. On failure we keep the pane open so the user can read why.
  let failed = false

  const emitData = (d: string): void => dataCbs.forEach((cb) => cb(d))
  const emitExit = (code: number): void => {
    if (exited) return
    exited = true
    exitCbs.forEach((cb) => cb({ exitCode: code }))
  }
  // Surface why the session failed (red) plus an optional hint; keep the pane
  // open (no exit) so the message stays on screen.
  const failWith = (msg: string, hint?: string): void => {
    if (failed) return
    failed = true
    emitData(`\r\n\x1b[31m${msg}\x1b[0m\r\n`)
    if (hint) emitData(`\x1b[90m${hint}\x1b[0m\r\n`)
  }

  // Servers that drive auth through keyboard-interactive (common for password
  // logins) ask here; answer every prompt with the supplied password.
  conn.on('keyboard-interactive', (_n, _i, _l, _prompts, finish) => finish([opts.password]))
  conn.on('ready', () => {
    conn.shell({ term: 'xterm-256color', cols, rows }, (err, s) => {
      if (err) {
        failWith(`SSH shell error: ${err.message}`)
        try {
          conn.end()
        } catch {
          /* noop */
        }
        return
      }
      stream = s
      for (const p of pending) s.write(p)
      pending.length = 0
      s.on('data', (d: Buffer) => emitData(d.toString('utf8')))
      s.stderr?.on('data', (d: Buffer) => emitData(d.toString('utf8')))
      s.on('close', () => {
        try {
          conn.end()
        } catch {
          /* noop */
        }
        emitExit(0)
      })
    })
  })
  conn.on('error', (err) =>
    failWith(
      `SSH connection failed: ${err.message}`,
      'Check the address (use user@host — a bare host defaults to your local username), the password, and that the server is reachable.'
    )
  )
  // A close that isn't the tail of a failure (remote shell ended / user
  // disconnected) closes the pane as usual; after a failure we leave it open.
  conn.on('close', () => {
    if (!failed) emitExit(0)
  })

  // Load the private key (if configured). A read failure isn't fatal — ssh2 can
  // still fall back to the password / agent; we just surface the reason.
  let privateKey: Buffer | undefined
  if (opts.identityFile) {
    try {
      privateKey = readFileSync(opts.identityFile)
    } catch (e) {
      emitData(`\x1b[90mCould not read identity file ${opts.identityFile}: ${(e as Error).message}\x1b[0m\r\n`)
    }
  }

  conn.connect({
    host: opts.host,
    port: opts.port,
    username: opts.username,
    // Offer whichever secrets we have; ssh2 picks per the server's accepted methods.
    password: opts.password || undefined,
    privateKey,
    // Let a running ssh-agent answer too (handy for key auth without an identity file).
    agent: process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined),
    tryKeyboard: true,
    readyTimeout: 20000,
    keepaliveInterval: 15000
  })

  return {
    pid: -1,
    onData: (cb) => void dataCbs.push(cb),
    onExit: (cb) => void exitCbs.push(cb),
    write: (data) => {
      if (stream) stream.write(data)
      else pending.push(data)
    },
    resize: (c, r) => {
      cols = Math.max(2, c)
      rows = Math.max(1, r)
      try {
        stream?.setWindow(rows, cols, 0, 0)
      } catch {
        /* channel may have closed */
      }
    },
    kill: () => {
      try {
        conn.end()
      } catch {
        /* noop */
      }
      emitExit(0)
    }
  }
}
