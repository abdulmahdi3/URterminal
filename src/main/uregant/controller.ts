/**
 * Uregant loop controller (Slices 4–5) — runs in MAIN.
 *
 * Owns per-pane run state (survives renderer reload, §13). Drives turns via
 * streamUregant; classifies each batch of tool calls through the policy
 * (allowlist/denylist/secret-paths × autonomy, §11.2/§11.5): deny → blocked and
 * fed back; ask → Manual approval; allow → executed. run_command/checkpoint/
 * rollback/done run in main; pane tools dispatch to the renderer. Every tool
 * decision is written to the audit log (§11.4).
 */
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/types'
import type { UrChatMessage, UrToolCall, UrToolResult, UrAutonomy } from '@shared/uregant'
import { UR_TOOLS, UR_SYSTEM, UR_DONE_TOOL } from '@shared/uregantTools'
import { streamUregant, stopUregant } from './llm'
import { runCommand } from './exec'
import { wrapUntrusted } from './untrusted'
import { decideBatch } from './policy'
import { audit } from './audit'
import { createCheckpoint, restoreCheckpoint } from './checkpoint'

type Emit = (channel: string, payload: unknown) => void
type RunStatus = 'idle' | 'streaming' | 'awaiting-approval' | 'executing'

const DEFAULT_MODEL = 'qwen3.5:latest'
const MAX_STEPS = 16
const NUM_CTX = 16384
const TOOL_TIMEOUT_MS = 30_000

interface UrRun {
  paneId: string
  model: string
  baseUrl: string
  autonomy: UrAutonomy
  messages: UrChatMessage[]
  pending: UrToolCall[] | null
  steps: number
  status: RunStatus
  error: string | null
}

const runs = new Map<string, UrRun>()
const toolWaiters = new Map<string, (res: UrToolResult) => void>()

function ensure(paneId: string, model: string, baseUrl: string, autonomy: UrAutonomy): UrRun {
  let r = runs.get(paneId)
  if (!r) {
    r = { paneId, model: model || DEFAULT_MODEL, baseUrl, autonomy, messages: [], pending: null, steps: 0, status: 'idle', error: null }
    runs.set(paneId, r)
  }
  return r
}

function emitState(run: UrRun, emit: Emit): void {
  emit(IPC.uregantState, {
    paneId: run.paneId,
    messages: run.messages,
    streaming: run.status === 'streaming' || run.status === 'executing',
    pending: run.pending,
    error: run.error,
    model: run.model,
    autonomy: run.autonomy
  })
}

function pushToolResult(run: UrRun, name: string, value: unknown): void {
  run.messages.push({ role: 'tool', name, content: wrapUntrusted(name, value) })
}

/** Ask the renderer to run a pane tool and await its result. */
function dispatchToRenderer(paneId: string, name: string, args: Record<string, unknown>, emit: Emit): Promise<UrToolResult> {
  const callId = randomUUID()
  return new Promise<UrToolResult>((resolve) => {
    const timer = setTimeout(() => {
      toolWaiters.delete(callId)
      resolve({ ok: false, error: 'tool execution timed out (renderer unavailable)' })
    }, TOOL_TIMEOUT_MS)
    toolWaiters.set(callId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    emit(IPC.uregantExecTool, { paneId, callId, name, args })
  })
}

export function urToolResult(callId: string, result: UrToolResult): void {
  const w = toolWaiters.get(callId)
  if (w) {
    toolWaiters.delete(callId)
    w(result)
  }
}

async function executeOne(paneId: string, call: UrToolCall, emit: Emit): Promise<UrToolResult> {
  const name = call.function.name
  const args = call.function.arguments ?? {}
  if (name === UR_DONE_TOOL) return { ok: true, value: String(args.summary ?? 'done') }
  if (name === 'run_command') {
    const res = await runCommand({ command: String(args.command ?? ''), cwd: typeof args.cwd === 'string' ? args.cwd : undefined })
    return res.ok
      ? { ok: true, value: { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode } }
      : { ok: false, error: res.error ?? res.stderr ?? `exit ${res.exitCode}` }
  }
  if (name === 'checkpoint') {
    const res = await createCheckpoint(String(args.cwd ?? ''))
    return res.ok ? { ok: true, value: { checkpoint: res.sha } } : { ok: false, error: res.error ?? 'checkpoint failed' }
  }
  if (name === 'rollback') {
    const res = await restoreCheckpoint(String(args.cwd ?? ''), String(args.checkpoint ?? ''))
    return res.ok ? { ok: true, value: 'restored' } : { ok: false, error: res.error ?? 'rollback failed' }
  }
  // pane tools execute in the renderer (useWorkspace / terminalPool)
  return dispatchToRenderer(paneId, name, args, emit)
}

async function executeCalls(run: UrRun, calls: UrToolCall[], source: 'auto' | 'user', emit: Emit): Promise<void> {
  run.status = 'executing'
  run.pending = null
  emitState(run, emit)
  let finished = false
  for (const call of calls) {
    const result = await executeOne(run.paneId, call, emit)
    pushToolResult(run, call.function.name, result.ok ? result.value : { error: result.error })
    audit({
      paneId: run.paneId,
      tool: call.function.name,
      args: call.function.arguments,
      autonomy: run.autonomy,
      approval: source,
      ok: result.ok,
      detail: result.ok ? undefined : result.error
    })
    if (call.function.name === UR_DONE_TOOL) finished = true
  }
  if (finished) {
    run.status = 'idle'
    emitState(run, emit)
    return
  }
  if (run.steps >= MAX_STEPS) {
    run.status = 'idle'
    run.error = 'Step limit reached — stopped to avoid a runaway loop.'
    emitState(run, emit)
    return
  }
  run.steps += 1
  await drive(run, emit)
}

async function drive(run: UrRun, emit: Emit): Promise<void> {
  run.status = 'streaming'
  run.error = null
  emitState(run, emit)

  let turnError: string | null = null
  const result = await streamUregant(
    { paneId: run.paneId, model: run.model, baseUrl: run.baseUrl, messages: run.messages, tools: UR_TOOLS, system: UR_SYSTEM, numCtx: NUM_CTX },
    {
      delta: (pid, d) => emit(IPC.uregantDelta, { paneId: pid, delta: d }),
      toolCalls: () => {},
      done: () => {},
      error: (_pid, m) => {
        turnError = m
      }
    }
  )

  if (turnError) {
    run.status = 'idle'
    run.error = turnError
    emitState(run, emit)
    return
  }

  run.messages.push({
    role: 'assistant',
    content: result.content,
    tool_calls: result.toolCalls.length ? result.toolCalls : undefined
  })

  if (result.doneReason === 'aborted') {
    run.status = 'idle'
    emitState(run, emit)
    return
  }
  if (!result.toolCalls.length) {
    run.status = 'idle'
    emitState(run, emit)
    return
  }

  const batch = decideBatch(result.toolCalls, run.autonomy)
  if (batch.decision === 'deny') {
    // block the whole batch, feed reasons back so the model adapts
    result.toolCalls.forEach((call, i) => {
      const reason = batch.reasons[i] ?? 'blocked by policy'
      pushToolResult(run, call.function.name, { blocked: true, reason })
      audit({ paneId: run.paneId, tool: call.function.name, args: call.function.arguments, autonomy: run.autonomy, approval: 'blocked-by-policy', ok: false, detail: reason })
    })
    if (run.steps >= MAX_STEPS) {
      run.status = 'idle'
      run.error = 'Step limit reached — stopped to avoid a runaway loop.'
      emitState(run, emit)
      return
    }
    run.steps += 1
    await drive(run, emit)
    return
  }
  if (batch.decision === 'ask') {
    run.status = 'awaiting-approval'
    run.pending = result.toolCalls
    emitState(run, emit)
    return
  }
  await executeCalls(run, result.toolCalls, 'auto', emit)
}

// ---- commands from the renderer ----

export function urStart(paneId: string, model: string, baseUrl: string, text: string, autonomy: UrAutonomy, emit: Emit): void {
  if (!baseUrl) {
    const run = ensure(paneId, model, baseUrl, autonomy)
    run.error = 'No Ollama server configured. Set the Ollama base URL in Settings.'
    run.status = 'idle'
    emitState(run, emit)
    return
  }
  const run = ensure(paneId, model, baseUrl, autonomy)
  run.model = model || run.model
  run.baseUrl = baseUrl
  run.autonomy = autonomy
  run.error = null
  run.steps = 0
  run.messages.push({ role: 'user', content: text })
  void drive(run, emit)
}

export function urApprove(paneId: string, emit: Emit): void {
  const run = runs.get(paneId)
  if (!run?.pending) return
  void executeCalls(run, run.pending, 'user', emit)
}

export function urDeny(paneId: string, emit: Emit): void {
  const run = runs.get(paneId)
  if (!run?.pending) return
  for (const call of run.pending) {
    pushToolResult(run, call.function.name, { denied: true, note: 'User denied this action.' })
    audit({ paneId, tool: call.function.name, args: call.function.arguments, autonomy: run.autonomy, approval: 'denied-by-user', ok: false })
  }
  run.pending = null
  void drive(run, emit)
}

export function urStop(paneId: string, emit: Emit): void {
  stopUregant(paneId)
  const run = runs.get(paneId)
  if (run) {
    run.status = 'idle'
    run.pending = null
    emitState(run, emit)
  }
}

/** Renderer (re)mounted — re-push current state so a reloaded view re-attaches. */
export function urResync(paneId: string, emit: Emit): void {
  const run = runs.get(paneId)
  if (run) emitState(run, emit)
}

export function urRemove(paneId: string): void {
  runs.delete(paneId)
}
