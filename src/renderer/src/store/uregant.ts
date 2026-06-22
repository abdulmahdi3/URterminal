/**
 * Uregant agent-loop store (Slice 2 — runs in the RENDERER).
 *
 * The LLM turn happens in main (window.api.uregant.chat -> Ollama); deltas/done
 * arrive as events (see useUregantStream). On `done` we commit the assistant turn
 * and, if it requested tools, either auto-run read-only tools or gate mutating
 * ones on Manual approval, then feed wrapped results back and loop until the model
 * calls `done` (or a step cap trips).
 *
 * FOLLOW-UP (UREGANT_PLAN.md §13): move this controller into main for
 * crash-resilient run persistence. Renderer-first here to ship a working slice.
 */
import { create } from 'zustand'
import type { UrChatMessage, UrToolCall, UrTurnResult } from '@shared/uregant'
import { UR_TOOLS, UR_READONLY_TOOLS, UR_DONE_TOOL, UR_SYSTEM } from '@shared/uregantTools'
import { executeTool, wrapUntrusted } from '../lib/uregantTools'

export const UREGANT_DEFAULT_MODEL = 'qwen3.5:latest'
const MAX_STEPS = 16
const NUM_CTX = 16384

export interface UrPaneChat {
  /** exact conversation sent to the model (user/assistant/tool) */
  convo: UrChatMessage[]
  /** in-progress assistant text for the current turn */
  streamingText: string
  streaming: boolean
  /** mutating tool calls awaiting Manual approval, or null */
  pending: UrToolCall[] | null
  model: string
  error: string | null
  steps: number
}

interface UrState {
  byPane: Record<string, UrPaneChat>
  setModel: (paneId: string, model: string) => void
  send: (paneId: string, text: string) => void
  approve: (paneId: string) => void
  deny: (paneId: string) => void
  stop: (paneId: string) => void
  clear: (paneId: string) => void
  remove: (paneId: string) => void
  // main -> store event sinks
  _delta: (paneId: string, delta: string) => void
  _done: (paneId: string, result: UrTurnResult) => void
  _error: (paneId: string, message: string) => void
}

function blank(): UrPaneChat {
  return {
    convo: [],
    streamingText: '',
    streaming: false,
    pending: null,
    model: UREGANT_DEFAULT_MODEL,
    error: null,
    steps: 0
  }
}

/** A mutating tool needs approval; read-only tools and `done` never do. */
function needsApproval(calls: UrToolCall[]): boolean {
  return calls.some(
    (c) => !UR_READONLY_TOOLS.has(c.function.name) && c.function.name !== UR_DONE_TOOL
  )
}

export const useUregant = create<UrState>((set, get) => {
  const patch = (paneId: string, fn: (c: UrPaneChat) => UrPaneChat): void =>
    set((s) => ({ byPane: { ...s.byPane, [paneId]: fn(s.byPane[paneId] ?? blank()) } }))

  const sendTurn = (paneId: string): void => {
    const c = get().byPane[paneId]
    if (!c) return
    patch(paneId, (p) => ({ ...p, streaming: true, streamingText: '', error: null }))
    void window.api.uregant.chat({
      paneId,
      model: c.model || UREGANT_DEFAULT_MODEL,
      messages: c.convo,
      tools: UR_TOOLS,
      system: UR_SYSTEM,
      numCtx: NUM_CTX
    })
  }

  const runTools = async (paneId: string, calls: UrToolCall[]): Promise<void> => {
    let finished = false
    for (const call of calls) {
      const res = await executeTool(call)
      const content = res.ok
        ? wrapUntrusted(call.function.name, res.value)
        : wrapUntrusted(call.function.name, { error: res.error })
      patch(paneId, (p) => ({
        ...p,
        convo: [...p.convo, { role: 'tool', name: call.function.name, content }]
      }))
      if (call.function.name === UR_DONE_TOOL) finished = true
    }
    if (finished) {
      patch(paneId, (p) => ({ ...p, streaming: false }))
      return
    }
    const c = get().byPane[paneId]
    if (c && c.steps >= MAX_STEPS) {
      patch(paneId, (p) => ({
        ...p,
        streaming: false,
        error: 'Step limit reached — stopped to avoid a runaway loop.'
      }))
      return
    }
    patch(paneId, (p) => ({ ...p, steps: p.steps + 1 }))
    sendTurn(paneId)
  }

  return {
    byPane: {},

    setModel: (paneId, model) => patch(paneId, (p) => ({ ...p, model })),

    send: (paneId, text) => {
      const t = text.trim()
      if (!t) return
      patch(paneId, (p) => ({
        ...p,
        convo: [...p.convo, { role: 'user', content: t }],
        steps: 0,
        error: null
      }))
      sendTurn(paneId)
    },

    approve: (paneId) => {
      const c = get().byPane[paneId]
      if (!c?.pending) return
      const calls = c.pending
      patch(paneId, (p) => ({ ...p, pending: null, streaming: true }))
      void runTools(paneId, calls)
    },

    deny: (paneId) => {
      const c = get().byPane[paneId]
      if (!c?.pending) return
      const calls = c.pending
      patch(paneId, (p) => ({
        ...p,
        pending: null,
        streaming: true,
        convo: [
          ...p.convo,
          ...calls.map((call) => ({
            role: 'tool' as const,
            name: call.function.name,
            content: wrapUntrusted(call.function.name, { denied: true, note: 'User denied this action.' })
          }))
        ]
      }))
      sendTurn(paneId)
    },

    stop: (paneId) => {
      window.api.uregant.stop(paneId)
      patch(paneId, (p) => ({ ...p, streaming: false, pending: null }))
    },

    clear: (paneId) => patch(paneId, () => blank()),

    remove: (paneId) =>
      set((s) => {
        const b = { ...s.byPane }
        delete b[paneId]
        return { byPane: b }
      }),

    _delta: (paneId, delta) => patch(paneId, (p) => ({ ...p, streamingText: p.streamingText + delta })),

    _error: (paneId, message) => patch(paneId, (p) => ({ ...p, streaming: false, error: message })),

    _done: (paneId, result) => {
      // commit the assistant turn (content + any tool calls)
      patch(paneId, (p) => ({
        ...p,
        streamingText: '',
        convo: [
          ...p.convo,
          {
            role: 'assistant',
            content: result.content,
            tool_calls: result.toolCalls.length ? result.toolCalls : undefined
          }
        ]
      }))
      if (result.doneReason === 'aborted') {
        patch(paneId, (p) => ({ ...p, streaming: false }))
        return
      }
      const calls = result.toolCalls
      if (!calls.length) {
        // model answered in prose — turn is finished
        patch(paneId, (p) => ({ ...p, streaming: false }))
        return
      }
      if (needsApproval(calls)) {
        patch(paneId, (p) => ({ ...p, streaming: false, pending: calls }))
      } else {
        patch(paneId, (p) => ({ ...p, streaming: true }))
        void runTools(paneId, calls)
      }
    }
  }
})
