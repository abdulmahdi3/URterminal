import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles,
  Send,
  Square,
  FolderOpen,
  Loader2,
  Wrench,
  Terminal as TerminalIcon,
  FileEdit,
  FileText,
  Search,
  Globe,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RotateCcw
} from 'lucide-react'
import type { Pane } from '@shared/types'
import {
  parseStream,
  summarizeTool,
  isEditTool,
  editPreview,
  type StreamCard,
  type ToolUseCard,
  type ToolResultCard,
  type ResultCard
} from '@shared/streamJson'
import { parseSegments } from '@renderer/lib/segments'
import { useWorkspace } from '@renderer/store/workspace'
import { useStreams } from '@renderer/store/streams'
import { getLastAgentCwd, setLastAgentCwd } from '@renderer/lib/agentPrefs'
import { homeDir } from '@renderer/lib/osInfo'
import { toast } from '@renderer/store/toasts'

/** Lightweight markdown: plain text with fenced code blocks (no extra deps). */
function MarkdownLite({ text }: { text: string }): JSX.Element {
  const segments = useMemo(() => parseSegments(text), [text])
  return (
    <>
      {segments.map((s, i) =>
        s.type === 'code' ? (
          <pre key={i} className="stream-code">
            <code>{s.text}</code>
          </pre>
        ) : (
          <div key={i} className="stream-md">
            {s.text}
          </div>
        )
      )}
    </>
  )
}

const TOOL_ICON: Record<string, JSX.Element> = {
  Bash: <TerminalIcon size={13} />,
  Edit: <FileEdit size={13} />,
  Write: <FileEdit size={13} />,
  MultiEdit: <FileEdit size={13} />,
  Read: <FileText size={13} />,
  Grep: <Search size={13} />,
  Glob: <Search size={13} />,
  WebFetch: <Globe size={13} />,
  WebSearch: <Globe size={13} />,
  TodoWrite: <ListChecks size={13} />
}

/** Render an Edit/Write/MultiEdit input as a before/after diff. */
function EditDiff({ card }: { card: ToolUseCard }): JSX.Element {
  const { edits } = editPreview(card.name, card.input)
  return (
    <div className="stream-editdiff">
      {edits.map((e, i) => (
        <div key={i} className="stream-edit">
          {e.before
            ? e.before.split('\n').map((l, j) => (
                <div key={`b${j}`} className="diff-line del">
                  - {l}
                </div>
              ))
            : null}
          {e.after.split('\n').map((l, j) => (
            <div key={`a${j}`} className="diff-line add">
              + {l}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Render TodoWrite input as a checklist. */
function TodoList({ input }: { input: Record<string, unknown> }): JSX.Element | null {
  const todos = Array.isArray(input.todos) ? (input.todos as Record<string, unknown>[]) : []
  if (!todos.length) return null
  return (
    <div className="stream-todos">
      {todos.map((t, i) => {
        const status = String(t.status ?? '')
        const mark = status === 'completed' ? '✓' : status === 'in_progress' ? '◑' : '○'
        return (
          <div key={i} className={`stream-todo ${status}`}>
            <span className="stream-todo-mark">{mark}</span>
            {String(t.content ?? '')}
          </div>
        )
      })}
    </div>
  )
}

function ToolUseView({ card }: { card: ToolUseCard }): JSX.Element {
  const { detail } = summarizeTool(card.name, card.input)
  return (
    <div className="stream-tool">
      <div className="stream-tool-head">
        {TOOL_ICON[card.name] ?? <Wrench size={13} />}
        <span className="stream-tool-name">{card.name}</span>
        {detail && <span className="stream-tool-detail">{detail}</span>}
      </div>
      {isEditTool(card.name) && <EditDiff card={card} />}
      {card.name === 'TodoWrite' && <TodoList input={card.input} />}
      {card.name === 'Bash' && typeof card.input.command !== 'string' && (
        <pre className="stream-code">
          <code>{JSON.stringify(card.input, null, 2)}</code>
        </pre>
      )}
    </div>
  )
}

function ToolResultView({ card }: { card: ToolResultCard }): JSX.Element {
  const text = card.text.trim()
  const long = text.length > 600 || text.split('\n').length > 12
  const [open, setOpen] = useState(false)
  const shown = open || !long ? text : text.slice(0, 600)
  if (!text) return <div className="stream-result-empty">·</div>
  return (
    <div className={`stream-toolresult ${card.isError ? 'err' : ''}`}>
      <pre className="stream-code">
        <code>{shown}</code>
      </pre>
      {long && (
        <button className="stream-more" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : `Show ${text.length - 600} more chars`}
        </button>
      )}
    </div>
  )
}

function ResultBar({ card }: { card: ResultCard }): JSX.Element {
  const bits: string[] = []
  if (card.durationMs) bits.push(`${(card.durationMs / 1000).toFixed(1)}s`)
  if (card.numTurns) bits.push(`${card.numTurns} turns`)
  if (card.inputTokens || card.outputTokens)
    bits.push(`${(card.inputTokens ?? 0) + (card.outputTokens ?? 0)} tok`)
  if (typeof card.costUsd === 'number') bits.push(`$${card.costUsd.toFixed(4)}`)
  return (
    <div className={`stream-resultbar ${card.isError ? 'err' : ''}`}>
      {card.isError ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
      <span>{card.isError ? card.subtype || 'error' : 'done'}</span>
      {bits.length > 0 && <span className="stream-result-meta">{bits.join(' · ')}</span>}
    </div>
  )
}

function Card({ card }: { card: StreamCard }): JSX.Element | null {
  switch (card.kind) {
    case 'init':
      return (
        <div className="stream-init">
          {card.model || 'claude'}
          {card.tools.length ? ` · ${card.tools.length} tools` : ''}
        </div>
      )
    case 'text':
      return (
        <div className="stream-card stream-text">
          <MarkdownLite text={card.text} />
        </div>
      )
    case 'thinking':
      return (
        <div className="stream-card stream-thinking">
          <MarkdownLite text={card.text} />
        </div>
      )
    case 'tool_use':
      return (
        <div className="stream-card">
          <ToolUseView card={card} />
        </div>
      )
    case 'tool_result':
      return <ToolResultView card={card} />
    case 'result':
      return <ResultBar card={card} />
    default:
      return null
  }
}

/** One Claude turn: parse its NDJSON and render the cards (or raw on error). */
function TurnView({ raw, running }: { raw: string; running: boolean }): JSX.Element {
  const { cards } = useMemo(() => parseStream(raw), [raw])
  if (!cards.length) {
    if (running)
      return (
        <div className="stream-working">
          <Loader2 size={14} className="spin" /> working…
        </div>
      )
    // Finished with nothing parseable — surface the raw output (e.g. an auth error).
    const t = raw.trim()
    return t ? <pre className="stream-code stream-rawerr">{t}</pre> : <></>
  }
  return (
    <div className="stream-turn">
      {cards.map((c, i) => (
        <Card key={i} card={c} />
      ))}
      {running && (
        <div className="stream-working">
          <Loader2 size={14} className="spin" /> working…
        </div>
      )}
    </div>
  )
}

/** Folder picker shown before the first prompt (a stream pane needs a cwd). */
function StreamLauncher({ onOpen }: { onOpen: (dir: string) => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const pick = async (): Promise<void> => {
    setBusy(true)
    try {
      const dir = await window.api.pickDirectory(getLastAgentCwd() || homeDir())
      if (dir) {
        setLastAgentCwd(dir)
        onOpen(dir)
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stream-launcher">
      <Sparkles size={24} />
      <div className="stream-launcher-title">Stream view (Claude)</div>
      <div className="stream-launcher-sub">
        Renders tool calls, diffs and results as cards. Pick a folder to work in.
      </div>
      <button className="btn primary" onClick={pick} disabled={busy}>
        {busy ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />} Choose folder
      </button>
    </div>
  )
}

/**
 * The "stream pane": drives Claude in `--output-format stream-json` and renders
 * each turn's events (text, tool calls, edits, todos, result) as native cards.
 * One `claude -p` process per prompt; continuity via the captured session id.
 */
export default function StreamPane({ pane }: { pane: Pane }): JSX.Element {
  const updatePane = useWorkspace((s) => s.updatePane)
  const command = pane.stream?.command ?? 'claude'
  const cwd = pane.stream?.cwd
  const ps = useStreams((s) => s.byPane[pane.id])
  const running = ps?.running ?? false
  const entries = ps?.entries ?? []
  const [input, setInput] = useState('')
  const [fullAccess, setFullAccess] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Follow the tail as cards stream in.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, running])

  if (!cwd) {
    return <StreamLauncher onOpen={(dir) => updatePane(pane.id, { stream: { command, cwd: dir } })} />
  }

  const send = async (): Promise<void> => {
    const prompt = input.trim()
    if (!prompt || running) return
    const sessionId = useStreams.getState().byPane[pane.id]?.sessionId
    const args = [
      '--output-format',
      'stream-json',
      '--verbose',
      ...(sessionId ? ['--resume', sessionId] : []),
      ...(fullAccess ? ['--dangerously-skip-permissions'] : []),
      '-p',
      prompt
    ]
    try {
      const { ptyId } = await window.api.spawnPty({
        paneId: pane.id,
        command,
        commandArgs: args,
        cwd,
        cols: 120,
        rows: 40,
        freshLog: true
      })
      useStreams.getState().beginTurn(pane.id, ptyId, prompt)
      setInput('')
    } catch (e) {
      toast(`Couldn't start Claude: ${(e as Error).message}`, 'error')
    }
  }

  const stop = (): void => {
    const id = useStreams.getState().byPane[pane.id]?.ptyId
    if (id) window.api.killPty(id)
    useStreams.getState().endTurn(pane.id)
  }

  return (
    <div className={`stream-pane ${showThinking ? 'show-thinking' : ''}`}>
      <div className="stream-head">
        <Sparkles size={14} className="stream-head-icon" />
        <span className="stream-head-title">claude · stream</span>
        <span className="stream-head-cwd" title={cwd}>
          {cwd}
        </span>
        <div className="stream-head-spacer" />
        <button
          className="icon-btn"
          title={showThinking ? 'Hide thinking' : 'Show thinking'}
          onClick={() => setShowThinking((v) => !v)}
        >
          {showThinking ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button
          className="icon-btn"
          title="New conversation (clears transcript)"
          onClick={() => useStreams.getState().clear(pane.id)}
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="stream-scroll" ref={scrollRef}>
        {entries.length === 0 && (
          <div className="stream-empty">
            Ask Claude something. Tool calls, edits and results render as cards.
          </div>
        )}
        {entries.map((e, i) =>
          e.kind === 'prompt' ? (
            <div key={i} className="stream-prompt">
              {e.text}
            </div>
          ) : (
            <TurnView key={i} raw={e.raw} running={running && i === entries.length - 1} />
          )
        )}
      </div>

      <div className="stream-input">
        <textarea
          className="input mono stream-textarea"
          placeholder={running ? 'Claude is working…' : 'Message Claude…  (Enter to send, Shift+Enter for newline)'}
          value={input}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="stream-input-row">
          <label className="stream-access" title="Pass --dangerously-skip-permissions so Claude can edit files and run commands without prompting">
            <input type="checkbox" checked={fullAccess} onChange={(e) => setFullAccess(e.target.checked)} />
            Full access (edits &amp; commands)
          </label>
          <div className="stream-head-spacer" />
          {running ? (
            <button className="btn danger" onClick={stop}>
              <Square size={12} /> Stop
            </button>
          ) : (
            <button className="btn primary" onClick={() => void send()} disabled={!input.trim()}>
              <Send size={12} /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
