import { execFile } from 'child_process'
import os from 'os'
import type { SystemProcess } from '@shared/types'

const CORES = Math.max(1, os.cpus().length)

// PowerShell `Get-Process` uses the .NET process API directly, which enumerates
// in ~3× less time than `tasklist` or a Win32_Process CIM query on a busy box.
// We emit one compact `pid|name|workingSet|cpuMs` line per process. CPU is the
// cumulative processor time (seconds → ms); we derive a live % from its delta.
const PS_SCRIPT =
  "Get-Process | ForEach-Object { '{0}|{1}|{2}|{3}' -f " +
  '$_.Id,$_.ProcessName,$_.WorkingSet64,([int64]($_.CPU*1000)) }'

/** A pre-parsed process row, before CPU% is derived from the cross-sample delta. */
export interface RawProc {
  pid: number
  name: string
  /** resident memory in bytes */
  rssBytes: number
  /** cumulative CPU time in ms */
  cpuMs: number
}

// Previous cumulative CPU ms per pid, so we can turn cumulative time into a rate.
let prevCpu = new Map<number, number>()
let prevAt = 0

/**
 * Turn cumulative-CPU rows into UI rows with a live CPU%, derived from the delta
 * since the previous sample. Pure given the prior state — unit-tested. Returns
 * the rows plus the next cumulative map (the caller stores it for next time).
 */
export function computeProcs(
  rows: RawProc[],
  now: number,
  prev: Map<number, number>,
  prevTime: number,
  cores = CORES
): { procs: SystemProcess[]; nextCpu: Map<number, number>; at: number } {
  const elapsedMs = prevTime ? Math.max(1, now - prevTime) : 0
  const nextCpu = new Map<number, number>()
  const procs: SystemProcess[] = []
  for (const r of rows) {
    if (!Number.isFinite(r.pid) || r.pid <= 0) continue
    nextCpu.set(r.pid, r.cpuMs)
    let cpuPercent = 0
    if (elapsedMs > 0) {
      const before = prev.get(r.pid)
      if (before !== undefined) {
        cpuPercent = ((r.cpuMs - before) / elapsedMs / cores) * 100
        cpuPercent = Math.min(100, Math.max(0, Math.round(cpuPercent * 10) / 10))
      }
    }
    procs.push({
      pid: r.pid,
      name: r.name || `pid ${r.pid}`,
      memMB: Math.round((r.rssBytes / 1024 / 1024) * 10) / 10,
      cpuPercent
    })
  }
  return { procs, nextCpu, at: now }
}

/** Parse PowerShell's `pid|name|workingSet|cpuMs` lines into raw rows. */
export function parsePsWin(stdout: string): RawProc[] {
  const rows: RawProc[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue
    const f = line.split('|')
    if (f.length < 4) continue
    const pid = parseInt(f[0], 10)
    if (!Number.isFinite(pid) || pid <= 0) continue
    rows.push({
      pid,
      name: f[1] || `pid ${pid}`,
      rssBytes: parseInt(f[2], 10) || 0,
      cpuMs: parseInt(f[3], 10) || 0
    })
  }
  return rows
}

/** Parse a POSIX cumulative-CPU TIME field ("[[D-]H:]M:S[.frac]") into ms. */
export function parseCpuTime(s: string): number {
  if (!s) return 0
  let days = 0
  let rest = s.trim()
  const dash = rest.indexOf('-')
  if (dash >= 0) {
    days = parseInt(rest.slice(0, dash), 10) || 0
    rest = rest.slice(dash + 1)
  }
  const nums = rest.split(':').map((p) => parseFloat(p) || 0)
  while (nums.length < 3) nums.unshift(0) // pad to [H, M, S]
  const seconds = days * 86400 + nums[0] * 3600 + nums[1] * 60 + nums[2]
  return Math.round(seconds * 1000)
}

/**
 * Parse `ps -A -o pid=,rss=,time=,comm=` output (macOS + Linux). `comm` is last
 * because it can contain spaces; we take everything after the first three
 * columns as the command and show its basename.
 */
export function parsePsPosix(stdout: string): RawProc[] {
  const rows: RawProc[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const pid = parseInt(m[1], 10)
    if (!Number.isFinite(pid) || pid <= 0) continue
    const comm = m[4].trim()
    const name = comm.split(/[\\/]/).pop() || comm || `pid ${pid}`
    rows.push({
      pid,
      name,
      rssBytes: (parseInt(m[2], 10) || 0) * 1024, // ps reports rss in KB
      cpuMs: parseCpuTime(m[3])
    })
  }
  return rows
}

/**
 * Enumerate every OS process with name, resident memory and a derived CPU%.
 * Uses PowerShell on Windows and `ps` on macOS/Linux. Resolves to [] on failure
 * so the UI degrades gracefully.
 */
export function listSystemProcesses(): Promise<SystemProcess[]> {
  const win = process.platform === 'win32'
  return new Promise((resolve) => {
    const done = (rows: RawProc[]): void => {
      const { procs, nextCpu, at } = computeProcs(rows, Date.now(), prevCpu, prevAt)
      prevCpu = nextCpu
      prevAt = at
      resolve(procs)
    }
    if (win) {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
        { maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 8000 },
        (err, stdout) => done(err || !stdout ? [] : parsePsWin(stdout))
      )
    } else {
      // BSD/coreutils ps both accept this header-less, =-suffixed column form.
      execFile(
        'ps',
        ['-A', '-o', 'pid=,rss=,time=,comm='],
        { maxBuffer: 16 * 1024 * 1024, timeout: 8000 },
        (err, stdout) => done(err || !stdout ? [] : parsePsPosix(stdout))
      )
    }
  })
}

/** Force-terminate a process (and its children) by pid. */
export function killSystemProcess(pid: number): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true }, () => {})
  } else {
    try {
      process.kill(pid)
    } catch {
      /* already gone or not permitted */
    }
  }
}
