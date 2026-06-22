/**
 * Uregant hardware detection (UREGANT_PLAN.md §4.1) — GPU/VRAM, RAM, disk, CPU.
 * Cross-platform, best-effort, never throws. NVIDIA via nvidia-smi (any OS);
 * Windows GPU name via WMI (AdapterRAM is a uint32 — unreliable for >4GB cards,
 * so VRAM is omitted there); macOS via system_profiler (Apple Silicon unified
 * memory counts as VRAM). Disk via fs.statfs (no subprocess).
 */
import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import os from 'node:os'
import type { HardwareInfo } from '@shared/uregantModels'

function run(file: string, args: string[], timeout = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) =>
        resolve(err ? null : String(stdout))
      )
    } catch {
      resolve(null)
    }
  })
}

type GpuInfo = Pick<HardwareInfo, 'gpuName' | 'vramTotalMB' | 'vramFreeMB' | 'vramSource'>

async function detectGpu(): Promise<GpuInfo> {
  // 1) nvidia-smi — works on any OS when an NVIDIA driver is present
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'])
  if (smi) {
    const line = smi.split('\n').map((s) => s.trim()).filter(Boolean)[0]
    if (line) {
      const [name, total, free] = line.split(',').map((s) => s.trim())
      const t = parseInt(total, 10)
      const f = parseInt(free, 10)
      if (Number.isFinite(t)) {
        return { gpuName: name, vramTotalMB: t, vramFreeMB: Number.isFinite(f) ? f : undefined, vramSource: 'nvidia-smi' }
      }
    }
  }
  // 2) Windows WMI — GPU name only (AdapterRAM caps at 4GB; not trustworthy)
  if (process.platform === 'win32') {
    const ps = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name'
    ])
    if (ps && ps.trim()) return { gpuName: ps.trim(), vramSource: 'wmi' }
  }
  // 3) macOS — system_profiler (Apple Silicon: unified memory handled by caller)
  if (process.platform === 'darwin') {
    const sp = await run('system_profiler', ['SPDisplaysDataType'])
    if (sp) {
      const m = /Chipset Model:\s*(.+)/.exec(sp)
      return { gpuName: m?.[1]?.trim(), vramSource: 'macos' }
    }
  }
  return { vramSource: 'none' }
}

async function detectDiskFreeMB(): Promise<number | undefined> {
  try {
    const s = await statfs(os.homedir())
    return Math.round((s.bavail * s.bsize) / (1024 * 1024))
  } catch {
    return undefined
  }
}

export async function detectHardware(): Promise<HardwareInfo> {
  const [gpu, diskFreeMB] = await Promise.all([detectGpu(), detectDiskFreeMB()])
  const ramTotalMB = Math.round(os.totalmem() / (1024 * 1024))
  const ramFreeMB = Math.round(os.freemem() / (1024 * 1024))

  let vramTotalMB = gpu.vramTotalMB
  // Apple Silicon: unified memory acts as VRAM for Metal/Ollama
  if (gpu.vramSource === 'macos' && process.arch === 'arm64' && vramTotalMB == null) {
    vramTotalMB = ramTotalMB
  }

  return {
    platform: process.platform,
    cpuCores: os.cpus().length,
    ramTotalMB,
    ramFreeMB,
    gpuName: gpu.gpuName,
    vramTotalMB,
    vramFreeMB: gpu.vramFreeMB,
    diskFreeMB,
    vramSource: gpu.vramSource
  }
}
