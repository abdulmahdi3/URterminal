/**
 * Strip ANSI / VT control sequences from PTY output so captured transcripts are
 * plain text. xterm does this on the renderer side (translateToString), but the
 * learning layer assembles turns in the MAIN process from raw node-pty bytes, so
 * it needs its own stripper with no DOM/xterm dependency.
 *
 * Implemented as a char-code scanner (not regex) so the source carries no raw
 * control bytes: it skips CSI (ESC [ ... final 0x40-0x7E), OSC and the
 * DCS/SOS/PM/APC string families (terminated by BEL 0x07 or ST = ESC backslash),
 * and lone two-char escapes; it keeps TAB (0x09) and LF (0x0A), drops the other
 * C0 controls and DEL (0x7F), and collapses carriage-return overwrites (a
 * spinner repainting the same row) to just the final state of each line.
 */

const ESC = 0x1b
const BEL = 0x07

export function stripAnsi(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)

    if (c === ESC) {
      const next = input[i + 1]
      if (next === '[') {
        // CSI: ESC [ ... up to a final byte in 0x40-0x7E
        i += 2
        while (i < input.length) {
          const f = input.charCodeAt(i)
          if (f >= 0x40 && f <= 0x7e) break
          i++
        }
      } else if (next === ']' || next === 'P' || next === 'X' || next === '^' || next === '_') {
        // OSC / DCS / SOS / PM / APC: ... terminated by BEL or ST (ESC backslash)
        i += 2
        while (i < input.length) {
          const f = input.charCodeAt(i)
          if (f === BEL) break
          if (f === ESC && input[i + 1] === '\\') {
            i++
            break
          }
          i++
        }
      } else {
        // lone two-char escape: drop ESC + the following byte
        i += 1
      }
      continue
    }

    if (c === 0x09 || c === 0x0a) {
      out += input[i] // keep TAB and LF
    } else if (c === 0x0d) {
      out += '\r' // keep CR for the overwrite-collapse pass below
    } else if (c < 0x20 || c === 0x7f) {
      // drop the remaining C0 controls and DEL
    } else {
      out += input[i]
    }
  }

  // Collapse carriage-return overwrites: within each line keep only the text
  // after the last CR, so a repainting spinner reduces to its final frame.
  return out
    .split('\n')
    .map((line) => {
      const cr = line.lastIndexOf('\r')
      return cr >= 0 ? line.slice(cr + 1) : line
    })
    .join('\n')
}
