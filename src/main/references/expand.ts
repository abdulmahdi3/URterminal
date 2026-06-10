import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { isAbsolute, join } from 'path'

/**
 * Expand a context reference into text to drop into a prompt (Hermes-style):
 *   @diff            git diff (unstaged)
 *   @staged          git diff --staged
 *   @git:3           last 3 commits with patches
 *   @file:path       a file (or @file:path:10-40 for a line range)
 *   @url:https://…   a web page, fetched + stripped to text
 * Bounded in size; secret-ish files are refused.
 */

export interface ExpandResult {
  ok: boolean
  content?: string
  error?: string
}

const MAX_BYTES = 48_000
const SECRET = /(^|[\\/])(\.env|\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.azure|id_rsa|id_ed25519|\.pem|\.npmrc|credentials)([\\/]|$|\.)/i

function cap(s: string, label: string): string {
  return s.length > MAX_BYTES ? s.slice(0, MAX_BYTES) + `\n…[${label} truncated]` : s
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, '--no-optional-locks', ...args],
      { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
}

async function expandFile(spec: string, cwd: string): Promise<ExpandResult> {
  // path or path:start-end  (quoted paths allowed)
  let path = spec
  let range: [number, number] | null = null
  const m = spec.match(/^(.*?):(\d+)(?:-(\d+))?$/)
  if (m && !/^[a-zA-Z]:[\\/]/.test(spec)) {
    // avoid treating a Windows drive letter (C:\) as a range
    path = m[1]
    range = [Number(m[2]), Number(m[3] ?? m[2])]
  }
  path = path.replace(/^["']|["']$/g, '')
  if (SECRET.test(path)) return { ok: false, error: 'That file looks sensitive — refused.' }
  const abs = isAbsolute(path) ? path : join(cwd, path)
  let text: string
  try {
    text = await readFile(abs, 'utf8')
  } catch {
    return { ok: false, error: `Can't read ${path}` }
  }
  if (range) {
    const lines = text.split('\n').slice(Math.max(0, range[0] - 1), range[1])
    text = lines.join('\n')
  }
  return { ok: true, content: `\`\`\`\n// ${path}\n${cap(text, 'file')}\n\`\`\`` }
}

async function expandUrl(url: string): Promise<ExpandResult> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'URL must start with http(s)://' }
  let html: string
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return { ok: false, error: `Fetch failed: HTTP ${r.status}` }
    html = await r.text()
  } catch (e) {
    return { ok: false, error: `Fetch failed: ${(e as Error).message}` }
  }
  // Crude HTML → text: drop script/style, strip tags, collapse whitespace.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
  return { ok: true, content: `Content of ${url}:\n\n${cap(text, 'page')}` }
}

export async function expandReference(ref: string, cwd: string): Promise<ExpandResult> {
  const r = ref.trim().replace(/^@/, '')
  const needCwd = (): boolean => !!cwd && isAbsolute(cwd)

  if (r === 'diff' || r === 'staged') {
    if (!needCwd()) return { ok: false, error: 'This pane has no folder.' }
    try {
      const out = await runGit(cwd, ['diff', ...(r === 'staged' ? ['--staged'] : [])])
      return out.trim()
        ? { ok: true, content: `\`\`\`diff\n${cap(out, 'diff')}\n\`\`\`` }
        : { ok: false, error: `No ${r === 'staged' ? 'staged ' : ''}changes.` }
    } catch (e) {
      return { ok: false, error: `git diff failed: ${(e as Error).message.slice(0, 120)}` }
    }
  }

  const git = r.match(/^git:(\d+)$/)
  if (git) {
    if (!needCwd()) return { ok: false, error: 'This pane has no folder.' }
    try {
      const out = await runGit(cwd, ['log', `-${git[1]}`, '-p', '--no-color'])
      return { ok: true, content: `\`\`\`\n${cap(out, 'git log')}\n\`\`\`` }
    } catch (e) {
      return { ok: false, error: `git log failed: ${(e as Error).message.slice(0, 120)}` }
    }
  }

  if (r.startsWith('file:')) return expandFile(r.slice(5), cwd)
  if (r.startsWith('url:')) return expandUrl(r.slice(4))

  return { ok: false, error: 'Use @diff, @staged, @git:N, @file:path[:a-b], or @url:https://…' }
}
