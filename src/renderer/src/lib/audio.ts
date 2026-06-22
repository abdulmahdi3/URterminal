/**
 * Mic capture for Uregant voice input (Phase 5, §9). Captures the microphone via
 * Web Audio and encodes 16 kHz mono 16-bit PCM WAV entirely in JS — the format
 * whisper.cpp wants — so no ffmpeg is needed. Returns an ArrayBuffer to hand to
 * main for transcription.
 */

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Float32Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buf
  const ratio = from / to
  const len = Math.floor(buf.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = buf[Math.floor(i * ratio)]
  return out
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return buf
}

/** A toggle-style mic recorder. start(), then stop() → 16 kHz mono WAV. */
export class Recorder {
  private ctx?: AudioContext
  private stream?: MediaStream
  private node?: ScriptProcessorNode
  private sink?: GainNode
  private chunks: Float32Array[] = []
  private srcRate = 48000

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.ctx = new AudioContext()
    this.srcRate = this.ctx.sampleRate
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.node = this.ctx.createScriptProcessor(4096, 1, 1)
    this.chunks = []
    this.node.onaudioprocess = (e): void => {
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    // keep the processor alive without echoing the mic to the speakers
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0
    src.connect(this.node)
    this.node.connect(this.sink)
    this.sink.connect(this.ctx.destination)
  }

  async stop(): Promise<ArrayBuffer> {
    try {
      this.node?.disconnect()
      this.sink?.disconnect()
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    const merged = mergeFloat32(this.chunks)
    const down = downsample(merged, this.srcRate, 16000)
    const wav = encodeWav(down, 16000)
    try {
      await this.ctx?.close()
    } catch {
      /* ignore */
    }
    this.chunks = []
    return wav
  }
}
