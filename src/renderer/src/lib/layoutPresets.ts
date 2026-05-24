import type { MosaicNode } from 'react-mosaic-component'

export interface PaneTile { l: number; t: number; w: number; h: number }

export interface LayoutPreset {
  id: string
  label: string
  paneCount: number
  tiles: PaneTile[]
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'single', label: 'Single', paneCount: 1,
    tiles: [{ l: 0, t: 0, w: 100, h: 100 }]
  },
  {
    id: '2h', label: '2 Cols', paneCount: 2,
    tiles: [{ l: 0, t: 0, w: 48, h: 100 }, { l: 52, t: 0, w: 48, h: 100 }]
  },
  {
    id: '2v', label: '2 Rows', paneCount: 2,
    tiles: [{ l: 0, t: 0, w: 100, h: 48 }, { l: 0, t: 52, w: 100, h: 48 }]
  },
  {
    id: '3l', label: 'Main+2', paneCount: 3,
    tiles: [
      { l: 0, t: 0, w: 56, h: 100 },
      { l: 58, t: 0, w: 42, h: 48 },
      { l: 58, t: 52, w: 42, h: 48 }
    ]
  },
  {
    id: '3r', label: '2+Main', paneCount: 3,
    tiles: [
      { l: 0, t: 0, w: 42, h: 48 },
      { l: 0, t: 52, w: 42, h: 48 },
      { l: 44, t: 0, w: 56, h: 100 }
    ]
  },
  {
    id: '3h', label: '3 Cols', paneCount: 3,
    tiles: [
      { l: 0, t: 0, w: 32, h: 100 },
      { l: 34, t: 0, w: 32, h: 100 },
      { l: 68, t: 0, w: 32, h: 100 }
    ]
  },
  {
    id: '4grid', label: '2×2', paneCount: 4,
    tiles: [
      { l: 0, t: 0, w: 48, h: 48 }, { l: 52, t: 0, w: 48, h: 48 },
      { l: 0, t: 52, w: 48, h: 48 }, { l: 52, t: 52, w: 48, h: 48 }
    ]
  },
  {
    id: '3-center', label: 'Center', paneCount: 3,
    tiles: [
      { l: 0, t: 0, w: 20, h: 100 },
      { l: 22, t: 0, w: 56, h: 100 },
      { l: 80, t: 0, w: 20, h: 100 }
    ]
  },
  {
    id: '4-top', label: '3+Bot', paneCount: 4,
    tiles: [
      { l: 0, t: 0, w: 32, h: 60 }, { l: 34, t: 0, w: 32, h: 60 }, { l: 68, t: 0, w: 32, h: 60 },
      { l: 0, t: 62, w: 100, h: 38 }
    ]
  },
  {
    id: '4-bot', label: 'Top+3', paneCount: 4,
    tiles: [
      { l: 0, t: 0, w: 100, h: 38 },
      { l: 0, t: 40, w: 32, h: 60 }, { l: 34, t: 40, w: 32, h: 60 }, { l: 68, t: 40, w: 32, h: 60 }
    ]
  },
  {
    id: '9grid', label: '3×3', paneCount: 9,
    tiles: [
      { l: 0, t: 0, w: 32, h: 32 }, { l: 34, t: 0, w: 32, h: 32 }, { l: 68, t: 0, w: 32, h: 32 },
      { l: 0, t: 34, w: 32, h: 32 }, { l: 34, t: 34, w: 32, h: 32 }, { l: 68, t: 34, w: 32, h: 32 },
      { l: 0, t: 68, w: 32, h: 32 }, { l: 34, t: 68, w: 32, h: 32 }, { l: 68, t: 68, w: 32, h: 32 }
    ]
  }
]

export const PRESET_PANE_COUNT: Record<string, number> =
  Object.fromEntries(LAYOUT_PRESETS.map((p) => [p.id, p.paneCount]))

/**
 * Automatic layout for 1–9 panes following the progression:
 * 1 → full  2 → side-by-side  3 → 3 cols  4 → 2×2
 * 5 → 2×2 + right col  6 → 2×3  7 → 2×3 + bottom  8 → 2×3 + 2-pane bottom  9 → 3×3
 * More than 9 falls back to splitting the rightmost pane.
 */
export function buildAutoLayout(ids: string[]): MosaicNode<string> {
  const [a, b, c, d, e, f, g, h, i] = ids
  const row = (l: MosaicNode<string>, r: MosaicNode<string>, sp = 50): MosaicNode<string> => ({
    direction: 'row', first: l, second: r, splitPercentage: sp
  })
  const col = (t: MosaicNode<string>, bt: MosaicNode<string>, sp = 50): MosaicNode<string> => ({
    direction: 'column', first: t, second: bt, splitPercentage: sp
  })

  switch (ids.length) {
    case 1: return a
    case 2: return row(a, b)
    case 3: return row(a, row(b, c), 33)
    case 4: return col(row(a, b), row(c, d))
    case 5: return row(col(row(a, b), row(c, d)), e, 67)
    case 6: return row(col(row(a, b), row(c, d)), col(e, f), 67)
    case 7: return col(row(col(row(a, b), row(c, d)), col(e, f), 67), g, 67)
    case 8: return col(row(col(row(a, b), row(c, d)), col(e, f), 67), row(g, h), 67)
    case 9: return col(row(a, row(b, c), 33), col(row(d, row(e, f), 33), row(g, row(h, i), 33)), 33)
    default: {
      // >9: just split rightmost pane in a row
      let acc: MosaicNode<string> = a
      for (let idx = 1; idx < ids.length; idx++) {
        acc = row(acc, ids[idx], Math.round(100 * idx / (idx + 1)))
      }
      return acc
    }
  }
}

export function buildPresetLayout(presetId: string, ids: string[]): MosaicNode<string> {
  const [a, b, c, d, e, f, g, h, i] = ids
  const row = (l: MosaicNode<string>, r: MosaicNode<string>, sp = 50): MosaicNode<string> => ({
    direction: 'row', first: l, second: r, splitPercentage: sp
  })
  const col = (t: MosaicNode<string>, bt: MosaicNode<string>, sp = 50): MosaicNode<string> => ({
    direction: 'column', first: t, second: bt, splitPercentage: sp
  })

  switch (presetId) {
    case 'single':    return a
    case '2h':        return row(a, b)
    case '2v':        return col(a, b)
    case '3l':        return row(a, col(b, c), 55)
    case '3r':        return row(col(a, b), c, 45)
    case '3h':        return row(a, row(b, c), 33)
    case '4grid':     return row(col(a, c), col(b, d))
    case '3-center':  return row(a, row(b, c, 75), 20)
    case '4-top':     return col(row(a, row(b, c), 33), d, 67)
    case '4-bot':     return col(a, row(b, row(c, d), 33), 38)
    case '9grid':     return row(
      col(a, col(d, g), 33),
      row(col(b, col(e, h), 33), col(c, col(f, i), 33)),
      33
    )
    default:          return a
  }
}
