import { Bot } from 'grammy'
import type { TelegramStatus, TelegramInbound } from '@shared/types'
import type { SettingsStore } from '../settings/store'

const FLUSH_MS = 1200
const TG_MAX = 3800 // stay under Telegram's 4096 limit with headroom

type EmitInbound = (e: TelegramInbound) => void
type EmitStatus = (s: TelegramStatus) => void

export class TelegramBridge {
  private bot: Bot | null = null
  private status: TelegramStatus = { running: false }

  /** paneId -> chatId (outbound + reverse-lookup for inbound) */
  private links = new Map<string, string>()
  /** chatId -> buffered outbound text */
  private outBuf = new Map<string, string>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(
    private settings: SettingsStore,
    private emitInbound: EmitInbound,
    private emitStatus: EmitStatus
  ) {}

  isRunning(): boolean {
    return this.status.running
  }

  getStatus(): TelegramStatus {
    return this.status
  }

  async start(): Promise<TelegramStatus> {
    await this.stop()
    const token = this.settings.getTelegramToken()
    if (!token) {
      this.status = { running: false }
      this.emitStatus(this.status)
      return this.status
    }
    try {
      const bot = new Bot(token)
      bot.on('message:text', (ctx) => this.handleInbound(ctx.chat.id.toString(), ctx.message.text))
      bot.catch((err) => {
        this.status = { running: this.status.running, error: String(err.error ?? err) }
        this.emitStatus(this.status)
      })
      await bot.init()
      // start() runs long-polling; do not await (it resolves only on stop).
      void bot.start({ drop_pending_updates: true })
      this.bot = bot
      this.status = { running: true, botUsername: bot.botInfo.username }
    } catch (err) {
      this.status = { running: false, error: (err as Error).message }
    }
    this.emitStatus(this.status)
    return this.status
  }

  async stop(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stop()
      } catch {
        /* ignore */
      }
      this.bot = null
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.outBuf.clear()
    this.status = { running: false }
  }

  linkPane(paneId: string, chatId: string | null): void {
    if (chatId) this.links.set(paneId, chatId)
    else this.links.delete(paneId)
  }

  /** Buffer pane output and flush to its linked chat on a throttle. */
  forward(paneId: string, text: string): void {
    const chatId = this.links.get(paneId)
    if (!chatId || !text) return
    this.outBuf.set(chatId, (this.outBuf.get(chatId) ?? '') + text)
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS)
    }
  }

  private flush(): void {
    this.flushTimer = null
    if (!this.bot) {
      this.outBuf.clear()
      return
    }
    for (const [chatId, text] of this.outBuf) {
      const trimmed = text.length > TG_MAX ? text.slice(-TG_MAX) : text
      void this.bot.api.sendMessage(chatId, trimmed).catch((err) => {
        this.status = { ...this.status, error: String(err) }
        this.emitStatus(this.status)
      })
    }
    this.outBuf.clear()
  }

  private handleInbound(chatId: string, text: string): void {
    // `/pane <id> <text>` overrides routing; otherwise reverse-lookup the link.
    let paneId: string | undefined
    let body = text
    const m = text.match(/^\/pane\s+(\S+)\s+([\s\S]+)$/)
    if (m) {
      paneId = m[1]
      body = m[2]
    } else {
      for (const [pid, cid] of this.links) {
        if (cid === chatId) {
          paneId = pid
          break
        }
      }
    }
    if (!paneId) {
      void this.bot?.api.sendMessage(
        chatId,
        'No pane linked to this chat. Use /pane <paneId> <message> or link a pane in the app.'
      )
      return
    }
    this.emitInbound({ paneId, text: body, chatId })
  }
}
