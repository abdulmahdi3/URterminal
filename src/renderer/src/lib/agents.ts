import { AGENTS } from '@shared/providers'

/**
 * Which agent CLIs are installed on PATH. Checked once at startup (and cached)
 * so the launcher dropdown + command palette can flag missing agents instead of
 * failing only after the user picks a folder.
 */
let availableCache = new Set<string>()

export async function refreshAgentAvailability(): Promise<Set<string>> {
  try {
    availableCache = new Set(await window.api.checkCommands([...AGENTS]))
  } catch {
    /* keep the previous snapshot on failure */
  }
  return availableCache
}

export function getAvailableAgents(): Set<string> {
  return availableCache
}

export function isAgentAvailable(command: string): boolean {
  return availableCache.has(command)
}
