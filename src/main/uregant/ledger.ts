/**
 * Uregant spend ledger (§14 Cost / OC4). Aggregates token + $ usage by day+model,
 * persisted to userData. Fed by Uregant local turns (tokens, $0) and OpenRouter
 * turns (real costUsd). Read by the Cost tab. Best-effort; never throws.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CostSummary, CostByModel } from '@shared/uregant'

interface Agg {
  day: string
  model: string
  prompt: number
  completion: number
  costUsd: number
  runs: number
}
type Store = Record<string, Agg>

let cache: Store | null = null
const file = (): string => join(app.getPath('userData'), 'uregant-ledger.json')
const today = (): string => new Date().toISOString().slice(0, 10)

function load(): Store {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8')) as Store
  } catch {
    cache = {}
  }
  return cache
}
function save(): void {
  try {
    writeFileSync(file(), JSON.stringify(cache ?? {}), 'utf8')
  } catch {
    /* best-effort */
  }
}

export function recordUsage(model: string, prompt: number, completion: number, costUsd: number): void {
  if (!model) return
  const s = load()
  const day = today()
  const key = `${day}|${model}`
  const e = s[key] ?? { day, model, prompt: 0, completion: 0, costUsd: 0, runs: 0 }
  e.prompt += prompt || 0
  e.completion += completion || 0
  e.costUsd += costUsd || 0
  e.runs += 1
  s[key] = e
  save()
}

export function costSummary(): CostSummary {
  const s = load()
  const day = today()
  let totalCostUsd = 0
  let totalTokens = 0
  let todayCostUsd = 0
  let todayTokens = 0
  const byModel = new Map<string, CostByModel>()
  for (const e of Object.values(s)) {
    const tok = e.prompt + e.completion
    totalCostUsd += e.costUsd
    totalTokens += tok
    if (e.day === day) {
      todayCostUsd += e.costUsd
      todayTokens += tok
    }
    const m = byModel.get(e.model) ?? { model: e.model, prompt: 0, completion: 0, costUsd: 0, runs: 0 }
    m.prompt += e.prompt
    m.completion += e.completion
    m.costUsd += e.costUsd
    m.runs += e.runs
    byModel.set(e.model, m)
  }
  return {
    totalCostUsd,
    totalTokens,
    todayCostUsd,
    todayTokens,
    byModel: [...byModel.values()].sort(
      (a, b) => b.costUsd - a.costUsd || b.prompt + b.completion - (a.prompt + a.completion)
    )
  }
}
