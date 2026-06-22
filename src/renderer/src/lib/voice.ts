/**
 * Uregant voice (Phase 5, §9) — Slice 1: voice OUT (TTS).
 *
 * Uses the OS speech engine via the Web Speech API (speechSynthesis), which works
 * in Electron with zero native dependencies and supports many languages incl.
 * Arabic (when an Arabic OS voice is installed). Auto-detects Arabic vs English
 * from the text. Voice IN (STT) is a later slice — it needs a local Whisper
 * sidecar (whisper.cpp / faster-whisper), which isn't bundled yet.
 */
import type { UrStateEvent } from '@shared/uregant'

export type VoiceLang = 'auto' | 'en' | 'ar'

const OUT_KEY = 'uregant.voiceOut'
const LANG_KEY = 'uregant.voiceLang'
const AR_RE = /[؀-ۿ]/

export function voiceAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function getVoiceOut(): boolean {
  try {
    return localStorage.getItem(OUT_KEY) === '1'
  } catch {
    return false
  }
}
export function setVoiceOut(on: boolean): void {
  try {
    localStorage.setItem(OUT_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (!on) stopSpeaking()
}

export function getVoiceLang(): VoiceLang {
  try {
    const v = localStorage.getItem(LANG_KEY)
    return v === 'en' || v === 'ar' ? v : 'auto'
  } catch {
    return 'auto'
  }
}
export function setVoiceLang(l: VoiceLang): void {
  try {
    localStorage.setItem(LANG_KEY, l)
  } catch {
    /* ignore */
  }
}

/** Strip markdown/code so the engine speaks prose, not punctuation, and cap length. */
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

function pickVoice(prefix: string): SpeechSynthesisVoice | null {
  try {
    const vs = window.speechSynthesis.getVoices()
    return vs.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ?? null
  } catch {
    return null
  }
}

export function speak(text: string): void {
  if (!voiceAvailable()) return
  const clean = cleanForSpeech(text)
  if (!clean) return
  const synth = window.speechSynthesis
  synth.cancel() // barge-in: replace anything currently speaking
  const pref = getVoiceLang()
  const isAr = pref === 'ar' || (pref === 'auto' && AR_RE.test(clean))
  const u = new SpeechSynthesisUtterance(clean)
  u.lang = isAr ? 'ar-SA' : 'en-US'
  const v = pickVoice(isAr ? 'ar' : 'en')
  if (v) u.voice = v
  synth.speak(u)
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
}

// ---- speak-on-complete, driven by the run state stream ----
const lastSpoken = new Map<string, string>()
const seen = new Set<string>()

/**
 * Called for every uregant:state snapshot. Speaks a pane's final assistant reply
 * when a turn completes (if voice-out is on); barges in when a new turn starts.
 * Seeds silently on first sight of a pane so opening an old chat doesn't re-read it.
 */
export function maybeSpeakState(e: UrStateEvent): void {
  const last = [...e.messages]
    .reverse()
    .find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
  const content = last && typeof last.content === 'string' ? last.content.trim() : ''
  if (!seen.has(e.paneId)) {
    seen.add(e.paneId)
    lastSpoken.set(e.paneId, content)
    return
  }
  if (!getVoiceOut()) return
  if (e.streaming) {
    stopSpeaking()
    return
  }
  if (!content || lastSpoken.get(e.paneId) === content) return
  lastSpoken.set(e.paneId, content)
  speak(content)
}
