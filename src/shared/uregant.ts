/**
 * Uregant — local + cloud AI orchestrator. Shared contracts for the tool-calling
 * chat loop. See UREGANT_PLAN.md (§4 brain, §7 tool contract).
 *
 * The brain runs a turn over Ollama's /api/chat: it streams assistant text AND may
 * emit `tool_calls`. The loop controller executes each call (returning a UrToolResult),
 * appends a role:'tool' message, and runs the next turn until the model stops calling
 * tools (or a budget/iteration cap is hit).
 */

/** One message in the running conversation sent to the model. */
export interface UrChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** assistant turns may carry the tool calls the model decided to make */
  tool_calls?: UrToolCall[]
  /** for role:'tool' — the tool whose result this message carries */
  name?: string
}

/** A tool definition advertised to the model (JSON-Schema `parameters`). */
export interface UrToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    /** JSON Schema object describing the arguments */
    parameters: Record<string, unknown>
  }
}

/** A tool call the model emitted. `arguments` is always normalized to an object. */
export interface UrToolCall {
  id?: string
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

/**
 * Uniform tool-execution result (§7). Every tool returns this; errors are fed back
 * to the model as a tool message so it can retry, never thrown across the loop.
 */
export type UrToolResult = { ok: true; value: unknown } | { ok: false; error: string }

/** Token accounting for one turn (from Ollama's *_eval_count fields). */
export interface UrUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/** Request to run one chat turn for a pane against a local Ollama server. */
export interface UrChatRequest {
  paneId: string
  model: string
  /** Ollama base URL, e.g. http://127.0.0.1:11434 */
  baseUrl: string
  /** conversation so far (user/assistant/tool); `system` is passed separately */
  messages: UrChatMessage[]
  /** tools advertised to the model this turn */
  tools?: UrToolSpec[]
  system?: string
  /** conservative per-role context window — NOT the model max (see §4.3) */
  numCtx?: number
  temperature?: number
  /** keep the model warm while a session is active; '0' to evict (see §4.3) */
  keepAlive?: string
}

/** The assembled outcome of one turn (also delivered live via events). */
export interface UrTurnResult {
  content: string
  toolCalls: UrToolCall[]
  usage?: UrUsage
  /** 'stop' | 'length' | 'aborted' | … */
  doneReason?: string
}

// ---- main -> renderer events (keyed by paneId) ----

/** incremental chunk of assistant text */
export interface UrDeltaEvent {
  paneId: string
  delta: string
}

/** the model emitted one or more tool calls this turn */
export interface UrToolCallEvent {
  paneId: string
  calls: UrToolCall[]
}

/** the turn finished */
export interface UrDoneEvent {
  paneId: string
  result: UrTurnResult
}

/** the turn failed */
export interface UrErrorEvent {
  paneId: string
  message: string
}

// ---- headless command execution (run_command tool, executed in main) ----

export interface UrExecRequest {
  command: string
  cwd?: string
  timeoutMs?: number
}

export interface UrExecResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  /** set when the command was blocked by safety policy or failed to spawn */
  error?: string
}

/**
 * renderer -> main chat request. Same as UrChatRequest but WITHOUT baseUrl —
 * the main process injects it from settings (getOllamaBaseUrl) so the renderer
 * never needs to know the local server URL.
 */
export type UrChatSend = Omit<UrChatRequest, 'baseUrl'>

// ---- Slice 4: loop controller in main. renderer <-> main protocol ----

/** Autonomy level governing which actions auto-run vs need approval (§11.5). */
export type UrAutonomy = 'manual' | 'auto-safe' | 'full-auto'

/** renderer -> main: begin/continue a run with the user's text. */
export interface UrStartRequest {
  paneId: string
  model: string
  text: string
  autonomy: UrAutonomy
}

/** main -> renderer: authoritative run snapshot the renderer mirrors and renders. */
export interface UrStateEvent {
  paneId: string
  messages: UrChatMessage[]
  streaming: boolean
  pending: UrToolCall[] | null
  error: string | null
  model: string
  autonomy: UrAutonomy
}

/** main -> renderer: execute a pane tool and reply with uregant:tool-result. */
export interface UrExecToolEvent {
  paneId: string
  callId: string
  name: string
  args: Record<string, unknown>
}

/** renderer -> main: the result of a dispatched pane tool. */
export interface UrToolResultMsg {
  callId: string
  result: UrToolResult
}

/** main -> renderer: `ollama pull` progress for a model tag (Phase 2). */
export interface UrPullProgress {
  tag: string
  status: string
  completed?: number
  total?: number
  done?: boolean
  error?: string
}

