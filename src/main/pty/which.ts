import { existsSync } from 'fs'
import { isAbsolute, join, delimiter } from 'path'

/**
 * Whether a bare command name resolves to an executable on PATH. Mirrors the
 * lookup `resolveCommand` (manager.ts) does for spawning, so the launcher can
 * tell up front which agent CLIs are actually installed instead of failing only
 * after the user picks a folder.
 */
export function commandExists(command: string): boolean {
  if (!command) return false
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return existsSync(command)
  }
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32') {
    const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    return dirs.some((dir) => exts.some((ext) => existsSync(join(dir, command + ext))))
  }
  return dirs.some((dir) => existsSync(join(dir, command)))
}

/** Subset of `commands` that are installed and on PATH. */
export function filterAvailable(commands: string[]): string[] {
  return commands.filter(commandExists)
}
