import { useEffect, useRef } from 'react'
import { mountTerminal, fitTerminal, bumpFontSize } from '@renderer/lib/terminalPool'
import { useSettings } from '@renderer/store/settings'

interface Props {
  paneId: string
  /** spawn this program directly as the pty process (e.g. "claude") */
  command?: string
  /** explicit shell executable to spawn (e.g. "powershell.exe"); blank = OS default */
  shell?: string
  /** extra args for the shell binary (e.g. ["-d", "Ubuntu"] for a WSL distro) */
  shellArgs?: string[]
  /** working directory to launch in */
  cwd?: string
  /** command auto-typed once the shell is ready (pane templates) */
  startupCommand?: string
  /** when set, this pane is an SSH session (target = "user@host[:port]") */
  ssh?: { target: string }
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
  shell,
  shellArgs,
  cwd,
  startupCommand,
  ssh,
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
      shell,
      shellArgs,
      cwd,
      startupCommand,
      ssh,
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

    // Ctrl+scroll zooms the terminal font in/out (applied live to every pane),
    // debounced-persisted to settings. Non-passive so we can preventDefault and
    // stop the wheel from also scrolling the buffer while zooming.
    let persistT = 0
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const size = bumpFontSize(e.deltaY < 0 ? 1 : -1)
      window.clearTimeout(persistT)
      persistT = window.setTimeout(() => {
        void useSettings.getState().patch({ prefs: { fontSize: size } })
      }, 400)
    }
    container.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      window.clearTimeout(t)
      window.clearTimeout(persistT)
      container.removeEventListener('wheel', onWheel)
      ro.disconnect()
      // Terminal stays alive in the pool — only disposed when the pane is closed.
    }
  }, [paneId, command, shell, shellArgs?.join(' '), cwd, ssh?.target])

  return <div className="shell-pane" ref={containerRef} />
}
