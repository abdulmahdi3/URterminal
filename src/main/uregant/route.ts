/**
 * Uregant Route / Project Crew (Phase 4, §6, OC2). Slice 1: turn a goal into an
 * ordered step plan (planner model, structured output) and a machine-checkable
 * Definition of Done (run_gate over the project's npm scripts). Parallel/race
 * fan-out + merge/ship come in later slices.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { UrPlan, UrGateResult } from '@shared/uregant'
import { runCommand } from './exec'

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { role: { type: 'string' }, instruction: { type: 'string' } },
        required: ['role', 'instruction']
      }
    }
  },
  required: ['steps']
}

const ROLES = 'planner, architect, coder, reviewer, security, debugger, tester'
const PLAN_SYSTEM = `You are the Uregant planner for a software project. Given a goal, output the SMALLEST ordered plan of concrete steps that reaches a correct, reviewed, tested result. Assign each step exactly one role from: ${ROLES}. Keep instructions specific and actionable. Respond with JSON only.`

export async function planProject(
  baseUrl: string,
  model: string,
  goal: string
): Promise<{ ok: boolean; plan?: UrPlan; error?: string }> {
  if (!baseUrl) return { ok: false, error: 'No Ollama server configured.' }
  if (!goal.trim()) return { ok: false, error: 'Empty goal.' }
  const base = baseUrl.replace(/\/+$/, '')
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 120_000)
  try {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.2 },
        format: PLAN_SCHEMA,
        keep_alive: '5m',
        messages: [
          { role: 'system', content: PLAN_SYSTEM },
          { role: 'user', content: goal }
        ]
      })
    })
    if (!r.ok) {
      const d = await r.text().catch(() => '')
      return { ok: false, error: `Planner HTTP ${r.status}${d ? ` — ${d.slice(0, 160)}` : ''}` }
    }
    const j = (await r.json()) as { message?: { content?: string } }
    let parsed: UrPlan
    try {
      parsed = JSON.parse(j.message?.content ?? '') as UrPlan
    } catch {
      return { ok: false, error: 'Planner returned non-JSON output.' }
    }
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps
          .filter((s) => s && typeof s.instruction === 'string' && s.instruction.trim())
          .map((s) => ({ role: String(s.role || 'coder'), instruction: String(s.instruction) }))
      : []
    if (!steps.length) return { ok: false, error: 'Planner produced no steps.' }
    return { ok: true, plan: { steps, summary: typeof parsed.summary === 'string' ? parsed.summary : undefined } }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { ok: false, error: 'Planning timed out.' }
    return { ok: false, error: (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

const GATE_SCRIPTS = ['typecheck', 'build', 'lint', 'test']

/** Definition of Done: run whichever standard npm scripts the project defines. */
export async function runGate(cwd: string): Promise<UrGateResult[]> {
  if (!cwd || !existsSync(join(cwd, 'package.json'))) {
    return [{ name: 'package.json', ok: false, detail: 'No package.json in this folder.' }]
  }
  let scripts: Record<string, string> = {}
  try {
    scripts = (JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).scripts ?? {}) as Record<string, string>
  } catch {
    /* leave empty */
  }
  const names = GATE_SCRIPTS.filter((n) => scripts[n])
  if (!names.length) {
    return [{ name: 'scripts', ok: false, detail: 'No typecheck / build / lint / test scripts found.' }]
  }
  const out: UrGateResult[] = []
  for (const n of names) {
    const res = await runCommand({ command: `npm run ${n}`, cwd, timeoutMs: 300_000 })
    out.push({
      name: n,
      ok: res.ok,
      detail: res.ok ? 'passed' : (res.error || res.stderr || `exit ${res.exitCode}`).slice(0, 300)
    })
  }
  return out
}
