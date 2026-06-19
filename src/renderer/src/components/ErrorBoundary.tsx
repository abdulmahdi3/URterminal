import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render-time exceptions so a single broken component can't blank the
 * whole window (an unrecoverable black `#root`). Shows a recovery card with a
 * Reload — the most common cause of the "black screen" is an uncaught render
 * error, and a reload re-runs session restore from the last good snapshot.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in the main process log via the renderer console.
    console.error('[ErrorBoundary] render crash:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    // Inline styles only — the failure might be in the styling/theme layer.
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0d12',
          color: '#e7ecf3',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: 24,
          zIndex: 99999
        }}
      >
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
            URterminal hit a snag
          </div>
          <div style={{ fontSize: 13, color: '#8b94a6', lineHeight: 1.5, marginBottom: 18 }}>
            The interface stopped rendering. Reloading restores your panes from the last saved
            state — your sessions and chats are safe on disk.
          </div>
          <pre
            style={{
              textAlign: 'left',
              fontSize: 11,
              color: '#ff8b8b',
              background: '#12151c',
              border: '1px solid #2a2f3a',
              borderRadius: 8,
              padding: '8px 10px',
              maxHeight: 120,
              overflow: 'auto',
              marginBottom: 18,
              whiteSpace: 'pre-wrap'
            }}
          >
            {error.message || String(error)}
          </pre>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: '#d29922',
                color: '#1a1205',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Reload
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #2a2f3a',
                background: 'transparent',
                color: '#e7ecf3',
                cursor: 'pointer'
              }}
            >
              Try to continue
            </button>
          </div>
        </div>
      </div>
    )
  }
}
