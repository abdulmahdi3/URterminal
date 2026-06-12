/**
 * Generate the bespoke "What's New" preview GIFs — one per feature — with no
 * external tooling (no ffmpeg/ImageMagick): a tiny from-scratch animated GIF89a
 * encoder (palette-indexed + LZW), a flat-color framebuffer, and a 5x7 bitmap
 * font. Each scene mirrors the feature's built-in CSS demo.
 *
 * Run:  node scripts/make-whatsnew-gifs.mjs
 * Out:  src/renderer/src/assets/whatsnew/{crossplatform,diffreview,streamcards,dashboard}.gif
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const PREVIEW = process.argv.includes('--preview')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'renderer', 'src', 'assets', 'whatsnew')

const W = 480
const H = 144

// ── Palette (dark theme). Index 0 is the background. Padded to 16 for the GCT. ──
const PAL = [
  [0x0f, 0x11, 0x15], // 0 bg
  [0x17, 0x1a, 0x21], // 1 panel
  [0x1e, 0x22, 0x2b], // 2 panel2
  [0x2a, 0x2f, 0x3a], // 3 border
  [0xe6, 0xe8, 0xee], // 4 text
  [0x9a, 0xa3, 0xb2], // 5 dim
  [0x5b, 0x8c, 0xff], // 6 accent
  [0x22, 0xc5, 0x5e], // 7 ok (green)
  [0xef, 0x44, 0x44], // 8 red
  [0xff, 0xff, 0xff], // 9 white
  [0x2f, 0x4a, 0x8a], // 10 accent-dim
  [0x14, 0x53, 0x2d], // 11 ok-dim
  [0x3a, 0x2a, 0x2a], // 12 red-dim
  [0x0f, 0x11, 0x15], // 13 pad
  [0x0f, 0x11, 0x15], // 14 pad
  [0x0f, 0x11, 0x15] // 15 pad
]
const C = {
  bg: 0, panel: 1, panel2: 2, border: 3, text: 4, dim: 5,
  accent: 6, ok: 7, red: 8, white: 9, accentDim: 10, okDim: 11, redDim: 12
}

// ── 5x7 bitmap font (uppercase + digits + a few symbols). '#' = ink. ──
// Glyphs authored row-by-row (7 rows of 5 columns).
const FONT2 = {
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  C: [' ####', '#    ', '#    ', '#    ', '#    ', '#    ', ' ####'],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  G: [' ####', '#    ', '#    ', '#  ##', '#   #', '#   #', ' ####'],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  I: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '#####'],
  J: ['    #', '    #', '    #', '    #', '#   #', '#   #', ' ### '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', '#   #', ' # # ', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '## ##', '#   #'],
  X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
  0: [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  1: ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  2: [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  3: ['#####', '   # ', '  ## ', '    #', '    #', '#   #', ' ### '],
  4: ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  5: ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  6: [' ### ', '#    ', '#    ', '#### ', '#   #', '#   #', ' ### '],
  7: ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  8: [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '],
  9: [' ### ', '#   #', '#   #', ' ####', '    #', '    #', ' ### '],
  '.': ['     ', '     ', '     ', '     ', '     ', ' ##  ', ' ##  '],
  '-': ['     ', '     ', '     ', '#####', '     ', '     ', '     '],
  '+': ['     ', '  #  ', '  #  ', '#####', '  #  ', '  #  ', '     '],
  '=': ['     ', '     ', '#####', '     ', '#####', '     ', '     '],
  ':': ['     ', ' ##  ', ' ##  ', '     ', ' ##  ', ' ##  ', '     '],
  '/': ['    #', '    #', '   # ', '  #  ', ' #   ', '#    ', '#    ']
}

// ── Framebuffer (indexed) ──
function frame() {
  return new Uint8Array(W * H).fill(C.bg)
}
function px(buf, x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  buf[y * W + x] = c
}
function rect(buf, x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(buf, x + i, y + j, c)
}
function rectOutline(buf, x, y, w, h, c, t = 1) {
  rect(buf, x, y, w, t, c)
  rect(buf, x, y + h - t, w, t, c)
  rect(buf, x, y, t, h, c)
  rect(buf, x + w - t, y, t, h, c)
}
function disc(buf, cx, cy, r, c) {
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) px(buf, cx + i, cy + j, c)
}
function ring(buf, cx, cy, r, c, t = 1) {
  for (let j = -r; j <= r; j++)
    for (let i = -r; i <= r; i++) {
      const d = i * i + j * j
      if (d <= r * r && d >= (r - t) * (r - t)) px(buf, cx + i, cy + j, c)
    }
}
function line(buf, x0, y0, x1, y1, c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1)
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  for (;;) {
    px(buf, x0, y0, c)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x0 += sx }
    if (e2 < dx) { err += dx; y0 += sy }
  }
}
function glyphW(s) {
  return s * 5
}
function text(buf, x, y, str, c, s = 2) {
  let cx = x
  for (const ch of str.toUpperCase()) {
    const g = FONT2[ch] || FONT2[' ']
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] === '#') rect(buf, cx + col * s, y + row * s, s, s, c)
      }
    }
    cx += 6 * s
  }
  return cx
}
function textW(str, s = 2) {
  return str.length * 6 * s - s
}
function textCenter(buf, cx, y, str, c, s = 2) {
  text(buf, Math.round(cx - textW(str, s) / 2), y, str, c, s)
}

// ── GIF89a animated encoder ──
function lzw(minCode, indices) {
  const clear = 1 << minCode
  const eoi = clear + 1
  let size = minCode + 1
  let next = eoi + 1
  let dict = new Map()
  const out = []
  let bitBuf = 0
  let bitCnt = 0
  const emit = (code) => {
    bitBuf |= code << bitCnt
    bitCnt += size
    while (bitCnt >= 8) {
      out.push(bitBuf & 0xff)
      bitBuf >>>= 8
      bitCnt -= 8
    }
  }
  const reset = () => {
    dict = new Map()
    size = minCode + 1
    next = eoi + 1
  }
  emit(clear)
  let buf = String(indices[0])
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const cand = buf + ',' + k
    if (dict.has(cand)) {
      buf = cand
    } else {
      emit(buf.indexOf(',') < 0 ? Number(buf) : dict.get(buf))
      dict.set(cand, next++)
      if (next === 1 << size) {
        if (size < 12) size++
        else {
          emit(clear)
          reset()
        }
      }
      buf = String(k)
    }
  }
  emit(buf.indexOf(',') < 0 ? Number(buf) : dict.get(buf))
  emit(eoi)
  if (bitCnt > 0) out.push(bitBuf & 0xff)
  return out
}

function encodeGif(frames, delayCs) {
  const bytes = []
  const u8 = (v) => bytes.push(v & 0xff)
  const u16 = (v) => {
    bytes.push(v & 0xff)
    bytes.push((v >> 8) & 0xff)
  }
  const str = (s) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0))
  }
  // Header + Logical Screen Descriptor (global color table, 16 colors → size 3)
  str('GIF89a')
  u16(W)
  u16(H)
  u8(0b10010011) // GCT present, color res 2, GCT size 3 → 2^(3+1)=16
  u8(0) // bg color index
  u8(0) // aspect ratio
  for (const [r, g, b] of PAL) {
    u8(r)
    u8(g)
    u8(b)
  }
  // Netscape looping extension (loop forever)
  u8(0x21)
  u8(0xff)
  u8(0x0b)
  str('NETSCAPE2.0')
  u8(0x03)
  u8(0x01)
  u16(0)
  u8(0x00)
  // Frames
  for (const f of frames) {
    // Graphic Control Extension
    u8(0x21)
    u8(0xf9)
    u8(0x04)
    u8(0b00000100) // disposal = 1 (leave), no transparency
    u16(delayCs)
    u8(0) // transparent index (unused)
    u8(0x00)
    // Image Descriptor
    u8(0x2c)
    u16(0)
    u16(0)
    u16(W)
    u16(H)
    u8(0) // no local color table
    // Image data
    const minCode = 4 // 16-color palette
    u8(minCode)
    const data = lzw(minCode, f)
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255)
      u8(chunk.length)
      for (const b of chunk) u8(b)
    }
    u8(0x00) // block terminator
  }
  u8(0x3b) // trailer
  return Buffer.from(bytes)
}

// ── easing / phase helpers ──
const clamp01 = (v) => Math.max(0, Math.min(1, v))
// progress of phase p within N frames, where phase covers [start,end) of the loop
const seg = (i, N, start, end) => clamp01((i / N - start) / (end - start))

// ── Scenes ──
function sceneCrossplatform(i, N) {
  const buf = frame()
  const tiles = [
    { label: 'WINDOWS' },
    { label: 'MACOS' },
    { label: 'LINUX' }
  ]
  const active = Math.floor((i / N) * 3) % 3
  const tw = 132, th = 96, gap = 18
  const total = tiles.length * tw + (tiles.length - 1) * gap
  let x = Math.round((W - total) / 2)
  const y = Math.round((H - th) / 2)
  tiles.forEach((t, idx) => {
    const on = idx === active
    rect(buf, x, y, tw, th, C.panel2)
    rectOutline(buf, x, y, tw, th, on ? C.accent : C.border, 2)
    // a little "window" glyph
    rect(buf, x + tw / 2 - 16, y + 18, 32, 22, on ? C.accent : C.dim)
    rect(buf, x + tw / 2 - 16, y + 18, 32, 6, on ? C.white : C.border)
    textCenter(buf, x + tw / 2, y + 56, t.label, on ? C.white : C.dim, 2)
    x += tw + gap
  })
  return buf
}

function sceneDiffreview(i, N) {
  const buf = frame()
  const cx = 90, cy = 28, cw = 300, ch = 88
  rect(buf, cx, cy, cw, ch, C.panel2)
  rectOutline(buf, cx, cy, cw, ch, C.border, 1)
  const applied = i / N > 0.5
  // removed line (dims once applied)
  rect(buf, cx + 8, cy + 14, cw - 90, 22, applied ? C.redDim : 0)
  text(buf, cx + 12, cy + 16, '- PORT = 3000', applied ? C.dim : C.red, 2)
  // added line slides in
  const slide = Math.round((1 - seg(i, N, 0.05, 0.35)) * 10)
  rect(buf, cx + 8, cy + 48, cw - 90, 22, 0)
  text(buf, cx + 12 + slide, cy + 50, '+ PORT = 8080', C.ok, 2)
  // applied check pulses in
  if (i / N > 0.45) {
    const pulse = 0.5 + 0.5 * Math.sin((i / N) * Math.PI * 6)
    const r = 16
    const bx = cx + cw - 40
    const by = cy + ch / 2
    disc(buf, bx, by, r, C.ok)
    // checkmark
    const col = pulse > 0.4 ? C.white : C.okDim
    for (let k = 0; k < 6; k++) px(buf, bx - 6 + k, by + k - 2, col), px(buf, bx - 6 + k, by + k - 1, col)
    for (let k = 0; k < 9; k++) px(buf, bx + k - 1, by + 4 - k, col), px(buf, bx + k - 1, by + 5 - k, col)
  }
  return buf
}

function sceneStreamcards(i, N) {
  const buf = frame()
  const x = 60, w = 360
  const cards = [
    { y: 14, h: 30, draw: (b, yy) => { rect(b, x, yy, w, 30, C.panel); rectOutline(b, x, yy, w, 30, C.border, 1); disc(b, x + 16, yy + 15, 5, C.accent); text(b, x + 30, yy + 8, 'RUNNING TESTS', C.text, 2) } },
    { y: 54, h: 30, draw: (b, yy) => { rect(b, x, yy, w, 30, C.panel); rectOutline(b, x, yy, w, 30, C.border, 1); text(b, x + 12, yy + 8, 'BASH', C.accent, 2); text(b, x + 12 + textW('BASH', 2) + 16, yy + 8, 'NPM TEST', C.dim, 2) } },
    { y: 96, h: 28, draw: (b, yy) => { rect(b, x, yy, 168, 28, C.okDim); disc(b, x + 16, yy + 14, 5, C.ok); text(b, x + 28, yy + 7, 'DONE  4.2S', C.ok, 2) } }
  ]
  const starts = [0.0, 0.3, 0.62]
  cards.forEach((c, idx) => {
    const p = seg(i, N, starts[idx], starts[idx] + 0.18)
    if (p <= 0) return
    const off = Math.round((1 - p) * 8)
    c.draw(buf, c.y + off)
  })
  return buf
}

function sceneDashboard(i, N) {
  const buf = frame()
  const dx = 150, dy = 12, dw = 180, dh = 120
  rect(buf, dx, dy, dw, dh, C.panel2)
  rectOutline(buf, dx, dy, dw, dh, C.border, 1)
  // top bar
  rect(buf, dx, dy, dw, 24, C.panel)
  rect(buf, dx, dy + 24, dw, 1, C.border)
  const pulse = 0.5 + 0.5 * Math.sin((i / N) * Math.PI * 4)
  disc(buf, dx + 14, dy + 12, 5, C.ok)
  if (pulse > 0.5) disc(buf, dx + 14, dy + 12, 7, C.ok)
  text(buf, dx + 28, dy + 9, '127.0.0.1', C.dim, 1)
  // rows
  const r1 = dy + 40
  rect(buf, dx + 10, r1, 8, 8, 0)
  disc(buf, dx + 16, r1 + 6, 5, C.accent)
  text(buf, dx + 30, r1, 'CLAUDE', C.text, 2)
  // streaming bar (marching dashes)
  const barX = dx + 30 + textW('CLAUDE', 2) + 10
  const barW = dx + dw - 12 - barX
  const phase = Math.floor((i / N) * 16) % 16
  for (let k = 0; k < barW; k++) {
    if ((k + phase) % 16 < 6) px(buf, barX + k, r1 + 6, C.accent), px(buf, barX + k, r1 + 7, C.accent)
  }
  const r2 = dy + 72
  disc(buf, dx + 16, r2 + 6, 5, C.dim)
  text(buf, dx + 30, r2, 'SHELL', C.dim, 2)
  return buf
}

// BridgeMemory — a living knowledge graph: central hub + linked notes, nodes
// lighting green in turn (the "context compounds" look).
function sceneBridgememory(i, N) {
  const buf = frame()
  const cx = 240, cy = 72
  const nodes = [
    { x: 116, y: 36, label: 'AUTH' },
    { x: 360, y: 34, label: 'STRIPE' },
    { x: 92, y: 110, label: 'CSRF' },
    { x: 388, y: 106, label: 'SHIP' },
    { x: 214, y: 124, label: '' },
    { x: 300, y: 22, label: '' }
  ]
  // edges
  for (const n of nodes) line(buf, cx, cy, n.x, n.y, C.border)
  // glow + hub
  const pulse = 0.5 + 0.5 * Math.sin((i / N) * Math.PI * 4)
  disc(buf, cx, cy, Math.round(16 + pulse * 6), C.okDim)
  disc(buf, cx, cy, 10, C.ok)
  disc(buf, cx, cy, 6, C.white)
  // nodes — one lights green in turn
  const active = Math.floor((i / N) * nodes.length) % nodes.length
  nodes.forEach((n, idx) => {
    const on = idx === active
    disc(buf, n.x, n.y, 6, on ? C.ok : C.dim)
    if (on) ring(buf, n.x, n.y, 10, C.ok, 2)
    if (n.label) textCenter(buf, n.x, n.y + 10, n.label, on ? C.text : C.dim, 1)
  })
  return buf
}

// BridgeMemory graph view — the graph assembles, each new note + link snapping
// into place (accent), the hub holding the center.
function sceneBridgegraph(i, N) {
  const buf = frame()
  const cx = 240, cy = 72
  const nodes = [
    { x: 120, y: 40 },
    { x: 358, y: 38 },
    { x: 100, y: 110 },
    { x: 380, y: 108 },
    { x: 240, y: 126 },
    { x: 300, y: 20 }
  ]
  const revealed = 2 + Math.floor((i / N) * (nodes.length - 1)) // grows 2 → 6, loops
  for (let idx = 0; idx < revealed && idx < nodes.length; idx++) {
    const n = nodes[idx]
    line(buf, cx, cy, n.x, n.y, idx === revealed - 1 ? C.accent : C.border)
  }
  disc(buf, cx, cy, 15, C.okDim)
  disc(buf, cx, cy, 9, C.ok)
  disc(buf, cx, cy, 5, C.white)
  for (let idx = 0; idx < revealed && idx < nodes.length; idx++) {
    const n = nodes[idx]
    const fresh = idx === revealed - 1
    disc(buf, n.x, n.y, 6, fresh ? C.accent : C.dim)
    if (fresh) ring(buf, n.x, n.y, 10, C.accent, 2)
  }
  return buf
}

// BridgeMemory MCP — several agents reading + writing the SAME hub, with data
// pulses flowing along each connection.
function sceneBridgemcp(i, N) {
  const buf = frame()
  const cx = 240, cy = 70
  const agents = [
    { x: 92, y: 44, label: 'CLAUDE', dir: 1 },
    { x: 388, y: 44, label: 'CODEX', dir: -1 },
    { x: 240, y: 124, label: 'JARVIS', dir: 1 }
  ]
  for (const ag of agents) line(buf, cx, cy, ag.x, ag.y, C.border)
  // hub
  disc(buf, cx, cy, 14, C.okDim)
  disc(buf, cx, cy, 9, C.ok)
  disc(buf, cx, cy, 5, C.white)
  // agents + flowing pulse
  agents.forEach((ag, idx) => {
    // agent node
    rect(buf, ag.x - 26, ag.y - 9, 52, 18, C.panel)
    rectOutline(buf, ag.x - 26, ag.y - 9, 52, 18, C.border, 1)
    textCenter(buf, ag.x, ag.y - 4, ag.label, C.text, 1)
    // pulse travelling along the line
    let t = ((i / N) * 1.3 + idx * 0.33) % 1
    if (ag.dir < 0) t = 1 - t
    const dotx = cx + (ag.x - cx) * t
    const doty = cy + (ag.y - cy) * t
    disc(buf, Math.round(dotx), Math.round(doty), 3, C.accent)
  })
  return buf
}

// Rooms — three focused workspace cards (Command / Swarm / Review) lighting up.
function sceneRooms(i, N) {
  const buf = frame()
  const cards = [
    { label: 'COMMAND', dot: C.accent },
    { label: 'SWARM', dot: C.ok },
    { label: 'REVIEW', dot: C.white }
  ]
  const tw = 146, th = 110, gap = 14
  const total = cards.length * tw + (cards.length - 1) * gap
  let x = Math.round((W - total) / 2)
  const y = Math.round((H - th) / 2)
  const active = Math.floor((i / N) * cards.length) % cards.length
  cards.forEach((c, idx) => {
    const on = idx === active
    rect(buf, x, y, tw, th, C.panel2)
    rectOutline(buf, x, y, tw, th, on ? C.accent : C.border, 2)
    textCenter(buf, x + tw / 2, y + 12, c.label, on ? C.white : C.dim, 1)
    // three "role" rows inside
    for (let r = 0; r < 3; r++) {
      const ry = y + 38 + r * 18
      disc(buf, x + 18, ry + 4, 4, on ? c.dot : C.dim)
      rect(buf, x + 30, ry + 2, tw - 48, 5, on ? C.border : C.bg)
      rect(buf, x + 30, ry + 2, on ? tw - 70 : tw - 90, 5, on ? C.accentDim : C.border)
    }
    x += tw + gap
  })
  return buf
}

// Task board — three kanban columns; a task card travels Backlog → In progress
// (Task → Workspace), turning accent as it lands.
function sceneTaskboard(i, N) {
  const buf = frame()
  const cols = [{ label: 'BACKLOG' }, { label: 'DOING' }, { label: 'DONE' }]
  const cw = 146, gap = 12, colH = 116
  const total = cols.length * cw + (cols.length - 1) * gap
  const x0 = Math.round((W - total) / 2)
  const y = 14
  const colX = cols.map((_, idx) => x0 + idx * (cw + gap))
  cols.forEach((c, idx) => {
    rect(buf, colX[idx], y, cw, colH, C.panel)
    rectOutline(buf, colX[idx], y, cw, colH, C.border, 1)
    textCenter(buf, colX[idx] + cw / 2, y + 8, c.label, C.dim, 1)
    rect(buf, colX[idx], y + 22, cw, 1, C.border)
  })
  // static cards
  const cardW = cw - 20
  const drawCard = (cx, cy, accent) => {
    rect(buf, cx, cy, cardW, 20, C.panel2)
    rectOutline(buf, cx, cy, cardW, 20, accent ? C.accent : C.border, accent ? 2 : 1)
    rect(buf, cx + 8, cy + 7, cardW - 40, 5, accent ? C.accentDim : C.border)
  }
  drawCard(colX[0] + 10, y + 64, false) // a resting backlog card
  drawCard(colX[1] + 10, y + 30, false) // an in-progress card
  drawCard(colX[2] + 10, y + 30, false) // a done card
  // travelling card: backlog top slot → doing second slot
  const t = i / N
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  const sx = colX[0] + 10, sy = y + 30
  const ex = colX[1] + 10, ey = y + 60
  drawCard(Math.round(sx + (ex - sx) * ease), Math.round(sy + (ey - sy) * ease), true)
  return buf
}

// Build timeline — the loop moving through its four stages, the progress filling
// left to right (Vibe → Room → Crew → Ship).
function sceneBuildmove(i, N) {
  const buf = frame()
  const stages = ['VIBE', 'ROOM', 'CREW', 'SHIP']
  const y = 64
  const xs = stages.map((_, idx) => 60 + idx * ((W - 120) / (stages.length - 1)))
  const reached = Math.floor((i / N) * stages.length) % stages.length
  // base + filled connector line
  line(buf, xs[0], y, xs[stages.length - 1], y, C.border)
  if (reached > 0) {
    for (let s = 0; s < reached; s++) {
      const col = C.ok
      // thick filled segment
      for (let yy = -1; yy <= 1; yy++) line(buf, xs[s], y + yy, xs[s + 1], y + yy, col)
    }
  }
  stages.forEach((label, idx) => {
    const done = idx < reached
    const active = idx === reached
    const col = done ? C.ok : active ? C.accent : C.dim
    if (active) {
      const pulse = 0.5 + 0.5 * Math.sin((i / N) * Math.PI * 8)
      disc(buf, Math.round(xs[idx]), y, Math.round(9 + pulse * 4), C.accentDim)
    }
    disc(buf, Math.round(xs[idx]), y, 8, col)
    if (done) disc(buf, Math.round(xs[idx]), y, 4, C.white)
    textCenter(buf, Math.round(xs[idx]), y + 18, label, done || active ? C.text : C.dim, 1)
  })
  return buf
}

const SCENES = {
  crossplatform: sceneCrossplatform,
  diffreview: sceneDiffreview,
  streamcards: sceneStreamcards,
  dashboard: sceneDashboard,
  bridgememory: sceneBridgememory,
  bridgegraph: sceneBridgegraph,
  bridgemcp: sceneBridgemcp,
  rooms: sceneRooms,
  taskboard: sceneTaskboard,
  buildmove: sceneBuildmove
}

// Optional PNG preview (frame snapshot) + a single-frame GIF, for visual review.
function writePreview(name, buf) {
  const require = createRequire(import.meta.url)
  const { PNG } = require('pngjs')
  const dir = join(ROOT, '.tmp-gifpreview')
  mkdirSync(dir, { recursive: true })
  const png = new PNG({ width: W, height: H })
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = PAL[buf[i]]
    png.data[i * 4] = r
    png.data[i * 4 + 1] = g
    png.data[i * 4 + 2] = b
    png.data[i * 4 + 3] = 255
  }
  writeFileSync(join(dir, name + '.png'), PNG.sync.write(png))
  writeFileSync(join(dir, name + '-1frame.gif'), encodeGif([buf], 100))
}

function build() {
  mkdirSync(OUT, { recursive: true })
  const N = 24
  for (const [name, fn] of Object.entries(SCENES)) {
    const frames = []
    for (let i = 0; i < N; i++) frames.push(fn(i, N))
    const gif = encodeGif(frames, 7) // 70ms/frame
    const path = join(OUT, name + '.gif')
    writeFileSync(path, gif)
    console.log(`[whatsnew-gif] wrote ${path} (${gif.length} bytes)`)
    if (PREVIEW) writePreview(name, frames[Math.floor(N * 0.7)])
  }
}

build()
