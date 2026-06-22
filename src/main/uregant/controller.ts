/**
 * Uregant loop controller (Slice 4) — runs in MAIN.
 *
 * Owns the per-pane run state (messages, pending tool calls, steps) so a renderer
 * reload/crash does NOT lose an in-flight run (UREGANT_PLAN.md §13). Drives turns
 * via streamUregant; executes run_command/done locally; dispatches pane tools
 * (open_pane/write_to_pane/read_pane/list_panes) to the renderer via a
 * request/response pair (uregant:exec-tool -> uregant:tool-result) and awaits the
 * result. Pushes authoritative state snapshots (uregant:state) the renderer mirrors.
 *
 * NOTE: state is in-memory (survives renderer reload, not a full app restart).
 * Disk persistence + resume-on-launch is the next step.
 */
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/types'
import type { UrChatMessage, UrToolCall, UrToolResult } from '@shared/uregant'
import { UR_TOOLS, UR_SYSTEM, UR_READONLY_TOOLS, UR_DONE_TOOL } from '@shared/uregantTools'
import { streamUregant, stopUregant } from './llm'
import { runCommand } from './exec'
import { wrapUntrusted } from './untrusted'

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
  messages: UrChatMessage[]
  pending: UrToolCall[] | null
  steps: number
  status: RunStatus
  error: string | null
}

const runs = new Map<string, UrRun>()
/** callId -> resolver for a tool dispatched to the renderer. */
const toolWaiters = new Map<string, (res: UrToolResult) => void>()

function ensure(paneId: string, model: string, baseUrl: string): UrRun {
  let r = runs.get(paneId)
  if (!r) {
    r = { paneId, model: model || DEFAULT_MODEL, baseUrl, messages: [], pending: null, steps: 0, status: 'idle', error: null }
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
    model: run.model
  })
}

/** Mutating tools need approval; read-only tools and `done` never do (§10). */
function needsApproval(calls: UrToolCall[]): boolean {
  return calls.some((c) => !UR_READONLY_TOOLS.has(c.function.name) && c.function.name !== UR_DONE_TOOL)
}

/** Ask the renderer to run a pane tool and await its result. */
function dispatchToRenderer(
  paneId: string,
  name: string,
  args: Record<string, unknown>,
  emit: Emit
): Promise<UrToolResult> {
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

/** Renderer reported a dispatched tool's result. */
export function urToolResult(callId: string, result: UrToolResult): void {
  const w = toolWaiters.get(callId)
  if (w) {
    toolWaiters.delete(callId)
    w(result)
  }
}

async function executeOne(
  paneId: string,
  call: UrToolCall,
  emit: Emit
): Promise<UrToolResult> {
  const name = call.function.name
  const args = call.function.arguments ?? {}
  if (name === UR_DONE_TOOL) return { ok: true, value: String(args.summary ?? 'done') }
  if (name === 'run_command') {
    const res = await runCommand({
      command: String(args.command ?? ''),
      cwd: typeof args.cwd === 'string' ? args.cwd : undefined
    })
    return res.ok
      ? { ok: true, value: { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode } }
      : { ok: false, error: res.error ?? res.stderr ?? `exit ${res.exitCode}` }
  }
  // pane tools execute in the renderer (useWorkspace / terminalPool)
  return dispatchToRenderer(paneId, name, args, emit)
}

async function executeCalls(run: UrRun, calls: UrToolCall[], emit: Emit): Promise<void> {
  run.status = 'executing'
  run.pending = null
  emitState(run, emit)
  let finished = false
  for (const call of calls) {
    const result = await executeOne(run.paneId, call, emit)
    run.messages.push({
      role: 'tool',
      name: call.function.name,
      content: wrapUntrusted(call.function.name, result.ok ? result.value : { error: result.error })
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
    {
      paneId: run.paneId,
      model: run.model,
      baseUrl: run.baseUrl,
      messages: run.messages,
      tools: UR_TOOLS,
      system: UR_SYSTEM,
      numCtx: NUM_CTX
    },
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
  if (needsApproval(result.toolCalls)) {
    run.status = 'awaiting-approval'
    run.pending = result.toolCalls
    emitState(run, emit)
    return
  }
  await executeCalls(run, result.toolCalls, emit)
}

// ---- commands from the renderer ----

export function urStart(paneId: string, model: string, baseUrl: string, text: string, emit: Emit): void {
  if (!baseUrl) {
    const run = ensure(paneId, model, baseUrl)
    run.error = 'No Ollama server configured. Set the Ollama base URL in Settings.'
    run.status = 'idle'
    emitState(run, emit)
    return
  }
  const run = ensure(paneId, model, baseUrl)
  run.model = model || run.model
  run.baseUrl = baseUrl
  run.error = null
  run.steps = 0
  run.messages.push({ role: 'user', content: text })
  void drive(run, emit)
}

export function urApprove(paneId: string, emit: Emit): void {
  const run = runs.get(paneId)
  if (!run?.pending) return
  void executeCalls(run, run.pending, emit)
}

export function urDeny(paneId: string, emit: Emit): void {
  const run = runs.get(paneId)
  if (!run?.pending) return
  for (const call of run.pending) {
    run.messages.push({
      role: 'tool',
      name: call.function.name,
      content: wrapUntrusted(call.function.name, { denied: true, note: 'User denied this action.' })
    })
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
