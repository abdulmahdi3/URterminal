/**
 * Available shells for new shell panes. The built-ins are always offered;
 * installed WSL distros are detected once at startup (UTF-16 parsing happens
 * in the main process) and cached here so `getShellSpecs()` stays synchronous
 * for the command palette.
 */
export interface ShellSpec {
  id: string
  label: string
  /** binary to spawn (e.g. "wsl.exe"); blank string = OS default shell */
  file: string
  /** extra args (e.g. ["-d", "Ubuntu"]) */
  args?: string[]
}

const BUILTINS: ShellSpec[] = [
  { id: 'powershell', label: 'PowerShell', file: 'powershell.exe' },
  // Elevated PowerShell. A non-elevated app can't host an elevated shell inside
  // its own pty, so this launches one via UAC (Start-Process -Verb RunAs).
  {
    id: 'powershell-admin',
    label: 'PowerShell (Admin)',
    file: 'powershell.exe',
    args: ['-NoProfile', '-Command', 'Start-Process powershell -Verb RunAs']
  }
]

let wslDistros: { name: string; default: boolean }[] = []

/** Fetch the installed WSL distros and cache them (call once on startup). */
export async function refreshWslDistros(): Promise<void> {
  try {
    wslDistros = await window.api.listWslDistros()
  } catch {
    wslDistros = []
  }
}

/** Built-in shells plus one entry per detected WSL distro (default flagged). */
export function getShellSpecs(): ShellSpec[] {
  const specs = [...BUILTINS]
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
