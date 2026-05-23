import { useCallback, useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'
import { getLeaves } from '@renderer/lib/mosaicTree'

interface Conn {
  source: string
  x: number
  y: number
  angle: number
  index: number
  active: boolean
}

/**
 * Renders a small numbered arrow on the border between each pair of adjacent
 * panes. Clicking it toggles whether the left/upper pane pipes its output into
 * the next pane. Active links glow green; inactive ones are dim until hovered.
 */
export default function ChainOverlay(): JSX.Element | null {
  const layout = useWorkspace((s) => s.layout)
  const panes = useWorkspace((s) => s.panes)
  const togglePipe = useWorkspace((s) => s.togglePipe)
  const zoomed = useUi((s) => s.zoomedPaneId)
  const [conns, setConns] = useState<Conn[]>([])

  const recompute = useCallback(() => {
    const host = document.querySelector('.workspace-root') as HTMLElement | null
    if (!host || zoomed) {
      setConns([])
      return
    }
    const hostRect = host.getBoundingClientRect()
    const leaves = getLeaves(layout)
    const out: Conn[] = []
    for (let i = 0; i < leaves.length - 1; i++) {
      const a = document.querySelector(`[data-pane-id="${leaves[i]}"]`)
      const b = document.querySelector(`[data-pane-id="${leaves[i + 1]}"]`)
      if (!a || !b) continue
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const dx = rb.left + rb.width / 2 - (ra.left + ra.width / 2)
      const dy = rb.top + rb.height / 2 - (ra.top + ra.height / 2)
      const horizontal = Math.abs(dx) >= Math.abs(dy)
      // Place the arrow at the center of the border the two panes actually share.
      let px: number
      let py: number
      if (horizontal) {
        px = dx >= 0 ? (ra.right + rb.left) / 2 : (rb.right + ra.left) / 2
        py = (Math.max(ra.top, rb.top) + Math.min(ra.bottom, rb.bottom)) / 2
      } else {
        py = dy >= 0 ? (ra.bottom + rb.top) / 2 : (rb.bottom + ra.top) / 2
        px = (Math.max(ra.left, rb.left) + Math.min(ra.right, rb.right)) / 2
      }
      const angle = horizontal ? (dx >= 0 ? 0 : 180) : dy >= 0 ? 90 : 270
      out.push({
        source: leaves[i],
        x: px - hostRect.left,
        y: py - hostRect.top,
        angle,
        index: i + 1,
        active: !!panes[leaves[i]]?.pipeForward
      })
    }
    setConns(out)
  }, [layout, panes, zoomed])

  // Recompute after the DOM settles, and on resize / split-drag / layout change.
  useEffect(() => {
    const raf = requestAnimationFrame(recompute)
    const onResize = (): void => recompute()
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(() => recompute())
    const host = document.querySelector('.workspace-root')
    if (host) ro.observe(host)
    document.querySelectorAll('[data-pane-id]').forEach((el) => ro.observe(el))
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      ro.disconnect()
    }
  }, [recompute])

  if (zoomed || conns.length === 0) return null

  return (
    <div className="chain-overlay">
      {conns.map((c) => (
        <button
          key={c.source}
          className={clsx('chain-arrow', c.active && 'active')}
          style={{ left: c.x, top: c.y }}
          title={
            c.active
              ? `Link ${c.index}: piping output → next pane (click to turn off)`
              : `Link ${c.index}: click to pipe this pane's output → next pane`
          }
          onClick={() => togglePipe(c.source)}
        >
          <ArrowRight size={13} className="chain-arrow-icon" style={{ transform: `rotate(${c.angle}deg)` }} />
          <span className="chain-arrow-num">{c.index}</span>
        </button>
      ))}
    </div>
  )
}
