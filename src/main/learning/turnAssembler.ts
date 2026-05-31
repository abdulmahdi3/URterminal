import { randomUUID } from 'crypto'
import { stripAnsi } from './ansi'
import { scrub } from './scrub'
import { appendTurn, projectHash, type LearningConfig, type TurnRecord } from './store'

/**
 * Assembles raw PTY output for ONE pane into discrete "turns" and writes each as
 * a scrubbed JSONL record. A turn = the user's submitted prompt paired with the
 * agent output that followed it. A turn flushes when any of these fires:
 *   1. the next user prompt arrives (closes the previous turn);
 *   2. the agent goes quiet for `turnIdleMs` (an idle gap closes an agent turn);
 *   3. the pane/session ends.
 *
 * Raw chunks are NEVER persisted — only the assembled, ANSI-stripped, scrubbed
 * turn. The output buffer is bounded by `maxTurnBytes` (oldest bytes dropped,
 * the turn flagged `truncated`) so a runaway agent can't grow it without bound.
 */
export class TurnAssembler {
  private buf = ''
  private truncated = false
  private userText: string | null = null
  private userTs = 0
  private turnStartTs = 0
  private lastTs = 0
  private turnIndex = 0
  private idle: ReturnType<typeof setTimeout> | null = null
  private readonly hash: string

  constructor(
    private readonly paneId: string,
    private readonly sessionId: string,
    private readonly agentId: string,
    private readonly cwd: string,
    private readonly cfg: () => LearningConfig
  ) {
    this.hash = projectHash(cwd)
  }

  /** Feed raw (still-ANSI) output bytes for this pane. */
  output(chunk: string): void {
    const text = stripAnsi(chunk)
    if (!text) return
    if (!this.turnStartTs) this.turnStartTs = Date.now()
    this.buf += text
    const cap = Math.max(4096, this.cfg().maxTurnBytes)
    if (this.buf.length > cap) {
      this.buf = this.buf.slice(this.buf.length - cap)
      this.truncated = true
    }
    this.lastTs = Date.now()
    this.scheduleIdle()
  }

  /** A clean, submitted user prompt (from the renderer turn marker). */
  userTurn(text: string, ts: number): void {
    // A new prompt closes the previous turn (whose agent output is whatever is
    // buffered) before we start collecting the response to this prompt.
    if (this.buf.trim()) this.flush('prompt')
    this.userText = text
    this.userTs = ts
    this.turnStartTs = Date.now()
  }

  /** Pane/session ended — flush whatever remains. */
  end(): void {
    this.clearIdle()
    if (this.buf.trim() || this.userText) this.flush('exit')
  }

  private scheduleIdle(): void {
    this.clearIdle()
    this.idle = setTimeout(() => this.flush('idle'), Math.max(250, this.cfg().turnIdleMs))
  }

  private clearIdle(): void {
    if (this.idle) {
      clearTimeout(this.idle)
      this.idle = null
    }
  }

  private flush(reason: string): void {
    this.clearIdle()
    const extra = this.cfg().scrubExtraPatterns
    const agentText = scrub(this.buf, extra).trim()
    const userClean = this.userText != null ? scrub(this.userText, extra) : null
    const truncated = this.truncated
    const startTs = this.turnStartTs || this.lastTs || Date.now()
    const hadUser = this.userText
    const userTs = this.userTs

    // Reset for the next turn before the (guarded) write so an error can't wedge
    // the assembler into re-emitting the same turn.
    this.buf = ''
    this.truncated = false
    this.userText = null
    this.userTs = 0
    this.turnStartTs = 0

    if (!agentText && !(userClean && userClean.trim())) return

    const rec: TurnRecord = {
      v: 1,
      turnId: randomUUID(),
      ts: Date.now(),
      paneId: this.paneId,
      sessionId: this.sessionId,
      agentId: this.agentId,
      cwd: this.cwd,
      projectHash: this.hash,
      turnIndex: this.turnIndex++,
      user: hadUser != null ? { text: userClean ?? '', ts: userTs } : null,
      agent: { text: agentText, durationMs: Math.max(0, Date.now() - startTs), exitMarker: reason },
      scrubbed: true,
      truncated
    }
    appendTurn(rec)
  }
}
