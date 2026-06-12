import { useMemo } from 'react'
import { buildGraph, forceLayout, type BridgeNote } from '@shared/bridge'

const VW = 800
const VH = 440

/**
 * Force-directed view of the BridgeMemory hub: notes are nodes, `[[wikilinks]]`
 * are edges, and the most-connected note glows at the center. Click a node to
 * open it. Layout is deterministic (see forceLayout), so the graph is stable.
 */
export default function BridgeGraph({
  notes,
  selected,
  onSelect
}: {
  notes: BridgeNote[]
  selected: string | null
  onSelect: (slug: string) => void
}): JSX.Element {
  const { graph, pos, maxDeg } = useMemo(() => {
    const graph = buildGraph(notes)
    const pos = forceLayout(graph, { width: VW, height: VH })
    const maxDeg = Math.max(1, ...graph.nodes.map((n) => n.degree))
    return { graph, pos, maxDeg }
  }, [notes])

  if (!notes.length) return <div className="bridge-hint bridge-pick">No notes to graph yet — create one first.</div>

  return (
    <div className="bridge-graph">
      <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet">
        {graph.edges.map((e, i) => {
          const a = pos.get(e.source)
          const b = pos.get(e.target)
          if (!a || !b) return null
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="bg-edge" />
        })}
        {graph.nodes.map((n) => {
          const p = pos.get(n.slug)
          if (!p) return null
          const r = 6 + Math.round((n.degree / maxDeg) * 8)
          const hub = n.degree === maxDeg && maxDeg > 1
          const cls = n.ghost ? 'ghost' : n.slug === selected ? 'sel' : hub ? 'hub' : ''
          return (
            <g
              key={n.slug}
              className={`bg-node ${cls}`}
              transform={`translate(${p.x},${p.y})`}
              onClick={() => !n.ghost && onSelect(n.slug)}
            >
              {hub && <circle r={r + 12} className="bg-glow" />}
              <circle r={r} className="bg-dot" />
              <text y={r + 14} textAnchor="middle" className="bg-label">
                {n.title.length > 18 ? n.title.slice(0, 17) + '…' : n.title}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
