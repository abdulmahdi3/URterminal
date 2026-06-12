/**
 * Pure parsing of Claude Code's `--output-format stream-json` NDJSON stream into
 * render-ready "cards", shared so the renderer can show structured tool-call /
 * diff / result UI instead of raw terminal text. No Node/DOM deps — unit-tested.
 *
 * The stream is newline-delimited JSON, one event per line:
 *   { type:'system', subtype:'init', model, tools, cwd, session_id }
 *   { type:'assistant', message:{ content:[{type:'text'|'thinking'|'tool_use', …}] } }
 *   { type:'user', message:{ content:[{type:'tool_result', tool_use_id, content, is_error}] } }
 *   { type:'result', subtype, is_error, duration_ms, num_turns, total_cost_usd, usage, result }
 * Partial/`stream_event` deltas (only emitted with --include-partial-messages)
 * are ignored — the complete assistant message still arrives.
 */

export interface InitCard {
  kind: 'init'
  model: string
  tools: string[]
  cwd: string
}
export interface TextCard {
  kind: 'text'
  text: string
}
export interface ThinkingCard {
  kind: 'thinking'
  text: string
}
export interface ToolUseCard {
  kind: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
export interface ToolResultCard {
  kind: 'tool_result'
  toolUseId: string
  text: string
  isError: boolean
}
export interface ResultCard {
  kind: 'result'
  subtype: string
  isError: boolean
  durationMs?: number
  numTurns?: number
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  text?: string
}

export type StreamCard =
  | InitCard
  | TextCard
  | ThinkingCard
  | ToolUseCard
  | ToolResultCard
  | ResultCard

export interface ParsedStream {
  cards: StreamCard[]
  /** session id seen in any event (used to `--resume` the next turn) */
  sessionId?: string
  /** a terminal `result` event was seen — the turn is finished */
  done: boolean
}

/** A `tool_result.content` may be a string or an array of content blocks. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as Record<string, unknown>
        if (block.type === 'text' && typeof block.text === 'string') return block.text
        if (block.type === 'image') return '[image]'
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/**
 * Parse the full accumulated NDJSON `raw` into ordered cards. Incomplete or
 * non-JSON lines (e.g. a half-written final line still streaming) are skipped,
 * so calling this repeatedly as output arrives is safe and idempotent.
 */
export function parseStream(raw: string): ParsedStream {
  const cards: StreamCard[] = []
  let sessionId: string | undefined
  let done = false

  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s[0] !== '{') continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(s)
    } catch {
      continue // partial trailing line or noise
    }
    if (typeof ev.session_id === 'string') sessionId = ev.session_id

    switch (ev.type) {
      case 'system': {
        if (ev.subtype === 'init') {
          cards.push({
            kind: 'init',
            model: typeof ev.model === 'string' ? ev.model : '',
            tools: Array.isArray(ev.tools) ? (ev.tools as string[]) : [],
            cwd: typeof ev.cwd === 'string' ? ev.cwd : ''
          })
        }
        break
      }
      case 'assistant': {
        const msg = ev.message as Record<string, unknown> | undefined
        const content = Array.isArray(msg?.content) ? (msg!.content as Record<string, unknown>[]) : []
        for (const b of content) {
          if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
            cards.push({ kind: 'text', text: b.text })
          } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) {
            cards.push({ kind: 'thinking', text: b.thinking })
          } else if (b.type === 'tool_use') {
            cards.push({
              kind: 'tool_use',
              id: typeof b.id === 'string' ? b.id : '',
              name: typeof b.name === 'string' ? b.name : 'tool',
              input: (b.input as Record<string, unknown>) ?? {}
            })
          }
        }
        break
      }
      case 'user': {
        const msg = ev.message as Record<string, unknown> | undefined
        const content = Array.isArray(msg?.content) ? (msg!.content as Record<string, unknown>[]) : []
        for (const b of content) {
          if (b.type === 'tool_result') {
            cards.push({
              kind: 'tool_result',
              toolUseId: typeof b.tool_use_id === 'string' ? b.tool_use_id : '',
              text: toolResultText(b.content),
              isError: b.is_error === true
            })
          }
        }
        break
      }
      case 'result': {
        done = true
        const usage = ev.usage as Record<string, unknown> | undefined
        cards.push({
          kind: 'result',
          subtype: typeof ev.subtype === 'string' ? ev.subtype : '',
          isError: ev.is_error === true,
          durationMs: typeof ev.duration_ms === 'number' ? ev.duration_ms : undefined,
          numTurns: typeof ev.num_turns === 'number' ? ev.num_turns : undefined,
          costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : undefined,
          inputTokens: typeof usage?.input_tokens === 'number' ? (usage.input_tokens as number) : undefined,
          outputTokens:
            typeof usage?.output_tokens === 'number' ? (usage.output_tokens as number) : undefined,
          text: typeof ev.result === 'string' ? ev.result : undefined
        })
        break
      }
    }
  }
  return { cards, sessionId, done }
}

/** Short label + detail for a tool_use card header (e.g. Bash → its command). */
export function summarizeTool(name: string, input: Record<string, unknown>): { detail?: string } {
  const str = (k: string): string | undefined => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  switch (name) {
    case 'Bash':
      return { detail: str('command') }
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { detail: str('file_path') ?? str('notebook_path') }
    case 'Grep':
      return { detail: str('pattern') }
    case 'Glob':
      return { detail: str('pattern') }
    case 'WebFetch':
      return { detail: str('url') }
    case 'WebSearch':
      return { detail: str('query') }
    case 'Task':
      return { detail: str('description') }
    default:
      return {}
  }
}

/** Whether a tool_use should render a before/after diff (file edits). */
export function isEditTool(name: string): boolean {
  return name === 'Edit' || name === 'Write' || name === 'MultiEdit'
}

/** Normalize an Edit/Write/MultiEdit tool input into before/after line pairs for
 *  a diff-style preview. Write → all-added; Edit → one pair; MultiEdit → many. */
export function editPreview(
  name: string,
  input: Record<string, unknown>
): { file: string; edits: { before: string; after: string }[] } {
  const file = (input.file_path as string) || ''
  if (name === 'Write') {
    return { file, edits: [{ before: '', after: (input.content as string) ?? '' }] }
  }
  if (name === 'MultiEdit') {
    const raw = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []
    return {
      file,
      edits: raw.map((e) => ({
        before: (e.old_string as string) ?? '',
        after: (e.new_string as string) ?? ''
      }))
    }
  }
  // Edit
  return { file, edits: [{ before: (input.old_string as string) ?? '', after: (input.new_string as string) ?? '' }] }
}
