/**
 * Uregant command policy (UREGANT_PLAN.md §11.2, §11.5).
 *
 * Default-DENY decision model: in Auto-safe, only a conservative ALLOWLIST of
 * read/build commands auto-run; everything else needs human approval. A hard-deny
 * tripwire (safety.ts) + network/publish + secret-path checks BLOCK outright
 * regardless of mode. Manual asks for every mutating action; Full-auto runs all
 * but the hard-denies. This is the decision layer; per-folder trusted-root
 * confinement ships with the §17 trusted-folder manager.
 */
import type { UrToolCall, UrAutonomy } from '@shared/uregant'
import { UR_READONLY_TOOLS, UR_DONE_TOOL } from '@shared/uregantTools'
import { isHardDenied } from './safety'

export type UrDecision = 'allow' | 'ask' | 'deny'

const SECRET_PATHS = [/\.ssh\b/i, /\.aws\b/i, /\.gnupg\b/i, /\.claude\.json\b/i, /\bid_rsa\b/i, /\.pem\b/i, /\.env(\.[\w]+)?\b/i, /\.key\b/i, /\bcredentials\b/i]
const NETWORK_DENY = [/\bgit\s+push\b/i, /\bnpm\s+publish\b/i, /\b(scp|rsync|sftp|ftp)\b/i, /\bcurl\b/i, /\bwget\b/i, /\bInvoke-WebRequest\b/i, /\bInvoke-RestMethod\b/i]
// conservative read/build allowlist (auto-run only when no shell chaining is present)
const ALLOW = [
  /^git\s+(status|diff|log|branch|show|rev-parse|remote|describe|fetch|ls-files)\b/i,
  /^(ls|dir|pwd|cat|type|head|tail|wc|find|grep|rg|echo|whoami|hostname|date|tree|stat|file|which|where)\b/i,
  /^(node\s+(-v|--version)|npm\s+(run\s+(build|test|lint|typecheck)|test|ci|ls|list|--version)|pnpm\s+(build|test|lint|typecheck)|yarn\s+(build|test|lint))\b/i,
  /^(tsc(\s|$)|vitest\b|jest\b|eslint\b|prettier\b)/i,
  /^(python3?\s+--version|pip\s+list|cargo\s+(build|test|check|clippy)|go\s+(build|test|vet))\b/i
]
const SHELL_OPS = /[|&;`$><]/

const refsSecret = (s: string): boolean => SECRET_PATHS.some((re) => re.test(s))

export function classify(call: UrToolCall, autonomy: UrAutonomy): { decision: UrDecision; reason?: string } {
  const name = call.function.name
  const args = call.function.arguments ?? {}

  if (UR_READONLY_TOOLS.has(name) || name === UR_DONE_TOOL || name === 'checkpoint') return { decision: 'allow' }

  if (name === 'run_command') {
    const cmd = String(args.command ?? '')
    if (isHardDenied(cmd).denied) return { decision: 'deny', reason: `destructive command (${isHardDenied(cmd).reason})` }
    if (NETWORK_DENY.some((re) => re.test(cmd))) return { decision: 'deny', reason: 'network/publish command blocked' }
    if (refsSecret(cmd) || refsSecret(String(args.cwd ?? ''))) return { decision: 'deny', reason: 'references a secret path' }
    if (autonomy === 'manual') return { decision: 'ask' }
    if (autonomy === 'full-auto') return { decision: 'allow' }
    if (!SHELL_OPS.test(cmd) && ALLOW.some((re) => re.test(cmd.trim()))) return { decision: 'allow' }
    return { decision: 'ask' } // auto-safe, not in the allowlist
  }

  if (name === 'rollback') return autonomy === 'full-auto' ? { decision: 'allow' } : { decision: 'ask' }

  if (name === 'write_to_pane') return autonomy === 'full-auto' ? { decision: 'allow' } : { decision: 'ask' }

  if (name === 'open_pane') return autonomy === 'manual' ? { decision: 'ask' } : { decision: 'allow' }

  // unknown / other mutating tool
  return autonomy === 'full-auto' ? { decision: 'allow' } : { decision: 'ask' }
}

/** Worst-case decision across a batch, with per-index deny reasons. */
export function decideBatch(
  calls: UrToolCall[],
  autonomy: UrAutonomy
): { decision: UrDecision; reasons: Record<number, string> } {
  const reasons: Record<number, string> = {}
  let decision: UrDecision = 'allow'
  calls.forEach((c, i) => {
    const r = classify(c, autonomy)
    if (r.decision === 'deny') {
      reasons[i] = r.reason ?? 'blocked by policy'
      decision = 'deny'
    } else if (r.decision === 'ask' && decision !== 'deny') {
      decision = 'ask'
    }
  })
  return { decision, reasons }
}
