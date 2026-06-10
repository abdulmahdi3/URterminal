import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { learningRoot } from './store'

/**
 * Lifecycle flags for distilled skills, kept in a sidecar so we never touch the
 * SKILL.md format: a skill can be `pinned` (protected from auto-tidy) or
 * `archived` (kept on disk but excluded from injection + hidden by default).
 * Keyed by `${scope}:${slug}` where scope is 'global' or a projectHash.
 */
export interface SkillFlags {
  pinned?: boolean
  archived?: boolean
}

type State = Record<string, SkillFlags>

let cache: State | null = null

function statePath(): string {
  return join(learningRoot(), 'skills-state.json')
}

function load(): State {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(statePath(), 'utf8')) as State
  } catch {
    cache = {}
  }
  return cache
}

function persist(): void {
  try {
    const root = learningRoot()
    if (!existsSync(root)) mkdirSync(root, { recursive: true })
    writeFileSync(statePath(), JSON.stringify(load(), null, 2))
  } catch {
    /* best-effort */
  }
}

const key = (scope: string, slug: string): string => `${scope}:${slug}`

export function getSkillFlags(scope: string, slug: string): SkillFlags {
  return load()[key(scope, slug)] ?? {}
}

export function setSkillFlags(scope: string, slug: string, flags: SkillFlags): void {
  const s = load()
  const k = key(scope, slug)
  const next = { ...s[k], ...flags }
  if (!next.pinned && !next.archived) delete s[k]
  else s[k] = next
  persist()
}

/** Drop a skill's flags entirely (e.g. when it's deleted). */
export function clearSkillFlags(scope: string, slug: string): void {
  const s = load()
  delete s[key(scope, slug)]
  persist()
}
