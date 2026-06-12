/**
 * Available shells for new shell panes. The built-ins are chosen per host OS
 * (PowerShell/cmd on Windows; the POSIX shells on macOS/Linux). Installed WSL
 * distros are detected once at startup (Windows only; UTF-16 parsing happens in
 * the main process) and cached here so `getShellSpecs()` stays synchronous for
 * the command palette.
 */
import { platform, primeOsInfo } from './osInfo'

export interface ShellSpec {
  id: string
  label: string
  /** binary to spawn (e.g. "wsl.exe"); blank string = OS default shell */
  file: string
  /** extra args (e.g. ["-d", "Ubuntu"]) */
  args?: string[]
}

const WINDOWS_BUILTINS: ShellSpec[] = [
  { id: 'powershell', label: 'PowerShell', file: 'powershell.exe' },
  // Elevated PowerShell. A non-elevated app can't host an elevated shell inside
  // its own pty, so this launches one via UAC (Start-Process -Verb RunAs).
  {
    id: 'powershell-admin',
    label: 'PowerShell (Admin)',
    file: 'powershell.exe',
    args: ['-NoProfile', '-Command', 'Start-Process powershell -Verb RunAs']
  },
  { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe' }
]

// macOS default login shell is zsh; most Linux distros default to bash. The
// "Default shell" entry spawns with a blank file so the main process uses the
// user's $SHELL. The explicit entries are offered too — a not-installed shell
// just surfaces a clear pty spawn error, matching how Windows handles its own.
const MAC_BUILTINS: ShellSpec[] = [
  { id: 'default', label: 'Default shell', file: '' },
  { id: 'zsh', label: 'Zsh', file: 'zsh' },
  { id: 'bash', label: 'Bash', file: 'bash' },
  { id: 'sh', label: 'sh', file: 'sh' }
]

const LINUX_BUILTINS: ShellSpec[] = [
  { id: 'default', label: 'Default shell', file: '' },
  { id: 'bash', label: 'Bash', file: 'bash' },
  { id: 'zsh', label: 'Zsh', file: 'zsh' },
  { id: 'sh', label: 'sh', file: 'sh' }
]

/** Built-in shells for a host OS (pure — unit-tested). */
export function builtinShells(host: NodeJS.Platform): ShellSpec[] {
  if (host === 'win32') return WINDOWS_BUILTINS
  if (host === 'darwin') return MAC_BUILTINS
  return LINUX_BUILTINS
}

let wslDistros: { name: string; default: boolean }[] = []

/** Fetch the installed WSL distros and cache them (call once on startup). Also
 *  primes the cached platform so `getShellSpecs()` picks the right built-ins. */
export async function refreshWslDistros(): Promise<void> {
  await primeOsInfo() // ensure platform() is resolved before specs are read
  try {
    wslDistros = await window.api.listWslDistros()
  } catch {
    wslDistros = []
  }
}

/** Built-in shells for the host OS plus one entry per detected WSL distro. */
export function getShellSpecs(): ShellSpec[] {
  const specs = [...builtinShells(platform())]
  for (const d of wslDistros) {
    specs.push({
      id: `wsl:${d.name}`,
      label: `WSL · ${d.name}${d.default ? ' (default)' : ''}`,
      file: 'wsl.exe',
      args: ['-d', d.name]
    })
  }
  return specs
}
