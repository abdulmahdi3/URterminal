import { create } from 'zustand'
import { parseStream } from '@shared/streamJson'

/** One item in a stream pane's transcript: a user prompt or a Claude turn. */
export type StreamEntry =
  | { kind: 'prompt'; text: string }
  | { kind: 'turn'; raw: string }

interface PaneStream {
  entries: StreamEntry[]
  /** a `claude -p` turn is currently in flight */
  running: boolean
  /** pty id of the in-flight turn (for Stop) */
  ptyId?: string
  /** Claude session id captured from the last finished turn, for `--resume` */
  sessionId?: string
}

interface StreamsState {
  byPane: Record<string, PaneStream>
  /** Start a new turn: record the prompt + an empty turn buffer, mark running. */
  beginTurn: (paneId: string, ptyId: string, prompt: string) => void
  /** Append raw pty output to the current (last) turn — no-op if not running. */
  appendData: (paneId: string, data: string) => void
  /** Finish the current turn (on pty exit): capture the session id, clear running. */
  endTurn: (paneId: string) => void
  /** Clear a pane's transcript (and continuity), e.g. "New conversation". */
  clear: (paneId: string) => void
  /** Drop a pane's state entirely (on close). */
  remove: (paneId: string) => void
}

const empty = (): PaneStream => ({ entries: [], running: false })

export const useStreams = create<StreamsState>((set) => ({
  byPane: {},

  beginTurn: (paneId, ptyId, prompt) =>
    set((s) => {
      const cur = s.byPane[paneId] ?? empty()
      return {
        byPane: {
          ...s.byPane,
          [paneId]: {
            ...cur,
            entries: [...cur.entries, { kind: 'prompt', text: prompt }, { kind: 'turn', raw: '' }],
            running: true,
            ptyId
          }
        }
      }
    }),

  appendData: (paneId, data) =>
    set((s) => {
      const cur = s.byPane[paneId]
      if (!cur || !cur.running) return s // not a stream turn we started
      const entries = cur.entries.slice()
      // append to the last turn entry
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]
        if (e.kind === 'turn') {
          entries[i] = { kind: 'turn', raw: e.raw + data }
          break
        }
      }
      return { byPane: { ...s.byPane, [paneId]: { ...cur, entries } } }
    }),

  endTurn: (paneId) =>
    set((s) => {
      const cur = s.byPane[paneId]
      if (!cur) return s
      // Capture the session id from the just-finished turn so the next prompt resumes it.
      let sessionId = cur.sessionId
      for (let i = cur.entries.length - 1; i >= 0; i--) {
        const e = cur.entries[i]
        if (e.kind === 'turn') {
          const sid = parseStream(e.raw).sessionId
          if (sid) sessionId = sid
          break
        }
      }
      return { byPane: { ...s.byPane, [paneId]: { ...cur, running: false, ptyId: undefined, sessionId } } }
    }),

  clear: (paneId) =>
    set((s) => ({ byPane: { ...s.byPane, [paneId]: empty() } })),

  remove: (paneId) =>
    set((s) => {
      const next = { ...s.byPane }
      delete next[paneId]
      return { byPane: next }
    })
}))
