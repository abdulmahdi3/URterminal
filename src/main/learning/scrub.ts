/**
 * Redact secrets from captured text BEFORE it is ever written to disk (and, in
 * later slices, before it is sent to a model). The learning store must never
 * persist API keys, tokens, passwords, private keys or .env values. Runs on both
 * the user prompt and the agent output of every captured turn. Users can layer
 * extra regexes via `learning.scrubExtraPatterns`.
 *
 * This is best-effort defense in depth, not a guarantee — it errs toward
 * over-redaction. Keep it conservative; a false redaction is harmless, a leaked
 * key is not.
 */

const PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'openai-key'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, 'github-token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, 'github-pat'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'slack-token'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'aws-access-key'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, 'google-api-key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/g, 'jwt'],
  [/\b[Bb]earer\s+[A-Za-z0-9._-]{16,}\b/g, 'bearer'],
  [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    'private-key'
  ]
]

// KEY=VALUE / KEY: VALUE where the key name itself looks sensitive — keep the
// key (useful context), redact only the value.
const ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi

export function scrub(text: string, extraPatterns: string[] = []): string {
  if (!text) return text
  let out = text
  out = out.replace(ASSIGNMENT, (_m, key: string, sep: string) => `${key}${sep}«redacted:secret»`)
  for (const [re, label] of PATTERNS) out = out.replace(re, `«redacted:${label}»`)
  for (const pat of extraPatterns) {
    try {
      out = out.replace(new RegExp(pat, 'g'), '«redacted:custom»')
    } catch {
      /* ignore a malformed user-supplied pattern */
    }
  }
  return out
}
