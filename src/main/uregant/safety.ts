/**
 * Uregant command safety backstop (UREGANT_PLAN.md §11.2).
 *
 * NOTE: the primary gate is human approval in Manual mode (renderer). This is the
 * hard-deny TRIPWIRE that refuses unmistakably destructive / data-exfiltrating
 * commands even if a user clicks approve or autonomy is raised later. A denylist
 * is not a complete sandbox — full path-confinement + allowlist land in a later
 * hardening slice; this is the floor.
 */

const HARD_DENY: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, reason: 'recursive force delete (rm -rf)' },
  { re: /\b(mkfs|fdisk|diskpart)\b/i, reason: 'disk format/partition' },
  { re: /\bdd\b[^\n]*\bof=/i, reason: 'raw disk write (dd of=)' },
  { re: />\s*\/dev\/(sd|nvme|disk)/i, reason: 'write to a raw device' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'power state change' },
  { re: /:\s*\(\s*\)\s*\{.*\}\s*;/, reason: 'fork bomb' },
  { re: /\bgit\s+push\b/i, reason: 'pushing to a remote' },
  { re: /\bnpm\s+publish\b/i, reason: 'publishing a package' },
  { re: /\bcurl\b[^|]*\|\s*(sh|bash|powershell|pwsh|cmd)\b/i, reason: 'pipe-to-shell of remote content' },
  { re: /\bwget\b[^|]*\|\s*(sh|bash)\b/i, reason: 'pipe-to-shell of remote content' },
  { re: /\bFormat-Volume\b|\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force/i, reason: 'destructive PowerShell' }
]

export function isHardDenied(command: string): { denied: boolean; reason?: string } {
  for (const { re, reason } of HARD_DENY) {
    if (re.test(command)) return { denied: true, reason }
  }
  return { denied: false }
}
