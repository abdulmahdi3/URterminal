import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { commandExists } from '../pty/which'
import type { AgentRuntimeStatus } from '@shared/types'

/**
 * Real per-agent status for the launch console — replaces the old hard-coded
 * badges. We probe two things, both best-effort and synchronous:
 *   1. is the CLI on PATH?  → `missing` when not.
 *   2. is it authenticated? → `signin` when we KNOW it isn't, else `ready`.
 *
 * Auth is detected from each CLI's well-known credentials file or an env API
 * key. We only ever report `signin` for agents whose auth location we actually
 * know, so a working agent is never mislabelled "Sign in"; agents with an
 * unknown auth scheme fall back to `ready` once they're installed.
 *
 * `update` (a newer version available) is intentionally NOT reported: there's
 * no reliable, fast, cross-CLI signal for it, and a wrong "Update" badge would
 * be exactly the kind of fake status this replaces.
 */

const HOME = homedir()
const at = (...segs: string[]): string => join(HOME, ...segs)

function exists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}
const anyExists = (paths: string[]): boolean => paths.some(exists)
const hasEnv = (...names: string[]): boolean =>
  names.some((n) => !!process.env[n] && process.env[n]!.trim() !== '')

/** A JSON file exists and has at least one of `keys` set to a non-empty value. */
function jsonHasKey(path: string, keys: string[]): boolean {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return keys.some((k) => data[k] != null && data[k] !== '')
  } catch {
    return false
  }
}

/** The GitHub CLI keeps its OAuth token in hosts.yml (location differs by OS). */
function ghAuthed(): boolean {
  return anyExists([
    at('.config', 'gh', 'hosts.yml'),
    at('AppData', 'Roaming', 'GitHub CLI', 'hosts.yml')
  ])
}

/**
 * Best-effort auth probe per agent command:
 *   true  — positive evidence it's authenticated (creds file / env key present)
 *   false — we know where it keeps auth and it's absent → needs sign-in
 *   null  — unknown auth scheme → caller treats "installed" as ready
 */
function probeAuth(command: string): boolean | null {
  switch (command) {
    case 'claude':
      return (
        exists(at('.claude', '.credentials.json')) ||
        jsonHasKey(at('.claude.json'), ['oauthAccount', 'account']) ||
        hasEnv('ANTHROPIC_API_KEY')
      )
    case 'codex':
      return exists(at('.codex', 'auth.json')) || hasEnv('OPENAI_API_KEY', 'CODEX_API_KEY')
    case 'gemini':
      return (
        anyExists([at('.gemini', 'oauth_creds.json'), at('.gemini', 'google_accounts.json')]) ||
        hasEnv('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY')
      )
    case 'copilot':
      return (
        anyExists([
          at('.config', 'github-copilot', 'apps.json'),
          at('.config', 'github-copilot', 'hosts.json'),
          at('AppData', 'Local', 'github-copilot', 'apps.json')
        ]) || ghAuthed()
      )
    case 'aider':
      return (
        hasEnv('OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY') ||
        anyExists([at('.aider.conf.yml'), at('.config', 'aider', '.env')])
      )
    case 'opencode':
      return anyExists([
        at('.local', 'share', 'opencode', 'auth.json'),
        at('.config', 'opencode', 'auth.json'),
        at('AppData', 'Roaming', 'opencode', 'auth.json')
      ])
    case 'goose':
      return anyExists([
        at('.config', 'goose', 'config.yaml'),
        at('AppData', 'Roaming', 'Block', 'goose', 'config', 'config.yaml')
      ])
    case 'qwen-code':
      return (
        anyExists([at('.qwen', 'oauth_creds.json'), at('.qwen', 'settings.json')]) ||
        hasEnv('DASHSCOPE_API_KEY', 'QWEN_API_KEY', 'OPENAI_API_KEY')
      )
    default:
      // cursor-agent, cline, q, ollama models, manifest agents — unknown scheme.
      return null
  }
}

/** Real status for one agent command: missing → signin → ready. */
export function detectAgentStatus(command: string): AgentRuntimeStatus {
  if (!commandExists(command)) return 'missing'
  return probeAuth(command) === false ? 'signin' : 'ready'
}

/** Real status keyed by command, for the launch console's agent grid. */
export function detectAgentStatuses(commands: string[]): Record<string, AgentRuntimeStatus> {
  const out: Record<string, AgentRuntimeStatus> = {}
  for (const c of commands) out[c] = detectAgentStatus(c)
  return out
}
