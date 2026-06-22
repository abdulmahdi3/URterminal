/**
 * Uregant voice input (Phase 5, §9) — local whisper.cpp STT. Detects the
 * whisper.cpp binary + a ggml model (from a saved config or PATH), and
 * transcribes a 16 kHz mono WAV. Offline & private. Config lives in userData so
 * the user can point at their binary/model without a settings-schema change.
 */
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { UrSttStatus } from '@shared/uregant'
import { runCommand } from './exec'

const configPath = (): string => join(app.getPath('userData'), 'uregant-stt.json')

interface SttConfig {
  binary?: string
  model?: string
}

function readSttConfig(): SttConfig {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as SttConfig
  } catch {
    return {}
  }
}

export function writeSttConfig(cfg: SttConfig): void {
  try {
    writeFileSync(configPath(), JSON.stringify(cfg), 'utf8')
  } catch {
    /* best-effort */
  }
}

/** Minimal `which` over PATH (Windows-aware extensions). */
function which(names: string[]): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  const dirs = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')
  for (const n of names) {
    for (const d of dirs) {
      if (!d) continue
      for (const e of exts) {
        const p = join(d, n + e)
        try {
          if (existsSync(p)) return p
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null
}

export function detectStt(): UrSttStatus {
  const cfg = readSttConfig()
  const binary =
    cfg.binary && existsSync(cfg.binary)
      ? cfg.binary
      : which(['whisper-cli', 'whisper-cpp', 'main'])
  const model = cfg.model && existsSync(cfg.model) ? cfg.model : undefined
  if (!binary) {
    return { ok: false, error: 'whisper.cpp not found. Install it (or set its path) for voice input.' }
  }
  if (!model) {
    return { ok: false, binary, error: 'No whisper model set. Download a ggml-*.bin model and set its path.' }
  }
  return { ok: true, binary, model }
}

export function setSttConfig(binary: string, model: string): UrSttStatus {
  writeSttConfig({ binary: binary.trim() || undefined, model: model.trim() || undefined })
  return detectStt()
}

export async function transcribe(
  wav: ArrayBuffer,
  lang: string
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const st = detectStt()
  if (!st.ok || !st.binary || !st.model) return { ok: false, error: st.error || 'STT not configured.' }
  const base = join(app.getPath('temp'), `uregant-stt-${Date.now()}`)
  const wavPath = base + '.wav'
  try {
    writeFileSync(wavPath, Buffer.from(wav))
    const l = lang === 'en' || lang === 'ar' ? lang : 'auto'
    const res = await runCommand({
      command: `"${st.binary}" -m "${st.model}" -f "${wavPath}" -nt -l ${l} -otxt -of "${base}"`,
      cwd: app.getPath('temp'),
      timeoutMs: 120_000
    })
    let text = ''
    try {
      text = readFileSync(base + '.txt', 'utf8').trim()
    } catch {
      text = (res.stdout || '').trim()
    }
    if (!text && !res.ok) return { ok: false, error: (res.stderr || res.error || 'transcription failed').slice(0, 300) }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    try {
      unlinkSync(wavPath)
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(base + '.txt')
    } catch {
      /* ignore */
    }
  }
}
