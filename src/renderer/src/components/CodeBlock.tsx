import { useState } from 'react'

export default function CodeBlock({ lang, text }: { lang?: string; text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-lang">{lang || 'code'}</span>
        <button className="code-copy" onClick={copy}>
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="code-block-body">
        <code>{text.replace(/\n$/, '')}</code>
      </pre>
    </div>
  )
}
