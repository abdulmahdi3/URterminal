import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, RefreshCw, X, Wand2 } from 'lucide-react'
import type { Pane } from '@shared/types'
import { DEFAULT_AGENT } from '@shared/providers'
import { useWorkspace } from '@renderer/store/workspace'
import { getLastAgentCwd, setLastAgentCwd } from '@renderer/lib/agentPrefs'
import { isTerminalStarted, getInputLine, onTerminalInput } from '@renderer/lib/terminalPool'
import { enhancePromptFor } from '@renderer/lib/enhance'
import TerminalPane from './TerminalPane'
import AgentLauncher from './AgentLauncher'
import PromptMinimap from './PromptMinimap'

/**
 * Floating "enhance prompt" action: sits inside the pane at the center-right,
 * by the input line, instead of in the pane header. It only appears once the
 * user has started typing a prompt. Clicking it rewrites the typed prompt
 * (using learned memory) and types the result back into the input field for
 * review — see `enhancePromptFor`.
 */
function EnhanceFab({ paneId }: { paneId: string }): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  // Show only while there's an unsent prompt typed. The tracked input line isn't
  // reactive, so re-read it on every keystroke routed to this pane.
  const [hasText, setHasText] = useState(() => getInputLine(paneId).trim().length > 0)
  useEffect(() => {
    return onTerminalInput((id) => {
      if (id === paneId) setHasText(getInputLine(paneId).trim().length > 0)
    })
  }, [paneId])

  if (!hasText && !busy) return null
  return (
    <button
      className="enhance-fab"
      title="Enhance the typed prompt using learned memory"
      disabled={busy}
      // Don't let the click bubble to the pane (which would start a selection /
      // refocus) before the enhancer reads the typed line.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={async () => {
        if (busy) return
        setBusy(true)
        try {
          await enhancePromptFor(paneId)
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />}
    </button>
  )
}

/**
 * The "AI pane" launches an agent CLI (default: claude) directly in a chosen
 * folder — no shell prompt, no typing. A small launcher form picks the folder
 * first (prefilled with the last-used one for one-click reopen).
 */
export default function AiPane({ pane }: { pane: Pane }): JSX.Element {
  const updatePane = useWorkspace((s) => s.updatePane)
  const removePane = useWorkspace((s) => s.removePane)
  const setAgent = useWorkspace((s) => s.setAgent)
  const command = pane.agent?.command ?? DEFAULT_AGENT
  const cwd = pane.agent?.cwd

  // The CLI is "started" once it prints its first output. Until then (with a
  // folder chosen) we show a loader instead of a blank pane. Re-mounts after
  // zoom report started=true immediately, so no loader flashes.
  const [started, setStarted] = useState(() => isTerminalStarted(pane.id))
  const [bootFailed, setBootFailed] = useState(false)
  const booting = !!cwd && !started

  // Safety net: never let the loader hang forever if the CLI is silent.
  useEffect(() => {
    if (!cwd || started) return
    const t = window.setTimeout(() => setBootFailed(true), 12000)
    return () => window.clearTimeout(t)
  }, [cwd, started])

  if (!cwd) {
    return (
      <AgentLauncher
        command={command}
        defaultCwd={getLastAgentCwd()}
        // switching agent mints a fresh pinned session id (new conversation)
        onSelectAgent={(c) => setAgent(pane.id, c)}
        onOpen={(dir) => {
          setLastAgentCwd(dir)
          // keep the pane's pinned sessionId (and sshTarget) — only add the folder
          updatePane(pane.id, { agent: { ...pane.agent, command, cwd: dir }, title: command })
        }}
      />
    )
  }

  return (
    <div className="agent-pane">
      {booting && !bootFailed && (
        <div className="agent-booting">
          <Loader2 size={26} className="spin" />
          <div className="booting-text">
            Launching <b>{command}</b>…
          </div>
          <div className="booting-path">{cwd}</div>
        </div>
      )}
      {bootFailed && (
        <div className="agent-booting agent-boot-error">
          <AlertCircle size={26} className="boot-error-icon" />
          <div className="booting-text">Agent did not respond</div>
          <div className="booting-path">{cwd}</div>
          <div className="boot-error-actions">
            <button className="btn" onClick={() => { setBootFailed(false); setStarted(true) }}>
              <RefreshCw size={13} /> Continue anyway
            </button>
            <button className="btn danger" onClick={() => removePane(pane.id)}>
              <X size={13} /> Close pane
            </button>
          </div>
        </div>
      )}
      <TerminalPane
        paneId={pane.id}
        command={command}
        sessionId={pane.agent?.sessionId}
        cwd={cwd}
        onReady={(ptyId) => updatePane(pane.id, { agent: { ...pane.agent, command, cwd, ptyId } })}
        onExit={() => removePane(pane.id)}
        onStarted={() => setStarted(true)}
      />
      {started && <EnhanceFab paneId={pane.id} />}
      {started && <PromptMinimap paneId={pane.id} />}
    </div>
  )
}
