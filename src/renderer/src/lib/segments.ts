export interface Segment {
  type: 'text' | 'code'
  lang?: string
  text: string
}

// Split message text into plain-text and fenced-code segments. Tolerates an
// unterminated trailing code fence (common while a reply is still streaming).
export function parseSegments(input: string): Segment[] {
  const segments: Segment[] = []
  const re = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) segments.push({ type: 'text', text: input.slice(last, m.index) })
    segments.push({ type: 'code', lang: m[1].trim() || undefined, text: m[2] })
    last = re.lastIndex
    if (re.lastIndex === m.index) re.lastIndex++ // guard against zero-width matches
  }
  if (last < input.length) segments.push({ type: 'text', text: input.slice(last) })
  return segments.filter((s) => s.text.length > 0 || s.type === 'code')
}
