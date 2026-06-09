import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

/**
 * Durable per-chat prompt history, keyed by the agent's pinned session id, so the
 * prompt minimap can be rebuilt when a chat is restored on launch or reopened
 * from the Chats browser. Tiny JSON file in userData; cached in memory.
 */
const dir = join(app.getPath('userData'), 'prompts')
const file = join(dir, 'prompts.json')
const MAX_PER_CHAT = 500

let cache: Record<string, string[]> | null = null

function load(): Record<string, string[]> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string[]>
  } catch {
    cache = {}
  }
  return cache
}

function persist(): void {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(load()))
  } catch {
    /* non-fatal — prompts persistence is best-effort */
  }
}

export function getPrompts(sessionId: string): string[] {
  if (!sessionId) return []
  return load()[sessionId] ?? []
}

export function appendPrompt(sessionId: string, text: string): void {
  if (!sessionId || !text) return
  const c = load()
  const arr = c[sessionId] ?? (c[sessionId] = [])
  arr.push(text)
  if (arr.length > MAX_PER_CHAT) c[sessionId] = arr.slice(-MAX_PER_CHAT)
  persist()
}
