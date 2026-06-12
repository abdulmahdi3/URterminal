import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Languages, Copy, X, Loader2, ListPlus, Columns2, Wand2, ArrowRightToLine, FileDiff } from 'lucide-react'
import { getPaneSelection } from '@renderer/lib/terminalPool'
import { useSettings } from '@renderer/store/settings'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'
import { useDiffReview } from '@renderer/store/diffReview'
import { parsePatches } from '@shared/diff'
import { langCode } from '@renderer/lib/translate'
import { toast } from '@renderer/store/toasts'
import { createTaskFromSelection, openTextInNewAgentPane } from '@renderer/lib/selectionActions'

/** which action produced the current loading/result/error view */
type Mode = 'translate' | 'enhance'

interface WidgetState {
  x: number
  y: number
  text: string
  paneId: string
  phase: 'actions' | 'loading' | 'result' | 'error'
  mode?: Mode
  result?: string
  source?: string
  error?: string
}

/** Resolve which pane a mouseup belongs to. Prefer the pane element under the
 *  pointer; with the canvas/webgl renderer the mouseup target can be an overlay
 *  layer that isn't under [data-pane-id], so fall back to the active pane when
 *  the release still landed inside the workspace area. */
function paneIdForEvent(target: HTMLElement | null): string | null {
  const host = target?.closest?.('[data-pane-id]') as HTMLElement | null
  const id = host?.getAttribute('data-pane-id')
  if (id) return id
  if (target?.closest?.('.pane-capture, .agent-pane, .xterm, main')) {
    return useWorkspace.getState().activePaneId
  }
  return null
}

/**
 * Google-Translate-extension-style floating action: after you select text in a
 * terminal pane, a small toolbar appears near where you released the mouse.
 *
 * - One word selected → just the Translate button.
 * - A phrase selected → a row of actions: Translate, Create task, Move to a new
 *   agent pane, and Enhance (rewrite the selection into a prompt you can copy or
 *   open in a fresh agent pane).
 */
export default function SelectionTranslate(): JSX.Element | null {
  const [w, setW] = useState<WidgetState | null>(null)
  const targetLangName = useSettings((s) => s.settings?.prefs.defaultLanguage) || 'English'
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onUp = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node)) return // clicks inside the widget
      const paneId = paneIdForEvent(e.target as HTMLElement | null)
      const sel = paneId ? getPaneSelection(paneId).trim() : ''
      if (!sel || !paneId) {
        setW(null)
        return
      }
      const left = Math.min(Math.max(8, e.clientX), window.innerWidth - 340)
      setW({ x: left, y: e.clientY + 8, text: sel, paneId, phase: 'actions' })
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
    setW((s) => (s ? { ...s, phase: 'loading', mode: 'translate' } : s))
    void window.api
      .translateText(w.text, langCode(targetLangName))
      .then((r) =>
        setW((s) =>
          s ? { ...s, phase: 'result', mode: 'translate', result: r.text, source: r.sourceLang } : s
        )
      )
      .catch((e) =>
        setW((s) => (s ? { ...s, phase: 'error', mode: 'translate', error: (e as Error).message } : s))
      )
  }

  const doEnhance = (): void => {
    const cwd = useWorkspace.getState().panes[w.paneId]?.agent?.cwd
    setW((s) => (s ? { ...s, phase: 'loading', mode: 'enhance' } : s))
    void window.api.learning
      .enhance(w.text, cwd)
      .then((r) =>
        setW((s) => (s ? { ...s, phase: 'result', mode: 'enhance', result: r.trim() } : s))
      )
      .catch((e) =>
        setW((s) => (s ? { ...s, phase: 'error', mode: 'enhance', error: (e as Error).message } : s))
      )
  }

  const doCreateTask = (): void => {
    createTaskFromSelection(w.paneId, w.text)
    setW(null)
  }

  // Only offered when the selection actually contains a unified diff.
  const diffPatches = parsePatches(w.text)
  const doReviewDiff = (): void => {
    if (!diffPatches.length) return
    const pane = useWorkspace.getState().panes[w.paneId]
    const cwd = pane?.agent?.cwd || pane?.shell?.cwd || ''
    useDiffReview.getState().open(diffPatches, cwd)
    useUi.getState().setShowDiffReview(true)
    setW(null)
  }

  const doMoveToNewPane = (): void => {
    openTextInNewAgentPane(w.paneId, w.text)
    setW(null)
  }

  const openResultInNewPane = (): void => {
    if (!w.result) return
    openTextInNewAgentPane(w.paneId, w.result)
    setW(null)
  }

  const copy = (): void => {
    if (!w.result) return
    void navigator.clipboard
      .writeText(w.result)
      .then(() => toast(w.mode === 'enhance' ? 'Copied prompt' : 'Copied translation', 'ok'))
      .catch(() => {})
  }

  return createPortal(
    <div
      ref={ref}
      className="sel-translate"
      style={{ left: w.x, top: w.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {w.phase === 'actions' && (
        <div className="sel-translate-row">
          <button
            className="sel-translate-btn"
            onClick={doTranslate}
            title={`Translate to ${targetLangName}`}
          >
            <Languages size={15} />
          </button>
          <button className="sel-translate-btn" onClick={doCreateTask} title="Create task in notes">
            <ListPlus size={15} />
          </button>
          <button
            className="sel-translate-btn"
            onClick={doMoveToNewPane}
            title="Move to a new agent pane"
          >
            <Columns2 size={15} />
          </button>
          <button className="sel-translate-btn" onClick={doEnhance} title="Enhance into a prompt">
            <Wand2 size={15} />
          </button>
          {diffPatches.length > 0 && (
            <button
              className="sel-translate-btn"
              onClick={doReviewDiff}
              title={`Review & apply ${diffPatches.length} file change${diffPatches.length === 1 ? '' : 's'}`}
            >
              <FileDiff size={15} />
            </button>
          )}
        </div>
      )}
      {w.phase === 'loading' && (
        <div className="sel-translate-pop">
          <Loader2 size={14} className="spin" /> {w.mode === 'enhance' ? 'Enhancing…' : 'Translating…'}
        </div>
      )}
      {w.phase === 'result' && (
        <div className="sel-translate-pop">
          <div className="sel-translate-head">
            <span className="sel-translate-langs">
              {w.mode === 'enhance'
                ? 'Enhanced prompt'
                : `${(w.source ?? '?').toUpperCase()} → ${targetLangName}`}
            </span>
            {w.mode === 'enhance' && (
              <button className="icon-btn" title="Open in a new agent pane" onClick={openResultInNewPane}>
                <ArrowRightToLine size={12} />
              </button>
            )}
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
    </div>,
    document.body
  )
}
