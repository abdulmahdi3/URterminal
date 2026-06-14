import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Send,
  Square,
  Loader2,
  RotateCcw,
  RefreshCw,
  ChevronDown,
  Search,
  Wallet,
  AlertTriangle,
  Pin
} from 'lucide-react'
import type { Pane, OrModelInfo, OrCredits } from '@shared/types'
import { DEFAULT_MODELS } from '@shared/providers'
import { useWorkspace } from '@renderer/store/workspace'
import { useOrChat } from '@renderer/store/orchat'
import { useModelPins } from '@renderer/store/modelPins'
import { AgentLogo } from './brandIcons'
import MarkdownLite from './MarkdownLite'

/** Shared, lazily-fetched model catalog — one fetch across all OpenRouter panes. */
let MODELS_CACHE: OrModelInfo[] | null = null

function shortPrice(perToken?: number): string | null {
  if (!perToken || perToken <= 0) return null
  const perM = perToken * 1_000_000
  return perM >= 1 ? `$${perM.toFixed(0)}/M` : `$${perM.toFixed(2)}/M`
}
function shortCtx(n?: number): string | null {
  if (!n) return null
  return n >= 1000 ? `${Math.round(n / 1000)}K ctx` : `${n} ctx`
}
/** A model is free when its id is tagged `:free` or both prices are zero. */
function isFreeModel(m: OrModelInfo): boolean {
  return m.id.endsWith(':free') || (m.promptPrice === 0 && (m.completionPrice ?? 0) === 0)
}
/** Free-ness by id (checks the `:free` suffix, then the cached catalog). */
function modelIsFree(id: string): boolean {
  if (id.endsWith(':free')) return true
  const m = MODELS_CACHE?.find((x) => x.id === id)
  return m ? isFreeModel(m) : false
}

/** Rotating verbs so a long wait reads as "working", not "frozen". */
const THINKING_WORDS = [
  'Thinking',
  'Working',
  'Reasoning',
  'Pondering',
  'Cooking',
  'Crunching',
  'Composing',
  'Synthesizing',
  'Connecting the dots',
  'Generating',
  'Drafting',
  'Considering'
]

/** Animated "working" indicator: spinner + a rotating verb + bouncing dots. */
function ThinkingLoader(): JSX.Element {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % THINKING_WORDS.length), 1700)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="stream-working or-thinking">
      <Loader2 size={14} className="spin" />
      <span key={i} className="or-thinking-word">
        {THINKING_WORDS[i]}
      </span>
      <span className="or-thinking-dots">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}

/** Searchable model picker, populated live from OpenRouter's /models (cached). */
function ModelPicker({ model, onPick }: { model: string; onPick: (id: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [models, setModels] = useState<OrModelInfo[]>(MODELS_CACHE ?? [])
  const pinned = useModelPins((s) => s.pinned)
  const togglePin = useModelPins((s) => s.toggle)
  useEffect(() => {
    if (!open || MODELS_CACHE) return
    void window.api.openrouter.models().then((list) => {
      if (list.length) {
        MODELS_CACHE = list
        setModels(list)
      }
    })
  }, [open])
  // Curated fallback before/if the live fetch fails (offline / no key).
  const list: OrModelInfo[] = models.length
    ? models
    : DEFAULT_MODELS.openrouter.map((id) => ({ id }))
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const arr = needle
      ? list.filter((m) => (m.id + ' ' + (m.name ?? '')).toLowerCase().includes(needle))
      : list
    const pinnedSet = new Set(pinned)
    return [...arr]
      .sort((a, b) => (pinnedSet.has(b.id) ? 1 : 0) - (pinnedSet.has(a.id) ? 1 : 0))
      .slice(0, 80)
  }, [q, list, pinned])
  return (
    <div className="or-picker">
      <button className="or-picker-btn" onClick={() => setOpen((v) => !v)} title="Choose model">
        <span className="or-picker-model">{model}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <>
          <div className="or-picker-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="or-picker-pop">
            <div className="or-picker-search">
              <Search size={13} />
              <input
                autoFocus
                value={q}
                placeholder="Search 200+ models…"
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="or-picker-list">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  className={'or-picker-row' + (m.id === model ? ' active' : '')}
                  onClick={() => {
                    onPick(m.id)
                    setOpen(false)
                  }}
                >
                  <span className="or-picker-id">{m.id}</span>
                  <span className="or-picker-meta">
                    {shortCtx(m.contextLength) && <span>{shortCtx(m.contextLength)}</span>}
                    {isFreeModel(m) ? (
                      <span className="or-tag free">FREE</span>
                    ) : (
                      shortPrice(m.promptPrice) && <span>{shortPrice(m.promptPrice)} in</span>
                    )}
                  </span>
                  <span
                    className={'or-picker-pin' + (pinned.includes(m.id) ? ' on' : '')}
                    title={pinned.includes(m.id) ? 'Unpin' : 'Pin'}
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePin(m.id)
                    }}
                  >
                    <Pin size={12} />
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <div className="or-picker-empty">No models match “{q}”.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Native OpenRouter chat pane: streams replies over HTTP (no CLI), with a live
 * 200+-model picker, per-reply cost, and account credits. Transcript persists in
 * `Pane.openrouter.messages`.
 */
export default function OpenRouterChatPane({ pane }: { pane: Pane }): JSX.Element {
  const updatePane = useWorkspace((s) => s.updatePane)
  const model = pane.openrouter?.model ?? DEFAULT_MODELS.openrouter[0]
  const system = pane.openrouter?.system
  const temperature = pane.openrouter?.temperature
  const cs = useOrChat((s) => s.byPane[pane.id])
  const streaming = cs?.streaming ?? false
  const messages = cs?.messages ?? []
  const [input, setInput] = useState('')
  const [credits, setCredits] = useState<OrCredits | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Restore the persisted transcript into the live store on first mount.
  useEffect(() => {
    if (pane.openrouter?.messages?.length) useOrChat.getState().seed(pane.id, pane.openrouter.messages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the account balance fresh: on mount and whenever a turn settles.
  useEffect(() => {
    if (!streaming) void window.api.openrouter.credits().then(setCredits)
  }, [streaming])

  // Persist the transcript into pane state when a turn settles (not per delta).
  useEffect(() => {
    if (streaming) return
    const msgs = useOrChat.getState().byPane[pane.id]?.messages ?? []
    updatePane(pane.id, { openrouter: { ...pane.openrouter, model, messages: msgs.slice(-100) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, messages.length])

  // Follow the tail as tokens stream in.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const send = (text?: string): void => {
    const prompt = (text ?? input).trim()
    if (!prompt || streaming) return
    // Pre-flight: a paid model needs a positive balance — fail fast with a clear
    // message instead of a confusing mid-stream billing error.
    if (!modelIsFree(model) && credits && (credits.remaining ?? 0) <= 0) {
      useOrChat.getState().beginTurn(pane.id, prompt)
      useOrChat
        .getState()
        .failTurn(
          pane.id,
          'You have $0.00 OpenRouter credits. Add credits at openrouter.ai/credits, or switch to a model tagged FREE.'
        )
      setInput('')
      return
    }
    useOrChat.getState().beginTurn(pane.id, prompt)
    setInput('')
    const prior = useOrChat.getState().byPane[pane.id]?.messages ?? []
    // exclude the just-pushed empty assistant placeholder and any failed replies
    const reqMessages = prior
      .slice(0, -1)
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }))
    void window.api.openrouter.send({ paneId: pane.id, model, messages: reqMessages, temperature, system })
  }
  const stop = (): void => window.api.openrouter.stop(pane.id)
  const regenerate = (): void => {
    const last = useOrChat.getState().popLastTurn(pane.id)
    if (last) send(last)
  }
  const setModel = (id: string): void =>
    updatePane(pane.id, {
      openrouter: { ...pane.openrouter, model: id },
      title: id.split('/').pop() || 'OpenRouter'
    })

  const totalCost = messages.reduce((sum, m) => sum + (m.usage?.costUsd ?? 0), 0)
  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant'

  return (
    <div className="stream-pane or-pane">
      <div className="stream-head">
        <span className="or-head-logo">
          <AgentLogo command="openrouter" size={15} />
        </span>
        <ModelPicker model={model} onPick={setModel} />
        <div className="stream-head-spacer" />
        {totalCost > 0 && (
          <span className="or-pill" title="Total cost this conversation">
            ${totalCost.toFixed(4)}
          </span>
        )}
        {credits?.remaining != null && (
          <span className="or-pill" title="OpenRouter credits remaining">
            <Wallet size={11} /> ${credits.remaining.toFixed(2)}
          </span>
        )}
        <button
          className="icon-btn"
          title="New conversation (clears transcript)"
          onClick={() => useOrChat.getState().clear(pane.id)}
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="stream-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="stream-empty">Ask anything — {model} via OpenRouter.</div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="stream-prompt">
              {m.content}
            </div>
          ) : (
            <div key={i} className="or-assistant">
              {m.content && (
                <div className="stream-card stream-text">
                  <MarkdownLite text={m.content} />
                </div>
              )}
              {streaming && i === messages.length - 1 && !m.content && <ThinkingLoader />}
              {m.error && (
                <div className="or-err">
                  <AlertTriangle size={12} /> {m.error}
                </div>
              )}
              {m.usage && (m.usage.totalTokens || m.usage.costUsd != null) && (
                <div className="or-usage">
                  {m.usage.totalTokens ? `${m.usage.totalTokens} tok` : ''}
                  {m.usage.costUsd != null
                    ? `${m.usage.totalTokens ? ' · ' : ''}$${m.usage.costUsd.toFixed(4)}`
                    : ''}
                </div>
              )}
            </div>
          )
        )}
      </div>

      <div className="stream-input">
        <textarea
          className="input mono stream-textarea"
          placeholder={
            streaming ? 'Streaming…' : 'Message OpenRouter…  (Enter to send, Shift+Enter for newline)'
          }
          value={input}
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="stream-input-row">
          {lastIsAssistant && !streaming && (
            <button className="btn" onClick={regenerate} title="Regenerate the last reply">
              <RefreshCw size={12} /> Regenerate
            </button>
          )}
          <div className="stream-head-spacer" />
          {streaming ? (
            <button className="btn danger" onClick={stop}>
              <Square size={12} /> Stop
            </button>
          ) : (
            <button className="btn primary" onClick={() => send()} disabled={!input.trim()}>
              <Send size={12} /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
