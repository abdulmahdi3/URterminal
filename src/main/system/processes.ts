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

// Previous cumulative CPU ms per pid, so we can turn cumulative time into a rate.
let prevCpu = new Map<number, number>()
let prevAt = 0

/**
 * Enumerate every OS process with name, working-set memory and a derived CPU%.
 * Resolves to [] on failure so the UI degrades gracefully.
 */
export function listSystemProcesses(): Promise<SystemProcess[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve([])
          return
        }
        const now = Date.now()
        const elapsedMs = prevAt ? Math.max(1, now - prevAt) : 0
        const nextCpu = new Map<number, number>()
        const procs: SystemProcess[] = []
        for (const line of stdout.split(/\r?\n/)) {
          if (!line) continue
          const f = line.split('|')
          if (f.length < 4) continue
          const pid = parseInt(f[0], 10)
          if (!Number.isFinite(pid) || pid <= 0) continue
          const ws = parseInt(f[2], 10) || 0
          const cpuMs = parseInt(f[3], 10) || 0
          nextCpu.set(pid, cpuMs)
          let cpuPercent = 0
          if (elapsedMs > 0) {
            const before = prevCpu.get(pid)
            if (before !== undefined) {
              cpuPercent = ((cpuMs - before) / elapsedMs / CORES) * 100
              cpuPercent = Math.min(100, Math.max(0, Math.round(cpuPercent * 10) / 10))
            }
          }
          procs.push({
            pid,
            name: f[1] || `pid ${pid}`,
            memMB: Math.round((ws / 1024 / 1024) * 10) / 10,
            cpuPercent
          })
        }
        prevCpu = nextCpu
        prevAt = now
        resolve(procs)
      }
    )
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
