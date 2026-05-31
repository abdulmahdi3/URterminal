import { TurnAssembler } from './turnAssembler'
import { getLearningConfig, type LearningConfig } from './store'

/**
 * The tap that PtyManager calls. Keeps one TurnAssembler per pane and routes raw
 * output plus clean user-turn markers into it.
 *
 * Entirely no-op unless the learning layer is enabled AND capture is on, so the
 * hot path (every PTY byte, every keystroke turn) stays cheap when the feature
 * is off — which is the default. Capture lives wholly in the main process, so it
 * sees each pty exactly once regardless of how many windows render it; that is
 * what makes multi-window de-duplication structural rather than something we
 * have to police.
 */
export interface CaptureSink {
  onSessionStart(p: { ptyId: string; paneId: string; agentId: string; cwd: string }): void
  onPtyData(paneId: string, chunk: string): void
  onUserTurn(paneId: string, text: string, ts: number): void
  onSessionEnd(paneId: string): void
}

export class CaptureService implements CaptureSink {
  // Keyed by paneId: at most one live pty per pane, and the renderer turn marker
  // arrives by paneId. A re-spawn in the same pane replaces the assembler.
  private assemblers = new Map<string, TurnAssembler>()

  private cfg(): LearningConfig {
    return getLearningConfig()
  }

  private active(): boolean {
    const c = this.cfg()
    return c.enabled && c.capture
  }

  onSessionStart({ ptyId, paneId, agentId, cwd }: { ptyId: string; paneId: string; agentId: string; cwd: string }): void {
    if (!this.active()) return
    // v1: capture only AI-agent panes. Shells/SSH spawn with no agent command,
    // so an empty agentId means "not an agent" — skip it to cut noise + surface.
    if (this.cfg().aiOnly && !agentId) return
    this.assemblers.get(paneId)?.end()
    this.assemblers.set(paneId, new TurnAssembler(paneId, ptyId, agentId, cwd, () => this.cfg()))
  }

  onPtyData(paneId: string, chunk: string): void {
    if (!this.active()) return
    this.assemblers.get(paneId)?.output(chunk)
  }

  onUserTurn(paneId: string, text: string, ts: number): void {
    if (!this.active()) return
    const t = text.trim()
    if (!t) return
    this.assemblers.get(paneId)?.userTurn(t, ts)
  }

  onSessionEnd(paneId: string): void {
    const a = this.assemblers.get(paneId)
    if (!a) return
    a.end()
    this.assemblers.delete(paneId)
  }
}
