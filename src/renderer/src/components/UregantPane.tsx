import { useState, useRef, useEffect, useCallback } from 'react'
import type { Pane } from '@shared/types'
import type { UrAutonomy } from '@shared/uregant'
import { useUregant, UREGANT_DEFAULT_MODEL } from '../store/uregant'
import { useWorkspace } from '../store/workspace'

/**
 * Uregant pane (Slice 2–3) — chat with the local orchestrator, watch it stream,
 * approve/deny its actions. Slice 3 adds an Ollama onboarding gate (no silent
 * failure when the server/model is missing) and a model picker over installed
 * models. Reuses stream-* layout; dir="ltr" forced (RTL gotcha — code content).
 */
export default function UregantPane({ pane }: { pane: Pane }): JSX.Element {
  const c = useUregant((s) => s.byPane[pane.id])
  const streaming = c?.streaming ?? false
  const messages = c?.messages ?? []
  const pending = c?.pending ?? null
  const updatePane = useWorkspace((s) => s.updatePane)

  const [models, setModels] = useState<string[]>([])
  const [probing, setProbing] = useState(true)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const model = c?.model ?? pane.uregant?.model ?? UREGANT_DEFAULT_MODEL
  const autonomy: UrAutonomy = c?.autonomy ?? pane.uregant?.autonomy ?? 'manual'

  const chooseModel = (m: string): void => {
    useUregant.getState().setModel(pane.id, m)
    updatePane(pane.id, { uregant: { ...pane.uregant, model: m } })
  }

  const chooseAutonomy = (a: UrAutonomy): void => {
    useUregant.getState().setAutonomy(pane.id, a)
    updatePane(pane.id, { uregant: { ...pane.uregant, autonomy: a } })
  }

  const probe = useCallback(async (): Promise<void> => {
    setProbing(true)
    const found = await window.api.discoverModels('ollama')
    setModels(found)
    if (found.length) {
      const saved = pane.uregant?.model
      const effective =
        saved && found.includes(saved)
          ? saved
          : found.includes(UREGANT_DEFAULT_MODEL)
            ? UREGANT_DEFAULT_MODEL
            : found[0]
      useUregant.getState().setModel(pane.id, effective)
      if (effective !== saved) updatePane(pane.id, { uregant: { ...pane.uregant, model: effective } })
    }
    setProbing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id])

  useEffect(() => {
    void probe()
    if (pane.uregant?.autonomy) useUregant.getState().setAutonomy(pane.id, pane.uregant.autonomy)
    // re-attach to any in-flight run owned by main (survives a renderer reload)
    useUregant.getState().resync(pane.id)
    // probe once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, c?.streamingText, pending])

  const send = (): void => {
    const t = input.trim()
    if (!t || streaming || pending) return
    setInput('')
    useUregant.getState().send(pane.id, t)
  }

  // ---- onboarding gate: Ollama unreachable / no models ----
  if (!probing && models.length === 0) {
    return (
      <div className="stream-pane ur-pane" dir="ltr">
        <div className="stream-head">
          <span style={{ fontWeight: 650 }}>⬡ Uregant</span>
        </div>
        <div className="stream-scroll">
          <div style={onboardStyle}>
            <div style={{ fontWeight: 650, marginBottom: 8 }}>Ollama not detected</div>
            <div style={{ opacity: 0.75, fontSize: 13, lineHeight: 1.55 }}>
              Uregant runs on a local <b>Ollama</b> server. Make sure Ollama is installed and
              running, then pull a model — for example:
            </div>
            <pre className="mono" style={cmdStyle}>ollama pull qwen3.5</pre>
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>
              Install: <span className="mono">https://ollama.com/download</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => void probe()}>
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="stream-pane ur-pane" dir="ltr">
      <div className="stream-head">
        <span style={{ fontWeight: 650 }}>⬡ Uregant</span>
        {models.length > 0 ? (
          <select
            className="input mono"
            value={model}
            onChange={(e) => chooseModel(e.target.value)}
            disabled={streaming}
            style={{ marginLeft: 8, fontSize: 11, padding: '2px 6px' }}
            title="Local model driving Uregant"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <span className="mono" style={{ marginLeft: 8, opacity: 0.6, fontSize: 11 }}>
            {probing ? 'checking Ollama…' : model}
          </span>
        )}
        <select
          className="input mono"
          value={autonomy}
          onChange={(e) => chooseAutonomy(e.target.value as UrAutonomy)}
          disabled={streaming}
          style={{ marginLeft: 8, fontSize: 11, padding: '2px 6px' }}
          title="Autonomy — how much Uregant may do without asking"
        >
          <option value="manual">Manual</option>
          <option value="auto-safe">Auto-safe</option>
          <option value="full-auto">Full-auto</option>
        </select>
      </div>

      <div className="stream-scroll" ref={scrollRef}>
        {messages.length === 0 && !c?.streamingText && (
          <div className="stream-empty">
            Tell Uregant what to do — it opens panes, runs commands, and drives your terminal. ({model})
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} className="stream-prompt">
                {m.content}
              </div>
            )
          }
          if (m.role === 'tool') {
            return (
              <pre key={i} className="mono" style={toolResultStyle} title="tool result — untrusted data">
                {truncate(m.content)}
              </pre>
            )
          }
          // assistant
          return (
            <div key={i} className="ur-assistant">
              {m.content && <div className="stream-card stream-text">{m.content}</div>}
              {m.tool_calls?.map((tc, j) => (
                <div key={j} className="mono" style={toolCallStyle}>
                  → {tc.function.name}({argsPreview(tc.function.arguments)})
                </div>
              ))}
            </div>
          )
        })}

        {streaming && c?.streamingText && (
          <div className="stream-card stream-text" style={{ opacity: 0.85 }}>
            {c.streamingText}
          </div>
        )}
        {streaming && !c?.streamingText && (
          <div className="mono" style={{ opacity: 0.5, padding: '6px 2px' }}>
            …thinking
          </div>
        )}
        {c?.error && <div className="or-err">{c.error}</div>}

        {pending && (
          <div style={approvalStyle}>
            <div className="mono" style={{ fontWeight: 650, marginBottom: 6 }}>
              Approve {pending.length} action{pending.length > 1 ? 's' : ''}?
            </div>
            {pending.map((tc, i) => (
              <div key={i} className="mono" style={{ fontSize: 12, marginBottom: 4 }}>
                {tc.function.name}({argsPreview(tc.function.arguments)})
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn" onClick={() => useUregant.getState().deny(pane.id)}>
                Deny
              </button>
              <button
                className="btn"
                style={{ background: 'var(--accent, #3a7afe)', color: '#fff' }}
                onClick={() => useUregant.getState().approve(pane.id)}
              >
                Approve
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="stream-input">
        <textarea
          className="input mono stream-textarea"
          placeholder="Ask Uregant to do something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
          disabled={!!pending}
        />
        <div className="stream-input-row">
          {streaming ? (
            <button className="btn" onClick={() => useUregant.getState().stop(pane.id)}>
              Stop
            </button>
          ) : (
            <button className="btn" onClick={send} disabled={!input.trim() || !!pending}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const toolResultStyle: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: '4px 0',
  paddingLeft: 8,
  borderLeft: '2px solid var(--line, #333)'
}
const toolCallStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--accent, #3a7afe)',
  margin: '3px 0'
}
const approvalStyle: React.CSSProperties = {
  border: '1px solid var(--accent, #3a7afe)',
  borderRadius: 8,
  padding: 10,
  margin: '8px 0',
  background: 'var(--panel-2, rgba(58,122,254,0.06))'
}
const onboardStyle: React.CSSProperties = {
  border: '1px solid var(--line, #333)',
  borderRadius: 8,
  padding: 16,
  margin: '8px 0',
  maxWidth: 460
}
const cmdStyle: React.CSSProperties = {
  background: 'var(--panel-2, rgba(255,255,255,0.05))',
  borderRadius: 6,
  padding: '6px 10px',
  margin: '8px 0 0',
  fontSize: 12
}

function truncate(s: string): string {
  return s.length > 800 ? s.slice(0, 800) + '…' : s
}
function argsPreview(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args)
    return s.length > 90 ? s.slice(0, 90) + '…' : s
  } catch {
    return ''
  }
}
