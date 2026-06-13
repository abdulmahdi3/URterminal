import { useRef, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { LAYOUT_PRESETS, type LayoutPreset } from '@renderer/lib/layoutPresets'

function LayoutTile({ preset, onClick }: { preset: LayoutPreset; onClick: () => void }): JSX.Element {
  return (
    <button className="lp-tile" title={preset.label} onClick={onClick}>
      <div className="lp-grid">
        {preset.tiles.map((tile, i) => (
          <div
            key={i}
            className="lp-pane"
            style={{
              left: `${tile.l}%`,
              top: `${tile.t}%`,
              width: `${tile.w}%`,
              height: `${tile.h}%`
            }}
          />
        ))}
      </div>
      <span className="lp-label">{preset.label}</span>
    </button>
  )
}

/**
 * Pane-layout preset picker. Lives at the right of the title bar (beside the
 * window controls); its popup opens downward. Hover to reveal, click a tile to
 * apply. The count chip shows how many panes are open in the active workspace.
 */
export default function LayoutPicker(): JSX.Element {
  const paneCount = useWorkspace((s) => Object.keys(s.panes).length)
  const applyLayoutPreset = useWorkspace((s) => s.applyLayoutPreset)
  const [open, setOpen] = useState(false)
  const closeRef = useRef<number>(0)

  const openNow = (): void => {
    window.clearTimeout(closeRef.current)
    setOpen(true)
  }
  const closeSoon = (): void => {
    closeRef.current = window.setTimeout(() => setOpen(false), 180)
  }

  return (
    <div
      className={clsx('tb-layout-wrap', open && 'open')}
      data-nodrag
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
    >
      <button className="icon-btn tb-layout-btn" title="Pane layout">
        <LayoutGrid size={14} />
        <span className="tb-layout-count">{paneCount}</span>
      </button>
      <div className="tb-layout-popup" onMouseEnter={openNow} onMouseLeave={closeSoon}>
        <div className="tb-layout-grid">
          {LAYOUT_PRESETS.map((preset) => (
            <LayoutTile
              key={preset.id}
              preset={preset}
              onClick={() => {
                applyLayoutPreset(preset.id)
                setOpen(false)
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
