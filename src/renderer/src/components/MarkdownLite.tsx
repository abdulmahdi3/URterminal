import { useMemo, type ReactNode } from 'react'
import { parseSegments } from '@renderer/lib/segments'

/**
 * Lightweight markdown renderer (no extra deps) shared by the Claude stream pane
 * and the OpenRouter chat pane. Handles the common cases models emit: fenced code
 * blocks (via parseSegments), headings, bold/italic, inline code, links, ordered
 * & unordered lists, blockquotes and horizontal rules. Anything fancier degrades
 * to plain text.
 */

/** Inline spans: `code`, **bold**, *italic* / _italic_, [text](url). */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${k++}`
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={key} className="md-code-inline">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
      if (mm) {
        nodes.push(
          <a key={key} className="md-link" onClick={() => window.open(mm[2], '_blank')}>
            {mm[1]}
          </a>
        )
      } else nodes.push(tok)
    } else {
      // *italic* or _italic_
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

const RE_HEADING = /^(#{1,6})\s+(.*)$/
const RE_LIST = /^\s*(\d+[.)]|[-*+])\s+(.*)$/
const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const RE_QUOTE = /^>\s?(.*)$/

/** Block-level parse of one non-code text segment. */
function renderBlocks(text: string, keyBase: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      i++
      continue
    }
    const h = RE_HEADING.exec(trimmed)
    if (h) {
      const level = Math.min(h[1].length, 4)
      out.push(
        <div key={k++} className={`md-h md-h${level}`}>
          {renderInline(h[2], `${keyBase}h${k}`)}
        </div>
      )
      i++
      continue
    }
    if (RE_HR.test(lines[i])) {
      out.push(<hr key={k++} className="md-hr" />)
      i++
      continue
    }
    if (RE_LIST.test(lines[i])) {
      const ordered = /^\s*\d+[.)]\s+/.test(lines[i])
      const items: ReactNode[] = []
      while (i < lines.length && RE_LIST.test(lines[i])) {
        const mm = RE_LIST.exec(lines[i])
        items.push(<li key={items.length}>{renderInline(mm ? mm[2] : '', `${keyBase}li${i}`)}</li>)
        i++
      }
      out.push(
        ordered ? (
          <ol key={k++} className="md-list">
            {items}
          </ol>
        ) : (
          <ul key={k++} className="md-list">
            {items}
          </ul>
        )
      )
      continue
    }
    if (RE_QUOTE.test(trimmed)) {
      const quote: string[] = []
      while (i < lines.length && RE_QUOTE.test(lines[i].trim())) {
        quote.push(RE_QUOTE.exec(lines[i].trim())?.[1] ?? '')
        i++
      }
      out.push(
        <blockquote key={k++} className="md-quote">
          {renderInline(quote.join('\n'), `${keyBase}q${k}`)}
        </blockquote>
      )
      continue
    }
    // paragraph: gather consecutive plain lines (stops at a blank or block start)
    const para: string[] = []
    while (i < lines.length) {
      const t = lines[i].trim()
      if (!t || RE_HEADING.test(t) || RE_LIST.test(lines[i]) || RE_HR.test(lines[i]) || RE_QUOTE.test(t))
        break
      para.push(lines[i])
      i++
    }
    out.push(
      <p key={k++} className="md-p">
        {renderInline(para.join('\n'), `${keyBase}p${k}`)}
      </p>
    )
  }
  return out
}

export default function MarkdownLite({ text }: { text: string }): JSX.Element {
  const segments = useMemo(() => parseSegments(text), [text])
  return (
    <>
      {segments.map((s, i) =>
        s.type === 'code' ? (
          <pre key={i} className="stream-code">
            <code>{s.text}</code>
          </pre>
        ) : (
          <div key={i} className="md-block">
            {renderBlocks(s.text, `s${i}`)}
          </div>
        )
      )}
    </>
  )
}
