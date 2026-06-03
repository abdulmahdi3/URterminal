import { AGENT_REGISTRY, type AgentDescriptor } from '@shared/providers'

/**
 * The agent CLIs known to this session and which are installed on PATH.
 *
 * Discovered once at startup (and re-discovered on demand) via the main process,
 * which merges the built-in registry with the user manifest and any installed
 * `gh` agent extensions. Until that resolves we fall back to the built-ins so
 * the launcher renders immediately.
 */
let agentsCache: AgentDescriptor[] = [...AGENT_REGISTRY]
let availableCache = new Set<string>()

export async function refreshAgentAvailability(): Promise<Set<string>> {
  try {
    const { agents, available } = await window.api.discoverAgents()
    if (agents?.length) agentsCache = agents
    availableCache = new Set(available)
  } catch {
    /* keep the previous snapshot on failure */
  }
  return availableCache
}

/** The full discovered agent list (built-ins + manifest + gh extensions). */
export function getAgents(): AgentDescriptor[] {
  return agentsCache
}

/** Lookup a discovered descriptor by id (falls back to built-ins before discovery). */
export function getAgentDescriptor(id: string | undefined): AgentDescriptor | undefined {
  if (!id) return undefined
  return agentsCache.find((a) => a.id === id)
}

/** Friendly label for an agent id, or the id itself if unknown. */
export function getAgentLabel(id: string): string {
  return getAgentDescriptor(id)?.label ?? id
}

export function getAvailableAgents(): Set<string> {
  return availableCache
}

export function isAgentAvailable(id: string): boolean {
  return availableCache.has(id)
}
