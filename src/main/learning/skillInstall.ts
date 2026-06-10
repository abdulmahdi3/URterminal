import { writeSkill } from './brain'
import { setSkillFlags } from './skillState'
import type { SkillEntry } from './markdown'

/**
 * Install a community skill from a URL into the global brain (agentskills.io /
 * GitHub follow the open SKILL.md standard: YAML frontmatter + markdown body).
 * We fetch the file, lift its name + description, and write it as a global skill
 * — pinned so it isn't auto-tidied. GitHub blob URLs are auto-rewritten to raw.
 */

function toRaw(url: string): string {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url
}

function parseFrontmatter(text: string): { name?: string; description?: string; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { body: text }
  const fm = m[1]
  const get = (k: string): string | undefined =>
    fm.match(new RegExp(`^${k}:[ \\t]*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
  return { name: get('name'), description: get('description'), body: m[2] }
}

const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'skill'
const today = (): string => new Date().toISOString().slice(0, 10)

export async function installSkillFromUrl(
  url: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const raw = toRaw(url.trim())
  if (!/^https?:\/\//i.test(raw)) {
    return { ok: false, error: 'Enter a URL to a SKILL.md (raw or a GitHub blob link).' }
  }
  let text: string
  try {
    const r = await fetch(raw, { signal: AbortSignal.timeout(12000) })
    if (!r.ok) return { ok: false, error: `Fetch failed: HTTP ${r.status}` }
    text = await r.text()
  } catch (e) {
    return { ok: false, error: `Fetch failed: ${(e as Error).message}` }
  }
  if (text.length > 200_000) return { ok: false, error: 'That file is too large to be a skill.' }

  const { name, description, body } = parseFrontmatter(text)
  const finalName = (name || 'Imported skill').slice(0, 64)
  const slug = slugify(name || finalName)
  const desc = (description || body.split('\n').find((l) => l.trim())?.slice(0, 120) || '').trim()
  const entry: SkillEntry = {
    name: finalName,
    slug,
    kind: 'skill',
    scope: 'global',
    description: desc,
    agents: [],
    trigger: '',
    project: '',
    confidence: 1,
    hits: 1,
    created: today(),
    updated: today(),
    evidence: [],
    body: body.trim()
  }
  writeSkill(null, entry)
  setSkillFlags('global', slug, { pinned: true }) // user-installed → protect from tidy
  return { ok: true, name: finalName }
}
