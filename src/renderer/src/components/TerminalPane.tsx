import { useEffect, useRef } from 'react'
import { mountTerminal, fitTerminal } from '@renderer/lib/terminalPool'

interface Props {
  paneId: string
  /** spawn this program directly as the pty process (e.g. "claude") */
  command?: string
  /** working directory to launch in */
  cwd?: string
  /** called once the pty exists so the store can track its id */
  onReady?: (ptyId: string, shell: string) => void
  /** called when the pty process exits (e.g. agent quit via Ctrl+C twice) */
  onExit?: (code: number) => void
  /** called once when the process prints its first output (boot finished) */
  onStarted?: () => void
}

/**
 * Thin React wrapper around a pooled terminal. The xterm + PTY live in the
 * terminal pool and survive unmounts (zoom, drag-rearrange), so this component
 * only attaches the terminal to its container and keeps it fitted on resize.
 */
export default function TerminalPane({
  paneId,
  command,
  cwd,
  onReady,
  onExit,
  onStarted
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const onReadyRef = useRef(onReady)
  const onExitRef = useRef(onExit)
  const onStartedRef = useRef(onStarted)
  onReadyRef.current = onReady
  onExitRef.current = onExit
  onStartedRef.current = onStarted

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    mountTerminal(paneId, container, {
      command,
      cwd,
      onReady: (id, shell) => onReadyRef.current?.(id, shell),
      onExit: (code) => onExitRef.current?.(code),
      onStarted: () => onStartedRef.current?.()
    })

    // Debounce refits so a drag/resize sends one final SIGWINCH to the CLI
    // instead of a storm of them (which made claude reprint its banner).
    let t = 0
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t)
      t = window.setTimeout(() => fitTerminal(paneId), 60)
    })
    ro.observe(container)
    fitTerminal(paneId)

    return () => {
      window.clearTimeout(t)
      ro.disconnect()
      // Terminal stays alive in the pool — only disposed when the pane is closed.
    }
  }, [paneId, command, cwd])

  return <div className="shell-pane" ref={containerRef} />
}
