import type { ProviderId } from './types'

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  ollama: 'Ollama (local)',
  lmstudio: 'LM Studio (local)'
}

export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'ollama', 'lmstudio']

/** Providers backed by a local server (configurable base URL, no API key, live
 *  model discovery). Used by the settings UI, the learning runner, and the
 *  discovery dispatcher to branch away from the hosted/API-key providers. */
export function isLocalProvider(p: ProviderId): boolean {
  return p === 'ollama' || p === 'lmstudio'
}

/**
 * Known model ids per provider, NEWEST FIRST. The first entry is treated as the
 * "latest" everywhere (settings default + the "latest" tag), so keeping this
 * list current is the single place to update when a new model ships.
 */
export const DEFAULT_MODELS: Record<ProviderId, string[]> = {
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  // Local providers discover their real model list at runtime; these are only a
  // fallback shown when the server is unreachable (Ollama) / empty (LM Studio).
  ollama: ['llama3.1', 'qwen2.5', 'mistral'],
  lmstudio: []
}

/** The latest model id for a provider (top of its `DEFAULT_MODELS` list), or ''
 *  when the provider has no static fallback (local providers discover live). */
export function latestModel(provider: ProviderId): string {
  return DEFAULT_MODELS[provider][0] ?? ''
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
export const DEFAULT_LMSTUDIO_URL = 'http://127.0.0.1:1234'

/** The default base URL for a local provider (empty for non-local providers). */
export function defaultLocalBaseUrl(provider: ProviderId): string {
  if (provider === 'ollama') return DEFAULT_OLLAMA_URL
  if (provider === 'lmstudio') return DEFAULT_LMSTUDIO_URL
  return ''
}

// ---------------------------------------------------------------------------
// Agent CLIs launched inside terminal panes (the "AI pane" runs one of these).
//
// The AGENT_REGISTRY below is the SINGLE SOURCE OF TRUTH. To add a new agent
// (e.g. a new vendor CLI), append one entry here — every derived export
// (AGENTS / AGENT_LABELS / AGENT_RESUME) and all consumers update automatically.
// ---------------------------------------------------------------------------

export interface AgentDescriptor {
  /** Stable id used everywhere (pane identity, settings, icons). For a plain
   *  single-binary agent this is also the command spawned on PATH. */
  id: string
  /** Friendly name shown in the launcher, palette and pane title. */
  label: string
  /**
   * Program actually spawned on PATH. Defaults to `id`. Set this when the agent
   * is invoked through a host binary — e.g. the `gh copilot` extension spawns
   * `gh` with `launchArgs: ['copilot']` while keeping the id `gh-copilot`.
   */
  bin?: string
  /** Args prepended at launch (before any resume args), e.g. ['copilot']. */
  launchArgs?: string[]
  /**
   * Presence probe used to decide if the agent is installed. Defaults to [bin|id].
   * The first element is the base program checked on PATH; extra elements
   * document the full invocation for multi-word agents (e.g. ['gh','copilot']).
   */
  detect?: string[]
  /**
   * Args that make the CLI resume its most recent conversation in the same cwd.
   * When a pane is restored from a saved session, an agent with `resumeArgs` is
   * relaunched WITH them so it continues with its real memory/context (the CLI
   * reprints its own history). Agents without it fall back to visual replay of
   * the saved terminal transcript. Only set this once a CLI's flag is confirmed.
   */
  resumeArgs?: string[]
  /**
   * For CLIs that support addressable sessions by a caller-chosen id (Claude):
   * `pin` is the flag that STARTS a conversation with a known id
   * (`--session-id <id>`), `resume` is the flag that RESUMES that exact
   * conversation later (`--resume <id>`). This is what lets each pane own one
   * conversation regardless of how many panes share a folder — unlike
   * `resumeArgs` (`--continue`), which only resumes the most-recent session.
   * Pinning is create-only (errors if the id already exists) and resume is
   * resume-only (errors if it doesn't), so callers must pick the right one.
   */
  sessionId?: { pin: string; resume: string }
  /** Shown when the agent is selected but not found on PATH. */
  installHint?: string
  /**
   * Capabilities the learning layer can exploit. `streamJson` means the CLI can
   * emit a structured/headless transcript (e.g. Claude Code's
   * `--output-format stream-json`), which a later slice can capture verbatim
   * instead of scraping the ANSI screen.
   */
  supports?: { streamJson?: boolean }
  /** Where this descriptor came from. Built-ins are always listed; the others
   *  are discovered at runtime (main process) and merged in. `local-model` is one
   *  installed Ollama model surfaced as a chat agent (`ollama run <model>`). */
  source?: 'builtin' | 'manifest' | 'gh-extension' | 'local-model'
}

/** Result of runtime agent discovery (built-ins + user manifest + gh extensions). */
export interface AgentDiscovery {
  /** The merged descriptor list, in display order. */
  agents: AgentDescriptor[]
  /** Ids of the agents whose CLI is actually installed on PATH. */
  available: string[]
}

/** The program + full arg list to spawn for an agent (resume args appended by the caller). */
export function agentLaunch(
  d: AgentDescriptor | undefined,
  id: string
): { command: string; args: string[] } {
  if (!d) return { command: id, args: [] }
  return { command: d.bin ?? d.id, args: [...(d.launchArgs ?? [])] }
}

export const AGENT_REGISTRY: AgentDescriptor[] = [
  {
    id: 'claude',
    label: 'Claude',
    installHint: 'npm i -g @anthropic-ai/claude-code',
    // Each pane pins its own conversation via `--session-id` and resumes it with
    // `--resume`; `--continue` stays as the legacy fallback for panes saved before
    // session-id pinning existed (no pinned id → resume the most-recent in cwd).
    resumeArgs: ['--continue'],
    sessionId: { pin: '--session-id', resume: '--resume' },
    supports: { streamJson: true }
  },
  { id: 'codex', label: 'ChatGPT (Codex)', installHint: 'npm i -g @openai/codex' },
  { id: 'gemini', label: 'Gemini', installHint: 'npm i -g @google/gemini-cli' },
  { id: 'aider', label: 'Aider', installHint: 'python -m pip install aider-chat' },
  { id: 'opencode', label: 'OpenCode', installHint: 'npm i -g opencode-ai' },
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

/**
 * The pin/resume session flags for a launch command, or undefined if the agent
 * doesn't support caller-pinned session ids. Used to decide whether a pane gets
 * its own `--session-id` and how to relaunch it on restore.
 */
export function sessionFlagsFor(
  command: string | undefined
): { pin: string; resume: string } | undefined {
  return agentDescriptor(command)?.sessionId
}
