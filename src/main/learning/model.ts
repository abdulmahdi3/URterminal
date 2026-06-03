import { spawn } from 'child_process'
import type { RunModel } from './distiller'
import type { LearningConfig, LearningProvider } from './store'

/**
 * The model-invocation seam — the ONLY place the learning layer reaches a model,
 * and the only egress point. Kept tiny and isolated so the rest of the layer is
 * pure/testable; this adapter itself is exercised via integration, not unit
 * tests.
 *
 * Default: spawn the user's already-authenticated Claude Code CLI headless
 * (`claude -p --output-format json`). No new API key, same trust boundary the
 * user already accepted. `provider-api` and `local` are reserved for a later
 * slice; until wired they throw a clear error so nothing silently sends data.
 */

/** Run the Claude Code CLI in headless print mode and return its text output. */
export const runClaudeHeadless: RunModel = (system, prompt) =>
  new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('claude', ['-p', '--output-format', 'json', '--append-system-prompt', system], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (e) {
      reject(e as Error)
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      reject(new Error('claude headless distill timed out'))
    }, 120000)

    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !out) {
        reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`))
        return
      }
      // `--output-format json` wraps the reply; pull out the result text if present.
      try {
        const parsed = JSON.parse(out)
        resolve(typeof parsed.result === 'string' ? parsed.result : out)
      } catch {
        resolve(out)
      }
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })

/**
 * Run Google's Gemini API (free tier) and return its text output. Used by the
 * prompt enhancer. Thinking is disabled for speed/cost — rewriting a request
 * doesn't need it. Throws a readable error so the UI can surface it.
 */
export function runGemini(apiKey: string, model: string): RunModel {
  return async (system, prompt) => {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:generateContent?key=${encodeURIComponent(apiKey)}`
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } }
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch((e) => {
      throw new Error(`Gemini request failed: ${(e as Error).message}`)
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      throw new Error(`Gemini failed: HTTP ${r.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`)
    }
    const data = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
    return text
  }
}

/**
 * Run OpenAI's Chat Completions API and return the assistant text. Used wherever
 * the learning layer needs a model and the user picked OpenAI as the provider.
 */
export function runOpenAI(apiKey: string, model: string): RunModel {
  return async (system, prompt) => {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    }).catch((e) => {
      throw new Error(`OpenAI request failed: ${(e as Error).message}`)
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      throw new Error(`OpenAI failed: HTTP ${r.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`)
    }
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content ?? ''
  }
}

/**
 * Run Anthropic's Messages API and return the assistant text. Runs in the main
 * process, so there is no browser CORS constraint.
 */
export function runAnthropic(apiKey: string, model: string): RunModel {
  return async (system, prompt) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0.3,
        system,
        messages: [{ role: 'user', content: prompt }]
      })
    }).catch((e) => {
      throw new Error(`Anthropic request failed: ${(e as Error).message}`)
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      throw new Error(`Anthropic failed: HTTP ${r.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`)
    }
    const data = (await r.json()) as { content?: Array<{ text?: string }> }
    return (data.content ?? []).map((p) => p.text ?? '').join('')
  }
}

/** Fallback model id per API provider when the user hasn't picked one. */
const DEFAULT_MODEL_BY_PROVIDER: Record<Exclude<LearningProvider, 'claude-cli'>, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001'
}

/**
 * Resolve the configured provider into a runnable model fn. The prompt enhancer
 * and distillation share this single seam. 'claude-cli' needs no key; the HTTP
 * providers require a key in `apiKeys` and otherwise return a fn that rejects
 * with a readable error so the UI can prompt the user to add one.
 */
export function getLearningRunModel(cfg: LearningConfig): RunModel {
  const provider = cfg.provider ?? 'claude-cli'
  if (provider === 'claude-cli') return runClaudeHeadless

  const key = (cfg.apiKeys?.[provider] || '').trim()
  if (!key) {
    return () =>
      Promise.reject(
        new Error(
          `Add a ${provider} API key in Learning settings, or switch the AI provider to Claude CLI.`
        )
      )
  }
  const model = cfg.providerModel || DEFAULT_MODEL_BY_PROVIDER[provider]
  switch (provider) {
    case 'gemini':
      return runGemini(key, model)
    case 'openai':
      return runOpenAI(key, model)
    case 'anthropic':
      return runAnthropic(key, model)
    default:
      return runClaudeHeadless
  }
}

/**
 * The prompt enhancer and distillation use the same configured provider, so both
 * names resolve to {@link getLearningRunModel}. Kept as separate exports for the
 * two call sites (enhancer / capture) and any future divergence.
 */
export const getEnhanceRunModel = getLearningRunModel
export const getRunModel = getLearningRunModel
