/**
 * Uregant model catalog + hardware fit logic (UREGANT_PLAN.md §4.1).
 * Pure + shared so main (detection) and renderer (badges) agree. The catalog is
 * a curated fallback; a server-fetched catalog (§4.5) supersedes it later.
 */

export interface HardwareInfo {
  platform: string
  cpuCores: number
  ramTotalMB: number
  ramFreeMB: number
  gpuName?: string
  vramTotalMB?: number
  vramFreeMB?: number
  diskFreeMB?: number
  /** how VRAM was determined — for honest UI ('wmi' total is unreliable, so omitted) */
  vramSource?: 'nvidia-smi' | 'wmi' | 'macos' | 'rocm' | 'none'
}

/** Tool-calling reliability — what matters most for an orchestrator brain. */
export type UrToolQuality = 'reliable' | 'usable' | 'weak'
/** Verification provenance of the entry's claims. */
export type UrProvenance = 'verified' | 'atlas'

export interface UrModelCatalogEntry {
  name: string
  ollamaTag: string
  params: string
  /** usable VRAM at Q4_K_M incl. modest KV (the load floor; agent use adds headroom) */
  minVramGb: number
  /** approximate on-disk download size (GB) */
  downloadSizeGb: number
  tools: UrToolQuality
  status: UrProvenance
  note: string
}

/** Efficiency frontier (June 2026). Ordered by VRAM. See §4.1. */
export const UREGANT_CATALOG: UrModelCatalogEntry[] = [
  { name: 'Qwen3-4B', ollamaTag: 'qwen3:4b', params: '4B', minVramGb: 4, downloadSizeGb: 2.6, tools: 'reliable', status: 'verified', note: 'Best tiny agent default' },
  { name: 'Phi-4-mini', ollamaTag: 'phi4-mini:3.8b', params: '3.8B', minVramGb: 4, downloadSizeGb: 2.5, tools: 'usable', status: 'verified', note: 'Native fn-call, CPU-friendly' },
  { name: 'Qwen3.5-9B', ollamaTag: 'qwen3.5:9b', params: '9B', minVramGb: 6, downloadSizeGb: 5.5, tools: 'reliable', status: 'atlas', note: '"best budget pick" (claim unverified)' },
  { name: 'IBM Granite 4.0 H-Tiny', ollamaTag: 'granite4:tiny-h', params: '7B/1B', minVramGb: 6, downloadSizeGb: 4.5, tools: 'usable', status: 'verified', note: 'Flat KV cache → cheap long context' },
  { name: 'Qwen3-8B', ollamaTag: 'qwen3:8b', params: '8B', minVramGb: 5, downloadSizeGb: 5.2, tools: 'reliable', status: 'verified', note: 'Best all-rounder on 8GB' },
  { name: 'Qwen3-14B', ollamaTag: 'qwen3:14b', params: '14B', minVramGb: 9, downloadSizeGb: 9, tools: 'reliable', status: 'verified', note: 'Workhorse for 12GB cards' },
  { name: 'gpt-oss-20B', ollamaTag: 'gpt-oss:20b', params: '21B/3.6B', minVramGb: 16, downloadSizeGb: 13, tools: 'reliable', status: 'verified', note: 'o3-mini-parity, visible CoT' },
  { name: 'GLM-4.7-Flash', ollamaTag: 'glm-4.7-flash', params: '30B/3B', minVramGb: 18, downloadSizeGb: 19, tools: 'usable', status: 'atlas', note: 'Strong coding+tools, MIT' },
  { name: 'Qwen3-30B-A3B-Thinking', ollamaTag: 'qwen3:30b-a3b-thinking-2507-q4_K_M', params: '30B/3B', minVramGb: 22, downloadSizeGb: 19, tools: 'reliable', status: 'verified', note: 'Best reasoning-per-GB' },
  { name: 'Qwen3-Coder-30B-A3B', ollamaTag: 'qwen3-coder:30b', params: '30B/3.3B', minVramGb: 24, downloadSizeGb: 19, tools: 'reliable', status: 'verified', note: 'Top local coder' },
  { name: 'Llama 3.3 70B', ollamaTag: 'llama3.3:70b', params: '70B', minVramGb: 40, downloadSizeGb: 43, tools: 'usable', status: 'verified', note: 'Near-405B general (not a security model)' }
]

export type UrFit = 'recommended' | 'tight' | 'overload' | 'cant-run' | 'no-disk' | 'unknown'

export interface UrFitResult {
  fit: UrFit
  reason: string
}

/** Classify a model against detected hardware (§4.1 badge rules). */
export function fitBadge(model: UrModelCatalogEntry, hw: HardwareInfo | null): UrFitResult {
  if (!hw) return { fit: 'unknown', reason: 'detecting hardware…' }
  const needMB = model.minVramGb * 1024

  if (hw.diskFreeMB != null && model.downloadSizeGb * 1024 > hw.diskFreeMB) {
    return { fit: 'no-disk', reason: `download won't fit (${model.downloadSizeGb} GB)` }
  }

  const vram = hw.vramTotalMB
  if (vram == null) {
    // No usable VRAM figure — fall back to a RAM-only estimate
    if (needMB <= hw.ramTotalMB * 0.6) return { fit: 'unknown', reason: 'no GPU detected — CPU/RAM estimate, will be slow' }
    return { fit: 'cant-run', reason: 'exceeds available RAM' }
  }
  if (needMB <= vram * 0.8) return { fit: 'recommended', reason: `fits ${Math.round(vram / 1024)} GB VRAM` }
  if (needMB <= vram) return { fit: 'tight', reason: 'near VRAM limit — may be slow or OOM' }
  if (needMB <= vram + hw.ramTotalMB) return { fit: 'overload', reason: 'offloads to RAM — slow, batch-only' }
  return { fit: 'cant-run', reason: 'exceeds VRAM + RAM' }
}

export const FIT_LABEL: Record<UrFit, string> = {
  recommended: '✅ Recommended',
  tight: '🟡 Tight',
  overload: '🟠 Overload',
  'cant-run': '⛔ Can’t run',
  'no-disk': '💾 No disk space',
  unknown: '· estimate'
}

/** Sort order for the catalog: best fit first, then by VRAM. */
export const FIT_RANK: Record<UrFit, number> = {
  recommended: 0,
  tight: 1,
  unknown: 2,
  overload: 3,
  'no-disk': 4,
  'cant-run': 5
}

// ---- Cloud models (Phase 2, Slice 2). Static metadata for direct providers;
// OpenRouter pricing is fetched live via the OpenRouter models API. Prices are
// USD per 1M tokens (approximate, for display/comparison). ----

export type UrCloudProvider = 'anthropic' | 'openai' | 'gemini'

export interface UrCloudModel {
  provider: UrCloudProvider
  name: string
  id: string
  ctxK: number
  inPerM?: number
  outPerM?: number
}

export const UREGANT_CLOUD_CATALOG: UrCloudModel[] = [
  { provider: 'anthropic', name: 'Claude Opus 4.x', id: 'claude-opus-4-7', ctxK: 200, inPerM: 15, outPerM: 75 },
  { provider: 'anthropic', name: 'Claude Sonnet 4.x', id: 'claude-sonnet-4-6', ctxK: 200, inPerM: 3, outPerM: 15 },
  { provider: 'anthropic', name: 'Claude Haiku 4.x', id: 'claude-haiku-4-5-20251001', ctxK: 200, inPerM: 0.8, outPerM: 4 },
  { provider: 'openai', name: 'GPT-4o', id: 'gpt-4o', ctxK: 128, inPerM: 5, outPerM: 15 },
  { provider: 'openai', name: 'GPT-4o mini', id: 'gpt-4o-mini', ctxK: 128, inPerM: 0.15, outPerM: 0.6 },
  { provider: 'gemini', name: 'Gemini 2.0 Flash', id: 'gemini-2.0-flash', ctxK: 1000, inPerM: 0.1, outPerM: 0.4 },
  { provider: 'gemini', name: 'Gemini 1.5 Pro', id: 'gemini-1.5-pro', ctxK: 2000, inPerM: 1.25, outPerM: 5 }
]
