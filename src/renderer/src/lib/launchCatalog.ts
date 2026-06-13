/**
 * Presentation catalog for the launch console (the full-screen view shown when a
 * workspace has no panes). This is purely how agents/shells are *shown* — the
 * actual launch still goes through the workspace store (`addPane`) using each
 * entry's `command`. The six built-in registry agents are fully wired; the rest
 * are real coding-agent CLIs surfaced for discovery (clicking opens a pane that
 * launches — or, if the CLI isn't installed, reports it just like any other).
 */
import type { MosaicNode } from 'react-mosaic-component'
import type { Pane, AgentRuntimeStatus } from '@shared/types'
import type { SavedSession } from '@renderer/store/sessions'

/** Display status: the real runtime states from the main-process probe, plus a
 *  transient `checking` shown until that probe resolves. */
export type AgentStatus = AgentRuntimeStatus | 'checking'
export type AgentKind = 'cloud' | 'local'

export interface LaunchAgent {
  /** Spawn command handed to `addPane` (the bare CLI on PATH). */
  command: string
  /** Display name in the card title. */
  name: string
  /** CLI identifier shown under the name (monospace). */
  cli: string
  /** 1–3 letter mark for the colored badge. */
  badge: string
  /** Brand-ish accent hex for the badge + hover (used via a CSS custom prop). */
  color: string
  /** Model / context summary line. */
  model: string
  /** Filter bucket for the All / Cloud / Local tabs. */
  kind: AgentKind
  /** The featured card (gold ring) — Claude. */
  featured?: boolean
  /** Show a small spark by the name (the flagship). */
  spark?: boolean
  /**
   * A provider-gateway card rather than a launchable CLI (OpenRouter has no
   * standalone binary). Clicking it opens Settings → Providers to set the key,
   * instead of spawning a pane.
   */
  configure?: boolean
}

/** The agents, in grid order (4 columns). The last entry, OpenRouter, is a
 *  provider gateway (no CLI) — its card opens Settings rather than launching. */
export const LAUNCH_AGENTS: LaunchAgent[] = [
  { command: 'claude',       name: 'Claude',         cli: 'claude-code',   badge: 'C',   color: '#e8b53e', model: 'Sonnet 4.5 · 200K ctx',  kind: 'cloud', featured: true, spark: true },
  { command: 'codex',        name: 'ChatGPT',        cli: 'codex-cli',     badge: 'GPT', color: '#19c37d', model: 'GPT-5 Codex · 256K ctx', kind: 'cloud' },
  { command: 'gemini',       name: 'Gemini',         cli: 'gemini-cli',    badge: 'G',   color: '#6f86ff', model: '2.5 Pro · 1M ctx',       kind: 'cloud' },
  { command: 'copilot',      name: 'GitHub Copilot', cli: 'copilot-cli',   badge: 'GH',  color: '#c9d1d9', model: 'GPT-5 · 128K ctx',       kind: 'cloud' },
  { command: 'aider',        name: 'Aider',          cli: 'aider',         badge: 'Ai',  color: '#a371f7', model: 'multi-model',            kind: 'local' },
  { command: 'opencode',     name: 'OpenCode',       cli: 'opencode',      badge: 'OC',  color: '#e8973c', model: 'any provider',           kind: 'local' },
  { command: 'cursor-agent', name: 'Cursor',         cli: 'cursor-agent',  badge: 'Cu',  color: '#d3dae6', model: 'Composer · 128K ctx',    kind: 'cloud' },
  { command: 'cline',        name: 'Cline',          cli: 'cline',         badge: 'CL',  color: '#2bb6a3', model: 'any provider',           kind: 'local' },
  { command: 'goose',        name: 'Goose',          cli: 'goose',         badge: 'Go',  color: '#f0688a', model: 'multi-model',            kind: 'local' },
  { command: 'qwen-code',    name: 'Qwen Coder',     cli: 'qwen-code',     badge: 'Qw',  color: '#b06bf0', model: 'Qwen3 Coder · 256K',     kind: 'local' },
  { command: 'q',            name: 'Amazon Q',       cli: 'q-cli',         badge: 'Q',   color: '#46c6e6', model: 'Q Developer',            kind: 'cloud' },
  { command: 'openrouter',   name: 'OpenRouter',     cli: 'openrouter.ai', badge: 'OR',  color: '#6566f1', model: '200+ models · one key',  kind: 'cloud', configure: true }
]

export const STATUS_LABEL: Record<AgentStatus, string> = {
  ready: 'Ready',
  update: 'Update',
  signin: 'Sign in',
  missing: 'Not installed',
  checking: 'Checking…'
}

// ---------------------------------------------------------------------------
// Shell row presentation
// ---------------------------------------------------------------------------

export interface ShellRowMeta {
  /** Primary name (e.g. "PowerShell", "Ubuntu-22.04", "kali-linux"). */
  name: string
  /** Small uppercase tag (e.g. "ADMIN", "DEFAULT") or null. */
  tag: string | null
  /** Monospace sub-line (e.g. "elevated session", "wsl distro"). */
  sub: string
  /** Single-letter key chip. */
  key: string
}

/** Derive the launch-console presentation for a shell spec. */
export function shellRowMeta(spec: { id: string; label: string; file: string; args?: string[] }): ShellRowMeta {
  const isAdmin = (spec.args ?? []).some((a) => /runas/i.test(a))
  const isWsl = /wsl/i.test(spec.file)
  if (isAdmin) {
    return { name: 'PowerShell', tag: 'ADMIN', sub: 'elevated session', key: 'A' }
  }
  if (isWsl) {
    // Label looks like "WSL · Ubuntu (default)" — pull out the distro + default flag.
    const m = spec.label.replace(/^WSL\s*·\s*/i, '')
    const isDefault = /\(default\)/i.test(m)
    const distro = m.replace(/\s*\(default\)\s*/i, '').trim() || 'Linux'
    return {
      name: distro,
      tag: isDefault ? 'DEFAULT' : null,
      sub: 'wsl distro',
      key: distro[0]?.toUpperCase() ?? 'L'
    }
  }
  if (/powershell/i.test(spec.file)) {
    return { name: 'PowerShell', tag: null, sub: 'powershell', key: 'P' }
  }
  if (/cmd/i.test(spec.file)) {
    return { name: 'Command Prompt', tag: null, sub: 'cmd.exe', key: 'C' }
  }
  // POSIX default / explicit shells.
  const name = spec.label
  return { name, tag: /default/i.test(spec.id) ? 'DEFAULT' : null, sub: spec.file || '$SHELL', key: name[0]?.toUpperCase() ?? 'S' }
}

// ---------------------------------------------------------------------------
// Recent-session presentation
// ---------------------------------------------------------------------------

/** A one-line description of a saved session's composition (agents/shells + folder). */
export function sessionDesc(s: SavedSession): string {
  const panes = Object.values(s.panes) as Pane[]
  const agents = panes.filter((p) => p.type === 'ai').length
  const shells = panes.filter((p) => p.type === 'shell').length
  // First folder we can find, shown as its basename (e.g. "uregant-terminal").
  let folder = ''
  for (const p of panes) {
    const cwd = p.agent?.cwd ?? p.shell?.cwd
    if (cwd) {
      folder = cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
      break
    }
  }
  const bits: string[] = []
  if (agents) bits.push(`${agents} agent${agents !== 1 ? 's' : ''}`)
  if (shells) bits.push(`${shells} shell${shells !== 1 ? 's' : ''}`)
  const comp = bits.join(' + ') || `${panes.length} pane${panes.length !== 1 ? 's' : ''}`
  return folder ? `${folder} · ${comp}` : comp
}

/** Count the leaf panes in a mosaic layout tree (for the "N panes" meta). */
export function countLeaves(node: MosaicNode<string> | null): number {
  if (node === null) return 0
  if (typeof node === 'string') return 1
  return countLeaves(node.first) + countLeaves(node.second)
}
