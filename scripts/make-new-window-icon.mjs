// One-off generator: draw a "new window" glyph and write it as a multi-size
// .ico used for the Windows jump-list "New Window" task. The glyph is a white
// window card with a blue "+" badge in the bottom-right corner — reads clearly
// as "open a new window" even at 16px. Run: node scripts/make-new-window-icon.mjs
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { PNG } from 'pngjs'

// Palette (matches the app: near-white surface, blue accent from --accent).
const SURFACE = [231, 236, 243] // #e7ecf3 window body
const BAR = [150, 160, 178] // #96a0b2 title bar strip
const ACCENT = [76, 141, 255] // #4c8dff badge
const WHITE = [255, 255, 255]

/** Render the glyph at resolution S into a premultiplied-friendly RGBA buffer. */
function renderGlyph(S) {
  const buf = Buffer.alloc(S * S * 4, 0) // transparent
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return
    const i = (y * S + x) * 4
    buf[i] = r
    buf[i + 1] = g
    buf[i + 2] = b
    buf[i + 3] = a
  }

  // Window card: rounded rect, nudged up-left to leave room for the badge.
  const wx0 = 0.13 * S
  const wy0 = 0.13 * S
  const wx1 = 0.79 * S
  const wy1 = 0.79 * S
  const rad = 0.1 * (wx1 - wx0)
  const inWindow = (x, y) => {
    if (x < wx0 || x > wx1 || y < wy0 || y > wy1) return false
    // knock out the four rounded corners
    const cx = x < wx0 + rad ? wx0 + rad : x > wx1 - rad ? wx1 - rad : x
    const cy = y < wy0 + rad ? wy0 + rad : y > wy1 - rad ? wy1 - rad : y
    return Math.hypot(x - cx, y - cy) <= rad
  }
  const barBottom = wy0 + 0.18 * (wy1 - wy0) // title-bar strip height
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inWindow(x, y)) continue
      put(x, y, y <= barBottom ? BAR : SURFACE)
    }
  }

  // "New" badge: filled accent circle overlapping the window's bottom-right.
  const bcx = 0.76 * S
  const bcy = 0.76 * S
  const br = 0.23 * S
  // Plus glyph inside the badge.
  const armLen = br * 0.62 // half-length of each arm
  const armHalf = br * 0.17 // half-thickness of each arm
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - bcx, y - bcy)
      if (d > br) continue
      const dx = Math.abs(x - bcx)
      const dy = Math.abs(y - bcy)
      const onPlus =
        (dx <= armHalf && dy <= armLen) || (dy <= armHalf && dx <= armLen)
      put(x, y, onPlus ? WHITE : ACCENT)
    }
  }
  return buf
}

/** Box-downsample an SxS RGBA buffer to NxN with premultiplied-alpha averaging. */
function downsample(src, S, N) {
  const out = new PNG({ width: N, height: N })
  const f = S / N
  for (let oy = 0; oy < N; oy++) {
    for (let ox = 0; ox < N; ox++) {
      let ra = 0
      let ga = 0
      let ba = 0
      let aa = 0
      let n = 0
      for (let sy = Math.floor(oy * f); sy < Math.floor((oy + 1) * f); sy++) {
        for (let sx = Math.floor(ox * f); sx < Math.floor((ox + 1) * f); sx++) {
          const i = (sy * S + sx) * 4
          const a = src[i + 3]
          ra += src[i] * a
          ga += src[i + 1] * a
          ba += src[i + 2] * a
          aa += a
          n++
        }
      }
      const o = (oy * N + ox) * 4
      const alpha = aa / n
      out.data[o] = aa ? Math.round(ra / aa) : 0
      out.data[o + 1] = aa ? Math.round(ga / aa) : 0
      out.data[o + 2] = aa ? Math.round(ba / aa) : 0
      out.data[o + 3] = Math.round(alpha)
    }
  }
  return PNG.sync.write(out)
}

/** Assemble PNG-compressed entries into a single .ico (Vista+ supports PNG icons). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  const images = []
  entries.forEach((e, idx) => {
    const b = idx * 16
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0) // width (0 => 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1) // height
    dir.writeUInt8(0, b + 2) // palette
    dir.writeUInt8(0, b + 3) // reserved
    dir.writeUInt16LE(1, b + 4) // color planes
    dir.writeUInt16LE(32, b + 6) // bits per pixel
    dir.writeUInt32LE(e.png.length, b + 8) // bytes
    dir.writeUInt32LE(offset, b + 12) // offset
    offset += e.png.length
    images.push(e.png)
  })
  return Buffer.concat([header, dir, ...images])
}

const SIZES = [16, 24, 32, 48, 64]
const SS = 4 // supersample factor for anti-aliased edges
const entries = SIZES.map((size) => {
  const glyph = renderGlyph(size * SS)
  return { size, png: downsample(glyph, size * SS, size) }
})

const out = resolve('resources/new-window.ico')
writeFileSync(out, buildIco(entries))
console.log(`wrote ${out} (${SIZES.join(', ')} px)`)

// `--preview` also emits a large flat PNG so the glyph can be eyeballed.
if (process.argv.includes('--preview')) {
  const p = resolve('resources/new-window-preview.png')
  writeFileSync(p, downsample(renderGlyph(128 * SS), 128 * SS, 128))
  console.log(`wrote ${p}`)
}
