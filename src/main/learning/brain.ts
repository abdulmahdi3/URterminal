import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  renameSync
} from 'fs'
import { join } from 'path'
import { learningRoot } from './store'
import {
  serializeMemory,
  parseMemory,
  serializeSkill,
  parseSkill,
  type MemoryEntry,
  type SkillEntry
} from './markdown'

/**
 * The distilled "brain" on disk: markdown + frontmatter memory and skill files,
 * laid out to mirror the user's ~/.claude convention so any hosted agent can
 * read them, plus a regenerated MEMORY.md index.
 *
 *   {learningRoot}/global/memory/<slug>.md           (+ MEMORY.md)
 *   {learningRoot}/global/skills/<slug>/SKILL.md
 *   {learningRoot}/projects/<hash>/memory/<slug>.md   (+ MEMORY.md)
 *   {learningRoot}/projects/<hash>/skills/<slug>/SKILL.md
 *
 * Writes are atomic (tmp + rename). All IO is guarded — a learning write must
 * never crash the app.
 */

function scopeDir(projectHash: string | null): string {
  return projectHash ? join(learningRoot(), 'projects', projectHash) : join(learningRoot(), 'global')
}
function memoryDir(projectHash: string | null): string {
  return join(scopeDir(projectHash), 'memory')
}
function skillsDir(projectHash: string | null): string {
  return join(scopeDir(projectHash), 'skills')
}

function ensure(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}

const safeSlug = (s: string): string => s.replace(/[^a-z0-9_-]/gi, '').slice(0, 80) || 'entry'

/** Read all memory entries for a scope (null = global). */
export function readMemories(projectHash: string | null): MemoryEntry[] {
  const dir = memoryDir(projectHash)
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
  } catch {
    return []
  }
  const out: MemoryEntry[] = []
  for (const f of files) {
    try {
      out.push(parseMemory(readFileSync(join(dir, f), 'utf8')))
    } catch {
      /* skip a corrupt file */
    }
  }
  return out
}

/** Read all skill entries for a scope (null = global). */
export function readSkills(projectHash: string | null): SkillEntry[] {
  const dir = skillsDir(projectHash)
  let dirs: string[]
  try {
    dirs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const out: SkillEntry[] = []
  for (const d of dirs) {
    try {
      out.push(parseSkill(readFileSync(join(dir, d, 'SKILL.md'), 'utf8')))
    } catch {
      /* skip */
    }
  }
  return out
}

/** Write one memory entry (atomic). */
export function writeMemory(projectHash: string | null, e: MemoryEntry): void {
  try {
    const dir = memoryDir(projectHash)
    ensure(dir)
    atomicWrite(join(dir, `${safeSlug(e.slug)}.md`), serializeMemory(e))
    regenerateIndex(projectHash)
  } catch {
    /* non-fatal */
  }
}

/** Write one skill entry as skills/<slug>/SKILL.md (atomic). */
export function writeSkill(projectHash: string | null, e: SkillEntry): void {
  try {
    const dir = join(skillsDir(projectHash), safeSlug(e.slug))
    ensure(dir)
    atomicWrite(join(dir, 'SKILL.md'), serializeSkill(e))
  } catch {
    /* non-fatal */
  }
}

/** Persist a whole memory list for a scope (used after a merge). */
export function writeMemories(projectHash: string | null, entries: MemoryEntry[]): void {
  for (const e of entries) writeMemory(projectHash, e)
}

/** Rebuild MEMORY.md from the memory files in a scope — the agent-facing index. */
export function regenerateIndex(projectHash: string | null): void {
  try {
    const entries = readMemories(projectHash)
      .slice()
      .sort((a, b) => b.confidence - a.confidence || b.hits - a.hits)
    const label = projectHash ? `project ${projectHash}` : 'global'
    const lines = [`# Memory Index (${label})`, '']
    for (const e of entries) {
      const summary = e.body.split('\n')[0].slice(0, 100)
      lines.push(`- [${e.title}](${safeSlug(e.slug)}.md) — ${summary}`)
    }
    const dir = memoryDir(projectHash)
    ensure(dir)
    atomicWrite(join(dir, 'MEMORY.md'), lines.join('\n') + '\n')
  } catch {
    /* non-fatal */
  }
}

/** Everything the distiller needs to know about the current brain for a scope. */
export interface BrainIndex {
  memories: { slug: string; title: string; confidence: number }[]
  skills: { slug: string; name: string }[]
}

export function brainIndex(projectHash: string | null): BrainIndex {
  return {
    memories: readMemories(projectHash).map((m) => ({
      slug: m.slug,
      title: m.title,
      confidence: m.confidence
    })),
    skills: readSkills(projectHash).map((s) => ({ slug: s.slug, name: s.name }))
  }
}

/** Delete an entire project's learning dir (transcripts + memory + skills). */
export function forgetProject(projectHash: string): void {
  try {
    rmSync(join(learningRoot(), 'projects', safeSlug(projectHash)), { recursive: true, force: true })
  } catch {
    /* already gone */
  }
}
