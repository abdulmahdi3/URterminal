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
// ---------------------------------------------------------------------------

export const AGENTS = ['claude', 'codex', 'gemini', 'aider', 'opencode'] as const
export type AgentCommand = (typeof AGENTS)[number]

/** Friendly names shown in the launcher + command palette (the bare command is
 *  what actually gets spawned on the PATH). */
export const AGENT_LABELS: Record<AgentCommand, string> = {
  claude: 'Claude',
  codex: 'ChatGPT (Codex)',
  gemini: 'Gemini',
  aider: 'Aider',
  opencode: 'OpenCode'
}

export const DEFAULT_AGENT: AgentCommand = 'claude'

/**
 * Args that make an agent CLI resume its most recent conversation in the same
 * working directory. When a pane is restored from a saved session, an agent
 * listed here is relaunched WITH these args so it continues with its real
 * memory/context (the CLI reprints its own history). Agents not listed here
 * fall back to visual replay of the saved terminal transcript.
 *
 * Only entries we can vouch for are enabled. To add another agent, append its
 * resume flag here once confirmed.
 */
export const AGENT_RESUME: Partial<Record<string, string[]>> = {
  claude: ['--continue'] // resumes the latest Claude Code session in the cwd
}

/** Resume args for a launch command, or undefined if the agent has no resume support. */
export function resumeArgsFor(command: string | undefined): string[] | undefined {
  if (!command) return undefined
  // match on the bare program name (strip any path/extension)
  const base = command.trim().split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat)$/i, '') ?? command
  return AGENT_RESUME[base]
}
