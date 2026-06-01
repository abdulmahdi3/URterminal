import os from 'os'
import { existsSync } from 'fs'
import { isAbsolute, join, delimiter } from 'path'
import { randomUUID } from 'crypto'
import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import type { PtySpawnRequest, PtyDataEvent, PtyExitEvent, PtyTaskInfo } from '@shared/types'
import type { PtyLike } from '../ssh/sshPty'
import type { CaptureSink } from '../learning/capture'

/** Sink that records every pane's complete output history for session restore. */
export interface TranscriptSink {
  append(paneId: string, data: string): void
  /** clear a pane's recorded history (resumable agents reprint their own). */
  reset(paneId: string): void
}

type Emit = (channel: string, payload: PtyDataEvent | PtyExitEvent) => void

// pty:data → renderer IPC is coalesced per pty on a short timer so a chatty CLI
// (measured ~1700 output events/sec under load) collapses into a handful of
// messages per frame instead of flooding the renderer with thousands of IPC
// round-trips. The learning-capture tap still sees every raw chunk (it runs
// in-process, no IPC), so only the renderer-bound emit is batched.
const OUTPUT_FLUSH_MS = 8
// Flush immediately once the pending buffer passes this size, to bound latency
// and memory during a huge burst (e.g. `cat` of a big file) rather than waiting.
const OUTPUT_FLUSH_MAX = 256 * 1024

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
  // node-pty's IPty satisfies PtyLike, as does the SSH session adapter, so both
  // local shells and SSH sessions live in the same map and share write/resize/kill.
  proc: PtyLike
  paneId: string
  shell: string
  startedAt: number
  // Agent id (the launched command, e.g. "claude") and cwd, captured at spawn so
  // the learning sink can tag transcripts without re-deriving them. Absent for
  // plain shells (no command) and adopted SSH sessions.
  command?: string
  cwd?: string
  // Pending pty:data awaiting the next flush, plus the scheduled flush timer
  // (null when the buffer is empty). See OUTPUT_FLUSH_MS / bufferOutput.
  buf: string
  flushTimer: ReturnType<typeof setTimeout> | null
}

export class PtyManager {
  private ptys = new Map<string, Entry>()

  // Optional learning-layer tap. When set, every pty's output + lifecycle is
  // mirrored to it. PtyManager imports nothing from the learning domain beyond
  // this interface, so the feature stays cleanly decoupled (and absent = no-op).
  private capture?: CaptureSink

  // Optional transcript tap. Records the full output history of every pane for
  // session restore. Decoupled like `capture` (absent = no-op).
  private transcript?: TranscriptSink

  constructor(private emit: Emit) {}

  setCaptureSink(sink: CaptureSink): void {
    this.capture = sink
  }

  setTranscriptSink(sink: TranscriptSink): void {
    this.transcript = sink
  }

  /** Append output to a pty's pending buffer, arming (or forcing) a flush. */
  private bufferOutput(ptyId: string, data: string): void {
    const e = this.ptys.get(ptyId)
    if (!e) return
    e.buf += data
    if (e.buf.length >= OUTPUT_FLUSH_MAX) this.flushOutput(ptyId)
    else if (!e.flushTimer) e.flushTimer = setTimeout(() => this.flushOutput(ptyId), OUTPUT_FLUSH_MS)
  }

  /** Emit a pty's buffered output as a single pty:data message (if any). */
  private flushOutput(ptyId: string): void {
    const e = this.ptys.get(ptyId)
    if (!e) return
    if (e.flushTimer) {
      clearTimeout(e.flushTimer)
      e.flushTimer = null
    }
    if (!e.buf) return
    const data = e.buf
    e.buf = ''
    this.emit('pty:data', { ptyId, paneId: e.paneId, data })
  }

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
    this.ptys.set(ptyId, {
      proc,
      paneId: req.paneId,
      shell,
      startedAt: Date.now(),
      command: req.command,
      cwd: req.cwd,
      buf: '',
      flushTimer: null
    })
    // A resumable agent will reprint its full history on launch (e.g. via
    // `--continue`); clear the old log first so the reprint doesn't stack on top.
    if (req.freshLog) this.transcript?.reset(req.paneId)
    this.capture?.onSessionStart({
      ptyId,
      paneId: req.paneId,
      agentId: req.command ?? '',
      cwd: req.cwd ?? ''
    })

    // If a startup command was requested (e.g. launching the `claude` CLI),
    // type it once the shell has produced its first output (prompt is ready).
    let startupSent = !req.startupCommand
    proc.onData((data) => {
      // Capture taps the raw stream in-process (no IPC); only the renderer-bound
      // emit is batched, via bufferOutput.
      this.capture?.onPtyData(req.paneId, data)
      this.transcript?.append(req.paneId, data)
      this.bufferOutput(ptyId, data)
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
      this.flushOutput(ptyId) // deliver any buffered output before the exit event
      this.capture?.onSessionEnd(req.paneId)
      this.emit('pty:exit', { ptyId, paneId: req.paneId, exitCode })
      this.ptys.delete(ptyId)
    })

    return { ptyId, shell }
  }

  /**
   * Adopt an externally-created PtyLike (e.g. an SSH session) so it streams to
   * the renderer through the same pty:data/pty:exit events as a real shell.
   */
  adopt(proc: PtyLike, paneId: string, shell: string): { ptyId: string; shell: string } {
    const ptyId = randomUUID()
    this.ptys.set(ptyId, { proc, paneId, shell, startedAt: Date.now(), buf: '', flushTimer: null })
    // Adopted sessions (SSH) have no agent command; pass an empty agentId so the
    // capture layer treats them as non-agent panes (skipped under aiOnly).
    this.capture?.onSessionStart({ ptyId, paneId, agentId: '', cwd: '' })
    proc.onData((data) => {
      this.capture?.onPtyData(paneId, data)
      this.transcript?.append(paneId, data)
      this.bufferOutput(ptyId, data)
    })
    proc.onExit(({ exitCode }) => {
      this.flushOutput(ptyId)
      this.capture?.onSessionEnd(paneId)
      this.emit('pty:exit', { ptyId, paneId, exitCode })
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
    if (entry.flushTimer) clearTimeout(entry.flushTimer)
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
