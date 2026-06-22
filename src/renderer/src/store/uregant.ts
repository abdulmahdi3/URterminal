/**
 * Uregant renderer store (Slice 4) — a THIN MIRROR of the main-process loop.
 *
 * The controller now lives in main (src/main/uregant/controller.ts). This store
 * holds the latest state snapshot per pane (pushed via uregant:state), appends
 * live delta text (uregant:delta), and exposes commands that just message main
 * (start/approve/deny/stop/resync). Tool execution is handled by useUregantStream
 * responding to uregant:exec-tool. No loop logic lives here anymore.
 */
import { create } from 'zustand'
import type { UrChatMessage, UrToolCall, UrStateEvent, UrAutonomy } from '@shared/uregant'

export const UREGANT_DEFAULT_MODEL = 'qwen3.5:latest'

export interface UrPaneView {
  messages: UrChatMessage[]
  /** live partial assistant text for the in-progress turn */
  streamingText: string
  streaming: boolean
  pending: UrToolCall[] | null
  error: string | null
  model: string
  autonomy: UrAutonomy
}

interface UrState {
  byPane: Record<string, UrPaneView>
  setModel: (paneId: string, model: string) => void
  setAutonomy: (paneId: string, autonomy: UrAutonomy) => void
  send: (paneId: string, text: string) => void
  approve: (paneId: string) => void
  deny: (paneId: string) => void
  stop: (paneId: string) => void
  resync: (paneId: string) => void
  remove: (paneId: string) => void
  // main -> store event sinks
  _delta: (paneId: string, delta: string) => void
  _state: (e: UrStateEvent) => void
}

function blank(): UrPaneView {
  return { messages: [], streamingText: '', streaming: false, pending: null, error: null, model: UREGANT_DEFAULT_MODEL, autonomy: 'manual' }
}

export const useUregant = create<UrState>((set, get) => {
  const patch = (paneId: string, fn: (c: UrPaneView) => UrPaneView): void =>
    set((s) => ({ byPane: { ...s.byPane, [paneId]: fn(s.byPane[paneId] ?? blank()) } }))

  return {
    byPane: {},

    setModel: (paneId, model) => patch(paneId, (p) => ({ ...p, model })),

    setAutonomy: (paneId, autonomy) => patch(paneId, (p) => ({ ...p, autonomy })),

    send: (paneId, text) => {
      const t = text.trim()
      if (!t) return
      const view = get().byPane[paneId]
      const model = view?.model ?? UREGANT_DEFAULT_MODEL
      const autonomy = view?.autonomy ?? 'manual'
      // optimistic: show the user message + busy state until main's snapshot lands
      patch(paneId, (p) => ({
        ...p,
        messages: [...p.messages, { role: 'user', content: t }],
        streaming: true,
        error: null
      }))
      window.api.uregant.start({ paneId, model, text: t, autonomy })
    },

    approve: (paneId) => {
      window.api.uregant.approve(paneId)
      patch(paneId, (p) => ({ ...p, pending: null, streaming: true }))
    },

    deny: (paneId) => {
      window.api.uregant.deny(paneId)
      patch(paneId, (p) => ({ ...p, pending: null, streaming: true }))
    },

    stop: (paneId) => {
      window.api.uregant.stop(paneId)
      patch(paneId, (p) => ({ ...p, streaming: false, pending: null }))
    },

    resync: (paneId) => window.api.uregant.resync(paneId),

    remove: (paneId) =>
      set((s) => {
        const b = { ...s.byPane }
        delete b[paneId]
        return { byPane: b }
      }),

    _delta: (paneId, delta) => patch(paneId, (p) => ({ ...p, streamingText: p.streamingText + delta })),

    _state: (e) =>
      patch(e.paneId, (p) => ({
        ...p,
        messages: e.messages,
        streaming: e.streaming,
        pending: e.pending,
        error: e.error,
        model: e.model || p.model,
        autonomy: e.autonomy || p.autonomy,
        // a fresh snapshot is authoritative — the in-progress delta is now either
        // committed into messages or superseded
        streamingText: ''
      }))
  }
})
