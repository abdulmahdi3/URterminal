import { Client } from 'ssh2'

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
  cols: number
  rows: number
}

/**
 * Establish an SSH connection (ssh2) and expose it as a PtyLike. Output is
 * streamed via onData; auth/connection failures are surfaced as red text and
 * then an exit so the pane closes. Keystrokes typed before the shell channel is
 * ready are buffered and flushed on open.
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

  const emitData = (d: string): void => dataCbs.forEach((cb) => cb(d))
  const emitExit = (code: number): void => {
    if (exited) return
    exited = true
    exitCbs.forEach((cb) => cb({ exitCode: code }))
  }
  // Show an error briefly before closing so the user can read why it failed.
  const failWith = (msg: string): void => {
    emitData(`\r\n\x1b[31m${msg}\x1b[0m\r\n`)
    setTimeout(() => emitExit(1), 2500)
  }

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
  conn.on('error', (err) => failWith(`SSH connection failed: ${err.message}`))
  conn.on('close', () => emitExit(0))

  conn.connect({
    host: opts.host,
    port: opts.port,
    username: opts.username,
    password: opts.password,
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
