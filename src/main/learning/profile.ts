import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { learningRoot } from './store'

/**
 * Global, user-authored context docs injected into EVERY agent (Hermes-style):
 *   - USER.md  — durable facts about the user (stack, style, constraints).
 *   - SOUL.md  — persona / how the agent should behave.
 * Stored at the learning root (not project-scoped), capped so injection stays
 * small. Edited from Settings → Learning; injected ahead of learned memories.
 */
export type ProfileDoc = 'user' | 'persona'

const FILES: Record<ProfileDoc, string> = { user: 'USER.md', persona: 'SOUL.md' }
const CAP = 2600 // chars — keeps the injected context lean

function docPath(doc: ProfileDoc): string {
  return join(learningRoot(), FILES[doc])
}

export function readProfileDoc(doc: ProfileDoc): string {
  try {
    return readFileSync(docPath(doc), 'utf8')
  } catch {
    return ''
  }
}

export function writeProfileDoc(doc: ProfileDoc, text: string): void {
  const trimmed = (text ?? '').slice(0, CAP)
  try {
    const root = learningRoot()
    if (!existsSync(root)) mkdirSync(root, { recursive: true })
    const p = docPath(doc)
    const tmp = `${p}.tmp-${process.pid}`
    writeFileSync(tmp, trimmed, 'utf8')
    renameSync(tmp, p)
  } catch {
    /* best-effort persist */
  }
}
