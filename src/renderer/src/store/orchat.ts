import { create } from 'zustand'
import type { OrMessage, OrUsage } from '@shared/types'

/**
 * Per-pane OpenRouter chat transcript (the live, fast-updating store). Mirrors
 * `store/streams.ts` but holds structured messages instead of NDJSON. The pane
 * component persists finalized messages into `Pane.openrouter.messages` at turn
 * boundaries so the conversation survives a restart.
 */

interface PaneChat {
  messages: OrMessage[]
  streaming: boolean
}

interface OrChatState {
  byPane: Record<string, PaneChat>
  /** seed a pane's transcript from persisted state — only if not already present */
  seed: (paneId: string, messages: OrMessage[]) => void
  /** start a turn: push the user msg + an empty assistant msg, mark streaming */
  beginTurn: (paneId: string, prompt: string) => void
  /** append a streamed delta to the last assistant message */
  appendDelta: (paneId: string, delta: string) => void
  /** finish the turn: attach usage to the last assistant message, clear streaming */
  endTurn: (paneId: string, usage?: OrUsage) => void
  /** fail the turn: set .error on the last assistant message (partial text kept) */
  failTurn: (paneId: string, message: string) => void
  /** drop the trailing assistant+user pair, return the user content (Regenerate) */
  popLastTurn: (paneId: string) => string | null
  /** clear a pane's conversation */
  clear: (paneId: string) => void
  /** drop a pane's state entirely (on close) */
  remove: (paneId: string) => void
}

const empty = (): PaneChat => ({ messages: [], streaming: false })

/** Return a copy with the last assistant message replaced by `patch(it)`. */
function patchLastAssistant(messages: OrMessage[], patch: (m: OrMessage) => OrMessage): OrMessage[] {
  const out = messages.slice()
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'assistant') {
      out[i] = patch(out[i])
      break
    }
  }
  return out
}

export const useOrChat = create<OrChatState>((set, get) => ({
  byPane: {},

  seed: (paneId, messages) =>
    set((s) =>
      s.byPane[paneId] ? s : { byPane: { ...s.byPane, [paneId]: { messages, streaming: false } } }
    ),

  beginTurn: (paneId, prompt) =>
    set((s) => {
      const cur = s.byPane[paneId] ?? empty()
      return {
        byPane: {
          ...s.byPane,
          [paneId]: {
            messages: [
              ...cur.messages,
              { role: 'user', content: prompt },
              { role: 'assistant', content: '' }
            ],
            streaming: true
          }
        }
      }
    }),

  appendDelta: (paneId, delta) =>
    set((s) => {
      const cur = s.byPane[paneId]
      if (!cur || !cur.streaming) return s
      return {
        byPane: {
          ...s.byPane,
          [paneId]: {
            ...cur,
            messages: patchLastAssistant(cur.messages, (m) => ({ ...m, content: m.content + delta }))
          }
        }
      }
    }),

  endTurn: (paneId, usage) =>
    set((s) => {
      const cur = s.byPane[paneId]
      if (!cur) return s
      const messages = usage
        ? patchLastAssistant(cur.messages, (m) => ({ ...m, usage }))
        : cur.messages
      return { byPane: { ...s.byPane, [paneId]: { ...cur, messages, streaming: false } } }
    }),

  failTurn: (paneId, message) =>
    set((s) => {
      const cur = s.byPane[paneId]
      if (!cur) return s
      return {
        byPane: {
          ...s.byPane,
          [paneId]: {
            ...cur,
            streaming: false,
            messages: patchLastAssistant(cur.messages, (m) => ({ ...m, error: message }))
          }
        }
      }
    }),

  popLastTurn: (paneId) => {
    const cur = get().byPane[paneId]
    if (!cur || cur.streaming) return null
    const msgs = cur.messages.slice()
    if (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop()
    let prompt: string | null = null
    if (msgs.length && msgs[msgs.length - 1].role === 'user') prompt = msgs.pop()?.content ?? null
    set((s) => ({ byPane: { ...s.byPane, [paneId]: { ...cur, messages: msgs } } }))
    return prompt
  },

  clear: (paneId) => set((s) => ({ byPane: { ...s.byPane, [paneId]: empty() } })),

  remove: (paneId) =>
    set((s) => {
      const next = { ...s.byPane }
      delete next[paneId]
      return { byPane: next }
    })
}))
