import { useMemo } from 'react'
import { parseSegments } from '@renderer/lib/segments'

/**
 * Lightweight markdown: plain text with fenced code blocks (no extra deps).
 * Shared by the Claude stream pane and the OpenRouter chat pane.
 */
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
          <div key={i} className="stream-md">
            {s.text}
          </div>
        )
      )}
    </>
  )
}
