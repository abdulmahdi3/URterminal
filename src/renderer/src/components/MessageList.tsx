import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatMessage } from '@shared/types'
import { parseSegments } from '@renderer/lib/segments'
import CodeBlock from './CodeBlock'

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function MessageList({ messages }: { messages: ChatMessage[] }): JSX.Element {
  const { t } = useTranslation()
  const parentRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lastLen = messages[messages.length - 1]?.content.length ?? 0

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height
  })

  // Auto-scroll lock: only pin to bottom while the user is already near it.
  useEffect(() => {
    if (messages.length && stick.current) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastLen])

  const onScroll = (): void => {
    const el = parentRef.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  if (!messages.length) {
    return (
      <div className="msg-list empty">
        <div className="msg-empty">Ask anything. Shift+Enter for a newline.</div>
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()

  return (
    <div className="msg-list" ref={parentRef} onScroll={onScroll}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.map((vi) => {
          const m = messages[vi.index]
          return (
            <div
              key={m.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className={`msg msg-${m.role}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`
              }}
            >
              <div className="msg-head">
                <span className="msg-role">{m.role}</span>
                <span className="msg-time">{timeOf(m.createdAt)}</span>
              </div>
              <div className="msg-content">
                {parseSegments(m.content).map((seg, i) =>
                  seg.type === 'code' ? (
                    <CodeBlock key={i} lang={seg.lang} text={seg.text} />
                  ) : (
                    <span key={i} className="msg-text">
                      {seg.text}
                    </span>
                  )
                )}
                {m.streaming && !m.content && <span className="msg-thinking">{t('ai.thinking')}</span>}
                {m.streaming && <span className="msg-cursor">▋</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
