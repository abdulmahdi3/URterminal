import os from 'os'
import { existsSync } from 'fs'
import { isAbsolute, join, delimiter } from 'path'
import { randomUUID } from 'crypto'
import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch'
import type { PtySpawnRequest, PtyDataEvent, PtyExitEvent, PtyTaskInfo } from '@shared/types'

type Emit = (channel: string, payload: PtyDataEvent | PtyExitEvent) => void

function defaultShell(): string {
  if (process.platform === 'win32') {
    return 'powershell.exe'
  }
  return process.env.SHELL || 'bash'
}

/**
 * Build a complete, string-only environment for spawned processes and guarantee
 * a stable home directory. CLIs like `claude` store their config/auth under the
 * home dir (~/.claude.json); a GUI-spawned process can otherwise inherit a
 * sanitized env without HOME/USERPROFILE and re-run onboarding every launch.
 */
function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }
  const home = os.homedir()
  if (!env.HOME) env.HOME = home
  if (process.platform === 'win32' && !env.USERPROFILE) env.USERPROFILE = home
  if (!env.TERM) env.TERM = 'xterm-256color'
  return env
}

/**
 * Resolve a bare command name (e.g. "claude") to a concrete executable + args.
 * node-pty/ConPTY does not search PATH or append PATHEXT like CreateProcess, so
 * we do it here. `.cmd`/`.bat` shims are launched through the shell.
 */
function resolveCommand(command: string): { file: string; args: string[] } {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return { file: command, args: [] }
  }
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32') {
    const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    for (const dir of dirs) {
      for (const ext of exts) {
        const full = join(dir, command + ext)
        if (existsSync(full)) {
          if (/\.(cmd|bat)$/i.test(full)) {
            return { file: process.env.COMSPEC || 'cmd.exe', args: ['/c', full] }
          }
          return { file: full, args: [] }
        }
      }
    }
  } else {
    for (const dir of dirs) {
      const full = join(dir, command)
      if (existsSync(full)) return { file: full, args: [] }
    }
  }
  return { file: command, args: [] } // not found — let pty surface a clear error
}

/** Append caller-supplied args (e.g. ["--continue"]) to a resolved command. */
function appendArgs(
  resolved: { file: string; args: string[] },
  extra: string[] | undefined
): { file: string; args: string[] } {
  if (!extra?.length) return resolved
  return { file: resolved.file, args: [...resolved.args, ...extra] }
}

interface Entry {
  proc: IPty
  paneId: string
  shell: string
  startedAt: number
}

export class PtyManager {
  private ptys = new Map<string, Entry>()

  constructor(private emit: Emit) {}

  spawn(req: PtySpawnRequest): { ptyId: string; shell: string } {
    // If `command` is set we launch that program directly (e.g. `claude`) so it
    // becomes the pty process — no shell prompt, no auto-typing. Otherwise we
    // spawn the user's shell.
    const resolved = req.command
      ? appendArgs(resolveCommand(req.command), req.commandArgs)
      : { file: req.shell || defaultShell(), args: req.shellArgs ?? [] }
    const proc = pty.spawn(resolved.file, resolved.args, {
      name: 'xterm-256color',
      cols: Math.max(2, req.cols || 80),
      rows: Math.max(1, req.rows || 24),
      cwd: req.cwd || os.homedir(),
      env: buildEnv()
    })
    // Label shown in the task manager — include args so "wsl.exe -d Ubuntu" is legible.
    const shell =
      req.command || [resolved.file, ...resolved.args].join(' ').trim() || resolved.file
    const ptyId = randomUUID()
    this.ptys.set(ptyId, { proc, paneId: req.paneId, shell, startedAt: Date.now() })

    // If a startup command was requested (e.g. launching the `claude` CLI),
    // type it once the shell has produced its first output (prompt is ready).
    let startupSent = !req.startupCommand
    proc.onData((data) => {
      this.emit('pty:data', { ptyId, paneId: req.paneId, data })
      if (!startupSent) {
        startupSent = true
        setTimeout(() => {
          try {
            proc.write(`${req.startupCommand}\r`)
          } catch {
            /* pty may have exited */
          }
        }, 150)
      }
    })
    proc.onExit(({ exitCode }) => {
      this.emit('pty:exit', { ptyId, paneId: req.paneId, exitCode })
      this.ptys.delete(ptyId)
    })

    return { ptyId, shell }
  }

  write(ptyId: string, data: string): void {
    this.ptys.get(ptyId)?.proc.write(data)
  }

  resize(ptyId: string, cols: number, rows: number): void {
    const entry = this.ptys.get(ptyId)
    if (!entry) return
    try {
      entry.proc.resize(Math.max(2, cols), Math.max(1, rows))
    } catch {
      /* resize can throw if the pty just exited */
    }
  }

  kill(ptyId: string): void {
    const entry = this.ptys.get(ptyId)
    if (!entry) return
    try {
      entry.proc.kill()
    } catch {
      /* already gone */
    }
    this.ptys.delete(ptyId)
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id)
  }

  /** Snapshot of every live PTY for the renderer's task manager. */
  list(): PtyTaskInfo[] {
    const tasks: PtyTaskInfo[] = []
    for (const [ptyId, e] of this.ptys) {
      tasks.push({ ptyId, paneId: e.paneId, pid: e.proc.pid, shell: e.shell, startedAt: e.startedAt })
    }
    return tasks
  }

  get count(): number {
    return this.ptys.size
  }
}
