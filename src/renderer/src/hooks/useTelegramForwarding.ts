import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { getScreenText, onTerminalInput } from '@renderer/lib/terminalPool'
import { answerBlocks } from './useChainForwarding'

// How long the pane must be quiet after output before we treat the answer as
// complete and forward it (matches the chain-forwarding cadence).
const IDLE_MS = 1500

// Escape sequences in raw keystrokes (arrow keys, bracketed-paste markers, etc.).
// Stripping them leaves just the printable text the user typed.
const INPUT_ESC = new RegExp('\\u001B\\[[0-9;]*[~A-Za-z]|\\u001B[O][A-Za-z]?', 'g')

// Wrap injected text in bracketed-paste markers so the CLI treats it as a paste
// (handles multi-line and avoids per-char keybindings firing).
const ESC = String.fromCharCode(27)
const bracketPaste = (s: string): string => `${ESC}[200~${s}${ESC}[201~`

interface TgState {
  armed: boolean
  timer: number
  baseBlocks: Set<string>
  lastSent: string
  inputBuf: string
}

function ptyOf(paneId: string): string | undefined {
  const pane = useWorkspace.getState().panes[paneId]
  return pane?.type === 'ai' ? pane.agent?.ptyId : pane?.shell?.ptyId
}

/**
 * Owns the two-way Telegram bridge for panes linked to a chat:
 *  - outbound: forwards the submitted prompt and the agent's answer blocks
 *    (not the raw screen redraws a full-screen TUI emits);
 *  - inbound: types messages received from Telegram into the linked pane and
 *    arms answer-tracking so the reply is sent back to the chat.
 */
export function useTelegramForwarding(): void {
  useEffect(() => {
    const state = new Map<string, TgState>()
    const getSt = (id: string): TgState => {
      let s = state.get(id)
      if (!s) {
        s = { armed: false, timer: 0, baseBlocks: new Set(), lastSent: '', inputBuf: '' }
        state.set(id, s)
      }
      return s
    }
    const isLinked = (id: string): boolean => !!useWorkspace.getState().panes[id]?.telegramChatId

    // The in-memory pane->chat map in the main process is lost on restart, so
    // re-register it from the persisted panes once they have hydrated.
    for (const [id, pane] of Object.entries(useWorkspace.getState().panes)) {
      if (pane.telegramChatId) window.api.linkPaneToTelegram(id, pane.telegramChatId)
    }

    // Snapshot the answers already on screen so only new blocks count as "the result".
    const arm = (id: string): void => {
      const s = getSt(id)
      s.armed = true
      s.baseBlocks = new Set(answerBlocks(getScreenText(id)))
    }

    const flush = (id: string): void => {
      const s = getSt(id)
      s.armed = false
      const fresh = answerBlocks(getScreenText(id)).filter((b) => !s.baseBlocks.has(b))
      const result = fresh.join('\n\n').trim()
      if (!result || result === s.lastSent) return
      s.lastSent = result
      window.api.forwardToTelegram(id, `🤖 ${result}`)
    }

    // ---- outbound: capture locally-typed prompts ----
    const offInput = onTerminalInput((paneId, data) => {
      if (!isLinked(paneId)) return
      const s = getSt(paneId)
      let buf = s.inputBuf
      for (const ch of data.replace(INPUT_ESC, '')) {
        const code = ch.charCodeAt(0)
        if (code === 13 || code === 10) {
          // Enter: submit the buffered prompt and start tracking the answer.
          const prompt = buf.trim()
          buf = ''
          if (prompt) {
            window.api.forwardToTelegram(paneId, `🧑 ${prompt}`)
            arm(paneId) // snapshot now; everything new after this is the answer
          }
        } else if (code === 127 || code === 8) {
          buf = buf.slice(0, -1) // backspace / delete
        } else if (code >= 32) {
          buf += ch // printable character
        }
      }
      s.inputBuf = buf
    })

    // ---- inbound: type Telegram messages into the linked pane ----
    const offInbound = window.api.onTelegramInbound(({ paneId, text }) => {
      const ptyId = ptyOf(paneId)
      if (!ptyId) return
      arm(paneId) // snapshot before the answer arrives so the reply goes back
      window.api.writePty(ptyId, bracketPaste(text))
      // submit on the next tick so the paste is registered first
      window.setTimeout(() => window.api.writePty(ptyId, '\r'), 150)
    })

    const offData = window.api.onPtyData((e) => {
      const s = state.get(e.paneId)
      if (!s?.armed) return
      window.clearTimeout(s.timer)
      s.timer = window.setTimeout(() => flush(e.paneId), IDLE_MS)
    })

    return () => {
      offInput()
      offInbound()
      offData()
      state.forEach((s) => window.clearTimeout(s.timer))
    }
  }, [])
}
