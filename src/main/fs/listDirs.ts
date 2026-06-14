import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, dirname, basename } from 'path'

/**
 * Directory autocomplete for the agent launcher's folder field. Given a partial
 * path the user is typing, return up to `limit` child directories that match:
 * the input is split into a parent dir + a name prefix, the parent is listed, and
 * directories whose name starts with the prefix (case-insensitive) are kept.
 * Best-effort — returns [] on any error (bad path, permission, etc.).
 */
export async function listDirs(input: string, limit = 12): Promise<string[]> {
  try {
    const raw = (input || '').trim()
    let dir: string
    let prefix: string
    if (!raw) {
      dir = homedir()
      prefix = ''
    } else if (raw.endsWith('/') || raw.endsWith('\\')) {
      dir = raw
      prefix = ''
    } else {
      dir = dirname(raw)
      prefix = basename(raw).toLowerCase()
    }
    if (!isAbsolute(dir)) dir = join(homedir(), dir)

    const entries = await readdir(dir, { withFileTypes: true })
    const out: string[] = []
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      if (prefix && !e.name.toLowerCase().startsWith(prefix)) continue
      let isDir = e.isDirectory()
      if (!isDir && e.isSymbolicLink()) {
        try {
          isDir = (await stat(join(dir, e.name))).isDirectory()
        } catch {
          isDir = false
        }
      }
      if (isDir) out.push(join(dir, e.name))
      if (out.length >= limit) break
    }
    return out.sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}
