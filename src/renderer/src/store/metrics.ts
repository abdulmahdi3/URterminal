import { create } from 'zustand'
import { takeCharCount } from '@renderer/lib/outputMetrics'

/**
 * Live runtime metrics shown in the title bar and status bar.
 * A single interval (mounted once in App) calls `sample()` so every consumer
 * shares one source of truth instead of polling independently.
 */
interface MetricsState {
  ramMB: number
  cpuPercent: number
  tokPerSec: number
  sample: () => Promise<void>
}

const SAMPLE_MS = 1000

export const useMetrics = create<MetricsState>((set) => ({
  ramMB: 0,
  cpuPercent: 0,
  tokPerSec: 0,
  sample: async () => {
    // tokens/sec ≈ characters streamed this interval / 4, scaled to per-second.
    const chars = takeCharCount()
    const tokPerSec = Math.round((chars / 4) * (1000 / SAMPLE_MS) * 10) / 10
    try {
      const perf = await window.api.getPerfSample()
      set({ ramMB: perf.mainRssMB, cpuPercent: perf.cpuPercent, tokPerSec })
    } catch {
      set({ tokPerSec })
    }
  }
}))

/** Start the shared sampling loop; returns a cleanup fn. */
export function startMetricsLoop(): () => void {
  void useMetrics.getState().sample()
  const id = window.setInterval(() => void useMetrics.getState().sample(), SAMPLE_MS)
  return () => window.clearInterval(id)
}
