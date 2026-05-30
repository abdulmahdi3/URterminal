import type { ProviderId } from './types'

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  ollama: 'Ollama (local)'
}

export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'ollama']

/**
 * Known model ids per provider, NEWEST FIRST. The first entry is treated as the
 * "latest" everywhere (settings default + the "latest" tag), so keeping this
 * list current is the single place to update when a new model ships.
 */
export const DEFAULT_MODELS: Record<ProviderId, string[]> = {
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  ollama: ['llama3.1', 'qwen2.5', 'mistral']
}

/** The latest model id for a provider (top of its `DEFAULT_MODELS` list). */
export function latestModel(provider: ProviderId): string {
  return DEFAULT_MODELS[provider][0]
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

// ---------------------------------------------------------------------------
// Agent CLIs launched inside terminal panes (the "AI pane" runs one of these).
//
// The AGENT_REGISTRY below is the SINGLE SOURCE OF TRUTH. To add a new agent
// (e.g. a new vendor CLI), append one entry here — every derived export
// (AGENTS / AGENT_LABELS / AGENT_RESUME) and all consumers update automatically.
// ---------------------------------------------------------------------------

export interface AgentDescriptor {
  /** Bare command spawned on PATH — also the stable id used everywhere. */
  id: string
  /** Friendly name shown in the launcher, palette and pane title. */
  label: string
  /**
   * Args that make the CLI resume its most recent conversation in the same cwd.
   * When a pane is restored from a saved session, an agent with `resumeArgs` is
   * relaunched WITH them so it continues with its real memory/context (the CLI
   * reprints its own history). Agents without it fall back to visual replay of
   * the saved terminal transcript. Only set this once a CLI's flag is confirmed.
   */
  resumeArgs?: string[]
  /** Shown when the agent is selected but not found on PATH. */
  installHint?: string
}

export const AGENT_REGISTRY: AgentDescriptor[] = [
  { id: 'claude', label: 'Claude', resumeArgs: ['--continue'] },
  { id: 'codex', label: 'ChatGPT (Codex)' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'aider', label: 'Aider' },
  { id: 'opencode', label: 'OpenCode' },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    installHint: 'npm i -g @github/copilot   (or: gh extension install github/gh-copilot)'
  }
]

/** All agent command ids, in registry order. */
export const AGENTS: string[] = AGENT_REGISTRY.map((a) => a.id)
export type AgentCommand = string

/** Friendly names shown in the launcher + command palette (the bare command is
 *  what actually gets spawned on the PATH). */
export const AGENT_LABELS: Record<string, string> = Object.fromEntries(
  AGENT_REGISTRY.map((a) => [a.id, a.label])
)

export const DEFAULT_AGENT: AgentCommand = 'claude'

/** Lookup a registry entry by its bare command name (path/extension stripped). */
export function agentDescriptor(command: string | undefined): AgentDescriptor | undefined {
  if (!command) return undefined
  const base = command.trim().split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat)$/i, '') ?? command
  return AGENT_REGISTRY.find((a) => a.id === base)
}

/**
 * Resume args keyed by agent id — derived from the registry. Kept as a named
 * export for backwards compatibility with existing consumers.
 */
export const AGENT_RESUME: Partial<Record<string, string[]>> = Object.fromEntries(
  AGENT_REGISTRY.filter((a) => a.resumeArgs).map((a) => [a.id, a.resumeArgs as string[]])
)

/** Resume args for a launch command, or undefined if the agent has no resume support. */
export function resumeArgsFor(command: string | undefined): string[] | undefined {
  return agentDescriptor(command)?.resumeArgs
}
