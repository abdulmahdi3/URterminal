import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync, statSync, mkdirSync, rmdirSync } from 'fs'
import { join, dirname, delimiter } from 'path'
import { tmpdir } from 'os'

/**
 * SSHFS mounting for "agent over SSH": mount the remote folder locally via SSHFS
 * (SFTP over SSH — nothing installed on the server), so a LOCAL agent can open it
 * and read/edit files like a normal folder. Commands that must run ON the server
 * still go through the urssh exec bridge.
 *
 * Cross-platform via a small backend per OS, sharing one mount orchestration:
 *   • Windows — SSHFS-Win (WinFsp). Mountpoint = a free drive letter (Z→H).
 *   • macOS   — macFUSE + sshfs. Mountpoint = a created temp directory.
 *   • Linux   — FUSE + sshfs.    Mountpoint = a created temp directory.
 *
 * We use the DIRECT model — spawn sshfs with `-o password_stdin` (the only
 * documented way to pass a password non-interactively) and `-f` (foreground), so
 * the spawned process IS the mount handle; we unmount by detaching the mountpoint
 * and terminating that process.
 */

const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files'
export const SSHFS_BIN = join(PROGRAM_FILES, 'SSHFS-Win', 'bin', 'sshfs.exe')

/** One-line winget install (WinFsp must precede SSHFS-Win) + docs URL. */
export const SSHFS_INSTALL = {
  installCommand:
    'winget install -e --id WinFsp.WinFsp --accept-package-agreements --accept-source-agreements && ' +
    'winget install -e --id SSHFS-Win.SSHFS-Win --accept-package-agreements --accept-source-agreements',
  url: 'https://github.com/winfsp/sshfs-win'
}

/** Per-OS install hint for the POSIX sshfs toolchain. */
export const POSIX_SSHFS_INSTALL: Record<'darwin' | 'linux', { installCommand: string; url: string }> = {
  darwin: {
    // sshfs was dropped from homebrew-core; the gromgit tap is the maintained one.
    installCommand: 'brew install --cask macfuse && brew install gromgit/fuse/sshfs-mac',
    url: 'https://osxfuse.github.io'
  },
  linux: {
    // Debian/Ubuntu; other distros: dnf/pacman install sshfs (FUSE is standard).
    installCommand: 'sudo apt-get install -y sshfs',
    url: 'https://github.com/libfuse/sshfs'
  }
}

/** Whether SSHFS-Win is installed (its sshfs.exe implies WinFsp too, a dependency). */
export function sshfsInstalled(exists: (p: string) => boolean = existsSync): boolean {
  return exists(SSHFS_BIN)
}

/** First `sshfs` found on PATH (POSIX), or null. */
export function findPosixSshfs(
  exists: (p: string) => boolean = existsSync,
  path: string = process.env.PATH || ''
): string | null {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const full = join(dir, 'sshfs')
    if (exists(full)) return full
  }
  return null
}

/**
 * Pick a free drive letter, scanning Z → H so we don't collide with system/local
 * disks (A/B legacy, C system, and typical local letters). `isUsed(letter)` tells
 * us whether a letter is taken. Returns null if none free.
 */
export function pickFreeDrive(isUsed: (letter: string) => boolean): string | null {
  for (let c = 'Z'.charCodeAt(0); c >= 'H'.charCodeAt(0); c--) {
    const letter = String.fromCharCode(c)
    if (!isUsed(letter)) return letter
  }
  return null
}

export interface BuildOpts {
  username: string
  host: string
  port: number
  remotePath?: string
}

/** sshfs source string: empty remotePath = remote home; '/'-prefixed = absolute. */
function sourceOf(opts: BuildOpts): string {
  return `${opts.username}@${opts.host}:${opts.remotePath ?? ''}`
}

/**
 * Build the SSHFS-Win (Windows) argument list. The password is NEVER an argument
 * — it's written to stdin (password_stdin). Mountpoint is a drive letter.
 */
export function buildSshfsArgs(opts: BuildOpts & { drive: string }): string[] {
  const args = [
    '-f', // foreground: the process IS the mount, so we keep the handle to unmount
    sourceOf(opts),
    `${opts.drive}:`, // mountpoint = drive letter (WinFsp creates it)
    '-o', 'password_stdin',
    '-o', 'idmap=user',
    '-o', 'uid=-1,gid=-1',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'reconnect',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'dir_cache=yes'
  ]
  if (opts.port && opts.port !== 22) args.push('-o', `Port=${opts.port}`)
  return args
}

/**
 * Build the POSIX (macOS/Linux) sshfs argument list. Mountpoint is a directory
 * that already exists. Password via stdin (password_stdin), never an argument.
 * The uid/gid=-1 trick is SSHFS-Win-only and is intentionally omitted here.
 */
export function buildSshfsArgsPosix(opts: BuildOpts & { mountpoint: string }): string[] {
  const args = [
    '-f', // foreground: the process IS the mount
    sourceOf(opts),
    opts.mountpoint,
    '-o', 'password_stdin',
    '-o', 'idmap=user',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'reconnect',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3'
  ]
  if (opts.port && opts.port !== 22) args.push('-o', `Port=${opts.port}`)
  return args
}

export interface SshfsMountOpts {
  target: string // connection key ("user@host[:port]")
  host: string
  port: number
  username: string
  password: string
  remotePath?: string
}

/** Status surfaced to the renderer (install state + how to get the toolchain). */
export interface SshfsStatusInfo {
  installed: boolean
  binPath?: string
  installCommand: string
  url: string
}

interface Mount {
  /** drive letter (Windows) or mountpoint directory (POSIX) */
  handle: string
  proc: ChildProcess
  /** browseable absolute path — drive root or the mount directory */
  mountPath: string
}

/**
 * Platform strategy. The orchestration in SshfsManager is shared; only these
 * bits differ per OS (binary, mountpoint kind, spawn env, readiness, teardown).
 */
interface SshfsBackend {
  installed(): boolean
  status(): SshfsStatusInfo
  bin(): string | null
  env(): NodeJS.ProcessEnv
  /** reserve a mountpoint; `taken(h)` reports handles already in use. null = none free. */
  acquire(taken: (h: string) => boolean): string | null
  /** release a reserved-but-unused handle (no mount happened). */
  unreserve(handle: string): void
  /** browseable absolute path for a handle. */
  pathFor(handle: string): string
  args(opts: BuildOpts, handle: string): string[]
  /** has the FUSE mount actually appeared at the handle yet? */
  ready(handle: string): boolean
  /** detach the mountpoint + terminate the process + free the handle (sync, quit-safe). */
  teardown(m: Mount): void
}

const driveRoot = (letter: string): string => `${letter}:\\`

/** Kill a process tree (Windows) / process (fallback). */
function killTree(proc: ChildProcess): void {
  try {
    if (process.platform === 'win32' && typeof proc.pid === 'number')
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
  } catch {
    /* taskkill missing — fall back to proc.kill below */
  }
  try {
    proc.kill()
  } catch {
    /* already gone */
  }
}

class WindowsBackend implements SshfsBackend {
  private reserved = new Set<string>()
  installed(): boolean {
    return sshfsInstalled()
  }
  status(): SshfsStatusInfo {
    const installed = this.installed()
    return {
      installed,
      binPath: installed ? SSHFS_BIN : undefined,
      installCommand: SSHFS_INSTALL.installCommand,
      url: SSHFS_INSTALL.url
    }
  }
  bin(): string | null {
    return this.installed() ? SSHFS_BIN : null
  }
  env(): NodeJS.ProcessEnv {
    return { ...process.env, CYGFUSE: 'WinFsp' }
  }
  acquire(taken: (h: string) => boolean): string | null {
    const used = (l: string): boolean => taken(l) || this.reserved.has(l) || existsSync(driveRoot(l))
    const drive = pickFreeDrive(used)
    if (drive) this.reserved.add(drive)
    return drive
  }
  unreserve(handle: string): void {
    this.reserved.delete(handle)
  }
  pathFor(handle: string): string {
    return driveRoot(handle)
  }
  args(opts: BuildOpts, handle: string): string[] {
    return buildSshfsArgs({ ...opts, drive: handle })
  }
  ready(handle: string): boolean {
    return existsSync(driveRoot(handle))
  }
  teardown(m: Mount): void {
    // Modern WinFsp self-unmounts when the owning process dies; kill the cygwin
    // process TREE (it spawns child ssh/WinFsp helpers) so the drive is released.
    killTree(m.proc)
    this.reserved.delete(m.handle)
  }
}

class PosixBackend implements SshfsBackend {
  private base = join(tmpdir(), 'urterminal-mounts')
  private seq = 0
  private kind: 'darwin' | 'linux' = process.platform === 'darwin' ? 'darwin' : 'linux'

  installed(): boolean {
    return findPosixSshfs() !== null
  }
  status(): SshfsStatusInfo {
    const bin = findPosixSshfs()
    const info = POSIX_SSHFS_INSTALL[this.kind]
    return { installed: !!bin, binPath: bin ?? undefined, installCommand: info.installCommand, url: info.url }
  }
  bin(): string | null {
    return findPosixSshfs()
  }
  env(): NodeJS.ProcessEnv {
    return { ...process.env }
  }
  acquire(taken: (h: string) => boolean): string | null {
    // A fresh, unique directory per mount — created up front so FUSE can mount onto it.
    for (let i = 0; i < 64; i++) {
      const dir = join(this.base, `m${++this.seq}`)
      if (taken(dir) || existsSync(dir)) continue
      try {
        mkdirSync(dir, { recursive: true })
        return dir
      } catch {
        return null // can't create the mount base — give up
      }
    }
    return null
  }
  unreserve(handle: string): void {
    try {
      rmdirSync(handle)
    } catch {
      /* dir may be non-empty or already gone */
    }
  }
  pathFor(handle: string): string {
    return handle
  }
  args(opts: BuildOpts, handle: string): string[] {
    return buildSshfsArgsPosix({ ...opts, mountpoint: handle })
  }
  ready(handle: string): boolean {
    // A FUSE mountpoint's device id differs from its parent once mounted. This is
    // dependency-free and works on both macOS and Linux (no fragile `mount` parse).
    try {
      return statSync(handle).dev !== statSync(dirname(handle)).dev
    } catch {
      return false
    }
  }
  teardown(m: Mount): void {
    // Detach the FUSE mount first so the kernel releases it, then kill the process,
    // then remove the (now empty) mountpoint directory.
    try {
      if (this.kind === 'linux')
        spawnSync('fusermount', ['-u', m.handle], { timeout: 5000 })
      else spawnSync('umount', [m.handle], { timeout: 5000 })
    } catch {
      /* unmount tool missing or already detached */
    }
    killTree(m.proc)
    this.unreserve(m.handle)
  }
}

function makeBackend(): SshfsBackend {
  return process.platform === 'win32' ? new WindowsBackend() : new PosixBackend()
}

export class SshfsManager {
  private backend: SshfsBackend = makeBackend()
  private mounts = new Map<string, Mount>()
  /** in-flight mount promises, so concurrent clicks for a target dedupe (no double mount) */
  private inflight = new Map<string, Promise<{ drive: string; mountPath: string }>>()

  installed(): boolean {
    return this.backend.installed()
  }

  /** Install state + how to obtain the toolchain (platform-aware). */
  status(): SshfsStatusInfo {
    return this.backend.status()
  }

  /** A tracked mount is healthy only if it's still mounted AND its process is alive. */
  private isAlive(m: Mount): boolean {
    return this.backend.ready(m.handle) && m.proc.exitCode === null && !m.proc.killed
  }

  /** Mount (or reuse) the remote folder; resolves once the mount is browseable. */
  mount(opts: SshfsMountOpts): Promise<{ drive: string; mountPath: string }> {
    const live = this.mounts.get(opts.target)
    if (live) {
      if (this.isAlive(live)) return Promise.resolve({ drive: live.handle, mountPath: live.mountPath })
      this.cleanup(opts.target) // stale/dead — tear it down before remounting
    }
    const pending = this.inflight.get(opts.target)
    if (pending) return pending
    const p = this.doMount(opts).finally(() => this.inflight.delete(opts.target))
    this.inflight.set(opts.target, p)
    return p
  }

  private async doMount(opts: SshfsMountOpts): Promise<{ drive: string; mountPath: string }> {
    if (!this.backend.installed()) throw new Error('SSHFS is not installed')
    // Try up to 2 mountpoints: one can be wedged by a prior failed/half mount, so
    // don't fail outright — route around it.
    let lastErr: Error | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const taken = (h: string): boolean => [...this.mounts.values()].some((m) => m.handle === h)
      const handle = this.backend.acquire(taken)
      if (!handle) break
      try {
        return await this.tryMountOn(opts, handle)
      } catch (e) {
        lastErr = e as Error
      }
    }
    throw lastErr ?? new Error('No mountpoint available to mount the remote folder')
  }

  private async tryMountOn(
    opts: SshfsMountOpts,
    handle: string
  ): Promise<{ drive: string; mountPath: string }> {
    const mountPath = this.backend.pathFor(handle)
    const bin = this.backend.bin()
    if (!bin) {
      this.backend.unreserve(handle)
      throw new Error('SSHFS binary not found')
    }
    const args = this.backend.args(
      { username: opts.username, host: opts.host, port: opts.port, remotePath: opts.remotePath },
      handle
    )
    const proc = spawn(bin, args, { windowsHide: true, env: this.backend.env() })
    // Track immediately so a quit/cleanup during the mount window can still reap
    // the process and free the mountpoint — it isn't an orphan.
    this.mounts.set(opts.target, { handle, proc, mountPath })

    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    // A short-lived child that dies immediately can emit an async EPIPE on stdin;
    // an unhandled stream 'error' would crash the main process. Swallow it.
    proc.stdin?.on('error', () => {})
    try {
      proc.stdin?.write(opts.password + '\n')
      proc.stdin?.end()
    } catch {
      /* stdin may already be closed if the process died immediately */
    }

    // Mounting is async: poll readiness until it appears, racing against an early
    // process exit (= failure) and an overall timeout.
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (fn: () => void): void => {
          if (settled) return
          settled = true
          clearInterval(poll)
          clearTimeout(timeout)
          fn()
        }
        const poll = setInterval(() => {
          if (this.backend.ready(handle)) finish(resolve)
        }, 250)
        const timeout = setTimeout(
          () => finish(() => reject(new Error(`SSHFS mount timed out: ${stderr.trim().slice(0, 300)}`))),
          12000
        )
        proc.on('exit', (code) =>
          finish(() =>
            reject(new Error(`sshfs exited (${code ?? '?'}): ${stderr.trim().slice(0, 300) || 'mount failed'}`))
          )
        )
        proc.on('error', (e) => finish(() => reject(e)))
      })
    } catch (e) {
      this.cleanup(opts.target) // detach + kill + free the mountpoint
      throw e
    }

    return { drive: handle, mountPath }
  }

  private cleanup(target: string): void {
    const m = this.mounts.get(target)
    if (!m) return
    this.mounts.delete(target)
    this.backend.teardown(m)
  }

  unmount(target: string): void {
    this.cleanup(target)
  }

  unmountAll(): void {
    for (const target of [...this.mounts.keys()]) this.cleanup(target)
  }
}
