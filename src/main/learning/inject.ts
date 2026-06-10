import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join, dirname, isAbsolute } from 'path'
import { execFileSync } from 'child_process'
import { readMemories, readSkills } from './brain'
import { readProfileDoc } from './profile'
import { getSkillFlags } from './skillState'
import type { MemoryEntry, SkillEntry } from './markdown'

/** Global user profile (USER.md) + persona (SOUL.md) injected ahead of memories. */
export interface ProfileDocs {
  user: string
  persona: string
}

/**
 * Passive injection — the payoff that makes EVERY hosted agent smarter with zero
 * per-agent integration. After a learning is approved, and just-in-time when a
 * pane spawns, we render the project's top memories + a skills index into the
 * context file each CLI already reads at startup.
 *
 * Per the user's chosen policy this is UNTRACKED-ONLY: we write only to files
 * that are NOT tracked by git (creating them if absent), wrap our content in an
 * idempotent managed block so user-authored text is never disturbed, and ensure
 * a .gitignore entry so the file never produces a surprise commit diff. A file
 * that is already git-tracked is left completely untouched.
 *
 * The pure pieces (target mapping, block render, block upsert, gitignore ensure)
 * are exported and unit-tested; the fs + git access is behind an injectable IO
 * so the orchestrator is testable too.
 */

export const MANAGED_START = '<!-- URTERMINAL:LEARNED START -->'
export const MANAGED_END = '<!-- URTERMINAL:LEARNED END -->'

/** Native context file each agent reads, preferring an untracked location. */
export const AGENT_TARGETS: Record<string, string> = {
  claude: '.claude/CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: '.gemini/GEMINI.md',
  aider: 'AGENTS.md',
  opencode: 'AGENTS.md',
  copilot: '.github/copilot-instructions.md',
  'gh-copilot': '.github/copilot-instructions.md'
}
const DEFAULT_TARGET = 'AGENTS.md'

/** Relative context-file path for an agent id (path/ext stripped). */
export function targetFor(agentId: string): string {
  const base = agentId.trim().split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat)$/i, '') ?? agentId
  return AGENT_TARGETS[base] ?? DEFAULT_TARGET
}

/** Render the learned-knowledge block from memories + skills, byte-bounded.
 *  The user's persona (SOUL.md) + profile (USER.md) lead — they're highest value
 *  and always apply — followed by learned memories and the skills index. */
export function renderLearnedBlock(
  memories: MemoryEntry[],
  skills: SkillEntry[],
  maxBytes = 8192,
  profile?: ProfileDocs
): string {
  const ranked = memories.slice().sort((a, b) => b.confidence - a.confidence || b.hits - a.hits)
  const lines: string[] = [
    MANAGED_START,
    '<!-- Auto-maintained by URterminal from your sessions. Edits here are overwritten. -->'
  ]
  const persona = profile?.persona.trim()
  const user = profile?.user.trim()
  if (persona) lines.push('## How to work with me', persona, '')
  if (user) lines.push('## About the user', user, '')
  lines.push('## Learned project knowledge', '')
  let bytes = lines.join('\n').length
  for (const m of ranked) {
    const entry = `- ${m.body.split('\n')[0].trim()}`
    if (bytes + entry.length + 1 > maxBytes) break
    lines.push(entry)
    bytes += entry.length + 1
  }
  if (skills.length) {
    lines.push('', '### Skills available')
    for (const s of skills) {
      const entry = `- **${s.name}** — ${s.description}`
      if (bytes + entry.length + 1 > maxBytes) break
      lines.push(entry)
      bytes += entry.length + 1
    }
  }
  lines.push(MANAGED_END)
  return lines.join('\n')
}

/**
 * Render a compact one-shot context note for ACTIVE injection — text typed into
 * a live agent session (default OFF). Plain prose (no managed-block markers), so
 * it reads naturally as a message to the agent, and tightly byte-bounded.
 * Returns '' when there is nothing worth injecting.
 */
export function buildActivePreamble(
  memories: MemoryEntry[],
  skills: SkillEntry[],
  maxChars = 1500,
  profile?: ProfileDocs
): string {
  const ranked = memories.slice().sort((a, b) => b.confidence - a.confidence || b.hits - a.hits)
  const facts: string[] = []
  let used = 60 // budget for the framing sentence
  const persona = profile?.persona.trim()
  const user = profile?.user.trim()
  if (persona) {
    facts.push(`How to work with me: ${persona.replace(/\s+/g, ' ')}`)
    used += facts[facts.length - 1].length + 1
  }
  if (user && used < maxChars) {
    facts.push(`About me: ${user.replace(/\s+/g, ' ')}`)
    used += facts[facts.length - 1].length + 1
  }
  for (const m of ranked) {
    const line = `- ${m.body.split('\n')[0].trim()}`
    if (used + line.length + 1 > maxChars) break
    facts.push(line)
    used += line.length + 1
  }
  for (const s of skills) {
    const line = `- skill: ${s.name} — ${s.description}`
    if (used + line.length + 1 > maxChars) break
    facts.push(line)
    used += line.length + 1
  }
  if (!facts.length) return ''
  return `Relevant learned context for this project:\n${facts.join('\n')}`
}

/** Insert/replace the managed block in existing file content (idempotent). */
export function upsertManagedBlock(existing: string, block: string): string {
  const startIdx = existing.indexOf(MANAGED_START)
  const endIdx = existing.indexOf(MANAGED_END)
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx)
    const after = existing.slice(endIdx + MANAGED_END.length)
    return (before + block + after).replace(/\n{3,}/g, '\n\n')
  }
  if (!existing.trim()) return block + '\n'
  return existing.replace(/\s*$/, '') + '\n\n' + block + '\n'
}

/** Ensure `entry` is present in .gitignore content; returns updated content. */
export function ensureGitignoreEntry(existing: string, entry: string): string {
  const lines = existing.split('\n').map((l) => l.trim())
  if (lines.includes(entry)) return existing
  const base = existing.replace(/\s*$/, '')
  const header = base.includes('# URterminal learning') ? '' : '\n# URterminal learning (auto-injected agent context)\n'
  return `${base}${base ? '\n' : ''}${header}${entry}\n`
}

// ---- integration: fs + git, behind an injectable IO for testability ----

export interface InjectIO {
  read(path: string): string | null
  write(path: string, content: string): void
  ensureDir(path: string): void
  /** Whether `relPath` is tracked by git within `cwd` (false if not a repo). */
  isTracked(cwd: string, relPath: string): boolean
}

const realIO: InjectIO = {
  read(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
  write(path, content) {
    const tmp = `${path}.tmp-${process.pid}`
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, path)
  },
  ensureDir(path) {
    if (!existsSync(path)) mkdirSync(path, { recursive: true })
  },
  isTracked(cwd, relPath) {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', relPath], {
        cwd,
        stdio: 'ignore',
        windowsHide: true
      })
      return true
    } catch {
      return false
    }
  }
}

export interface InjectResult {
  status: 'written' | 'skipped-tracked' | 'skipped-empty' | 'no-cwd'
  file?: string
}

/**
 * Inject the current brain for `projectHash` into `agentId`'s context file under
 * `cwd`. Untracked-only: a git-tracked target is left untouched.
 */
export function injectForPane(
  opts: { cwd: string; agentId: string; projectHash: string; maxBytes?: number },
  io: InjectIO = realIO
): InjectResult {
  const { cwd, agentId, projectHash } = opts
  if (!cwd || !isAbsolute(cwd)) return { status: 'no-cwd' }

  const rel = targetFor(agentId)
  if (io.isTracked(cwd, rel)) return { status: 'skipped-tracked', file: rel }

  const memories = readMemories(projectHash)
  // Archived skills stay on disk but are excluded from what agents see.
  const skills = readSkills(projectHash).filter((s) => {
    const sk = s.scope === 'global' ? 'global' : s.project
    return !getSkillFlags(sk, s.slug).archived
  })
  const profile: ProfileDocs = { user: readProfileDoc('user'), persona: readProfileDoc('persona') }
  if (!memories.length && !skills.length && !profile.user.trim() && !profile.persona.trim()) {
    return { status: 'skipped-empty' }
  }

  const abs = join(cwd, rel)
  const block = renderLearnedBlock(memories, skills, opts.maxBytes, profile)
  const updated = upsertManagedBlock(io.read(abs) ?? '', block)
  io.ensureDir(dirname(abs))
  io.write(abs, updated)

  // Ensure the (untracked) target is gitignored so it never shows as a diff.
  const giPath = join(cwd, '.gitignore')
  const gi = io.read(giPath)
  if (gi === null || !io.isTracked(cwd, rel)) {
    io.write(giPath, ensureGitignoreEntry(gi ?? '', rel))
  }

  return { status: 'written', file: rel }
}
