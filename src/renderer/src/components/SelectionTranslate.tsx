import { useEffect, useRef, useState } from 'react'
import { Languages, Copy, X, Loader2 } from 'lucide-react'
import { getPaneSelection } from '@renderer/lib/terminalPool'
import { useSettings } from '@renderer/store/settings'
import { langCode } from '@renderer/lib/translate'
import { toast } from '@renderer/store/toasts'

interface WidgetState {
  x: number
  y: number
  text: string
  phase: 'button' | 'loading' | 'result' | 'error'
  result?: string
  source?: string
  error?: string
}

/**
 * Google-Translate-extension-style floating action: after you select text in a
 * terminal pane, a small "Translate" button appears near where you released the
 * mouse. Clicking it translates the selection into the configured default
 * language (via the main-process Google endpoint) and shows the result inline.
 */
export default function SelectionTranslate(): JSX.Element | null {
  const [w, setW] = useState<WidgetState | null>(null)
  const targetLangName = useSettings((s) => s.settings?.prefs.defaultLanguage) || 'English'
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onUp = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node)) return // clicks inside the widget
      const host = (e.target as HTMLElement)?.closest?.('[data-pane-id]') as HTMLElement | null
      const paneId = host?.getAttribute('data-pane-id')
      const sel = paneId ? getPaneSelection(paneId).trim() : ''
      if (!sel) {
        setW(null)
        return
      }
      const left = Math.min(Math.max(8, e.clientX), window.innerWidth - 340)
      setW({ x: left, y: e.clientY + 8, text: sel, phase: 'button' })
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node)) return
      setW(null) // starting a new click/selection elsewhere dismisses the widget
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setW(null)
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!w) return null

  const doTranslate = (): void => {
    setW((s) => (s ? { ...s, phase: 'loading' } : s))
    void window.api
      .translateText(w.text, langCode(targetLangName))
      .then((r) =>
        setW((s) => (s ? { ...s, phase: 'result', result: r.text, source: r.sourceLang } : s))
      )
      .catch((e) => setW((s) => (s ? { ...s, phase: 'error', error: (e as Error).message } : s)))
  }

  const copy = (): void => {
    if (!w.result) return
    void navigator.clipboard
      .writeText(w.result)
      .then(() => toast('Copied translation', 'ok'))
      .catch(() => {})
  }

  return (
    <div
      ref={ref}
      className="sel-translate"
      style={{ left: w.x, top: w.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {w.phase === 'button' && (
        <button className="sel-translate-btn" onClick={doTranslate} title={`Translate to ${targetLangName}`}>
          <Languages size={15} />
        </button>
      )}
      {w.phase === 'loading' && (
        <div className="sel-translate-pop">
          <Loader2 size={14} className="spin" /> Translating…
        </div>
      )}
      {w.phase === 'result' && (
        <div className="sel-translate-pop">
          <div className="sel-translate-head">
            <span className="sel-translate-langs">
              {(w.source ?? '?').toUpperCase()} → {targetLangName}
            </span>
            <button className="icon-btn" title="Copy" onClick={copy}>
              <Copy size={12} />
            </button>
            <button className="icon-btn" title="Close" onClick={() => setW(null)}>
              <X size={12} />
            </button>
          </div>
          <div className="sel-translate-text">{w.result}</div>
        </div>
      )}
      {w.phase === 'error' && <div className="sel-translate-pop error">{w.error}</div>}
    </div>
  )
}
