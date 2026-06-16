import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshKeyInfo, SshConfigHost } from '@shared/types'

/** The user's ~/.ssh directory. */
function sshDir(): string {
  return join(homedir(), '.ssh')
}

/** Files that live in ~/.ssh but are never private keys. */
const NON_KEY = new Set(['config', 'known_hosts', 'known_hosts.old', 'authorized_keys', 'environment'])

/**
 * Detect a private key's type + bit strength from its first line / PEM header.
 * Best-effort: returns {} when the format isn't recognized (e.g. encrypted PEM).
 */
function describeKey(text: string): { type?: string; bits?: number } {
  const head = text.slice(0, 400)
  if (head.includes('OPENSSH PRIVATE KEY')) {
    // New-format keys don't expose bits in the header; infer type from the body.
    if (/ed25519/i.test(text)) return { type: 'ED25519', bits: 256 }
    if (/ecdsa/i.test(text)) return { type: 'ECDSA' }
    if (/rsa/i.test(text)) return { type: 'RSA' }
    return { type: 'OpenSSH' }
  }
  if (head.includes('RSA PRIVATE KEY')) return { type: 'RSA' }
  if (head.includes('EC PRIVATE KEY')) return { type: 'ECDSA' }
  if (head.includes('DSA PRIVATE KEY')) return { type: 'DSA' }
  return {}
}

/**
 * Compute the OpenSSH SHA256 fingerprint ("SHA256:<base64>") from a public-key
 * file's contents (the middle base64 blob). Returns undefined when unreadable.
 */
function fingerprintFromPub(dir: string, name: string): string | undefined {
  try {
    const pub = readFileSync(join(dir, `${name}.pub`), 'utf8').trim()
    const blob = pub.split(/\s+/)[1]
    if (!blob) return undefined
    const hash = createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64')
    return `SHA256:${hash.replace(/=+$/, '')}`
  } catch {
    return undefined
  }
}

/**
 * Enumerate the private keys in ~/.ssh for the identity-file picker. A file
 * counts as a key when it has no `.pub` extension, isn't a known non-key file,
 * and either looks like a PEM/OpenSSH key or has a matching `<name>.pub`.
 */
export function listIdentityKeys(): SshKeyInfo[] {
  const dir = sshDir()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const pubs = new Set(entries.filter((f) => f.endsWith('.pub')).map((f) => f.slice(0, -4)))
  const keys: SshKeyInfo[] = []
  for (const name of entries) {
    if (name.endsWith('.pub') || NON_KEY.has(name)) continue
    const path = join(dir, name)
    try {
      if (!statSync(path).isFile()) continue
    } catch {
      continue
    }
    let info: { type?: string; bits?: number } = {}
    let looksLikeKey = pubs.has(name)
    try {
      const text = readFileSync(path, 'utf8')
      if (text.includes('PRIVATE KEY')) {
        looksLikeKey = true
        info = describeKey(text)
      }
    } catch {
      /* unreadable (perms) — keep it if a .pub vouches for it */
    }
    if (looksLikeKey) keys.push({ path, name, ...info, fingerprint: fingerprintFromPub(dir, name) })
  }
  return keys.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Parse ~/.ssh/config into importable hosts. Wildcard patterns (Host *) and
 * entries without a resolvable HostName are skipped. Per-host HostName, User,
 * Port and IdentityFile are read; ~ in IdentityFile is expanded.
 */
export function parseSshConfig(): SshConfigHost[] {
  let text: string
  try {
    text = readFileSync(join(sshDir(), 'config'), 'utf8')
  } catch {
    return []
  }
  const out: SshConfigHost[] = []
  let cur: (SshConfigHost & { _alias: string }) | null = null
  const flush = (): void => {
    if (cur && cur.host && !cur.name.includes('*') && !cur.name.includes('?')) {
      out.push({ name: cur.name, host: cur.host, user: cur.user, port: cur.port, identityFile: cur.identityFile })
    }
    cur = null
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sp = line.search(/\s|=/)
    if (sp < 0) continue
    const key = line.slice(0, sp).toLowerCase()
    const value = line.slice(sp + 1).replace(/^[=\s]+/, '').trim()
    if (key === 'host') {
      flush()
      const alias = value.split(/\s+/)[0]
      cur = { _alias: alias, name: alias, host: '', user: '', port: 22 }
    } else if (cur) {
      if (key === 'hostname') cur.host = value
      else if (key === 'user') cur.user = value
      else if (key === 'port') cur.port = parseInt(value, 10) || 22
      else if (key === 'identityfile') {
        cur.identityFile = value.replace(/^~(?=$|[/\\])/, homedir()).replace(/^["']|["']$/g, '')
      }
    }
  }
  flush()
  // Fall back to the alias as the hostname when no explicit HostName was given.
  return out.map((h) => ({ ...h, host: h.host || h.name }))
}
