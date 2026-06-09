import { useEffect, useState } from 'react'
import {
  getPromptMap,
  scrollPaneToPrompt,
  onTerminalInput,
  type PromptMark
} from '@renderer/lib/terminalPool'

interface MapState {
  marks: PromptMark[]
  viewportY: number
}

/**
 * A slim gutter down the right edge of an agent pane with one tick per prompt the
 * user has submitted this session. Hovering expands it into a list of the prompt
 * texts; clicking a tick/row scrolls the terminal to that prompt. The tick whose
 * marker is nearest the current viewport is highlighted.
 */
export default function PromptMinimap({ paneId }: { paneId: string }): JSX.Element | null {
  const [state, setState] = useState<MapState | null>(null)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    const refresh = (): void => {
      const m = getPromptMap(paneId)
      setState(m ? { marks: m.marks, viewportY: m.viewportY } : null)
    }
    refresh()
    // Refresh when this pane gets input (a new prompt may have landed) and on a
    // slow tick so the active highlight follows scrolling without a scroll hook.
    const off = onTerminalInput((id) => {
      if (id === paneId) refresh()
    })
    const t = window.setInterval(refresh, 800)
    return () => {
      off()
      window.clearInterval(t)
    }
  }, [paneId])

  if (!state || state.marks.length === 0) return null
  const { marks, viewportY } = state

  // Active = the prompt marker closest to the top of the current viewport.
  let activeIdx = -1
  let best = Infinity
  marks.forEach((m, i) => {
    const d = Math.abs(m.line - viewportY)
    if (d < best) {
      best = d
      activeIdx = i
    }
  })

  return (
    <div
      className={'prompt-minimap' + (hover ? ' expanded' : '')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="Prompt history"
    >
      <div className="pm-inner">
        {marks.map((m, i) => (
          <button
            key={i}
            className={'pm-item' + (i === activeIdx ? ' active' : '')}
            dir="auto"
            title={m.text}
            onClick={() => scrollPaneToPrompt(paneId, m.line)}
          >
            {hover ? <span className="pm-text">{m.text}</span> : <span className="pm-tick" />}
          </button>
        ))}
      </div>
    </div>
  )
}
