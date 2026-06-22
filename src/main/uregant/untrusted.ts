/**
 * Untrusted-data envelope for tool results (UREGANT_PLAN.md §11.1). Runs in main
 * now that the loop controller lives here. Bidi controls are stripped by numeric
 * codepoint so no invisible chars enter the source or the model context.
 */
// U+202A–U+202E (LRE/RLE/PDF/LRO/RLO) and U+2066–U+2069 (LRI/RLI/FSI/PDI)
const BIDI_CODES = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])

export function stripBidi(s: string): string {
  let out = ''
  for (const ch of s) if (!BIDI_CODES.has(ch.codePointAt(0) ?? 0)) out += ch
  return out
}

export function wrapUntrusted(toolName: string, value: unknown): string {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  return `<tool_result tool="${toolName}" trust="untrusted">\n${stripBidi(text).slice(0, 6000)}\n</tool_result>`
}
