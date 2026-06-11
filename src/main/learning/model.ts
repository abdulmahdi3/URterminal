import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { isAbsolute } from 'path'
import { SettingsStore } from '../settings/store'
import { defaultLocalBaseUrl } from '@shared/providers'
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
export const runClaudeHeadless: RunModel = (system, prompt, cwd) =>
  new Promise((resolve, reject) => {
    // Ground the CLI in the user's project. Without this the child inherits the
    // Electron main process's directory (the app's install/dev path), and Claude
    // Code bakes THAT "working directory" into its reply — which is how a prompt
    // enhanced for one project leaked another project's absolute paths.
    const safeCwd = cwd && isAbsolute(cwd) && existsSync(cwd) ? cwd : undefined
    let child
    try {
      child = spawn('claude', ['-p', '--output-format', 'json', '--append-system-prompt', system], {
        cwd: safeCwd,
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
 * Run any OpenAI-compatible Chat Completions endpoint and return the assistant
 * text. `url` is the full `.../chat/completions` URL; `apiKey` is optional (local
 * servers like Ollama / LM Studio need none); `label` names the provider in error
 * messages. This powers hosted OpenAI and both local providers.
 */
export function runOpenAICompatible(
  url: string,
  model: string,
  label: string,
  apiKey?: string
): RunModel {
  return async (system, prompt) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    }).catch((e) => {
      throw new Error(`${label} request failed: ${(e as Error).message}`)
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      throw new Error(`${label} failed: HTTP ${r.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`)
    }
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content ?? ''
  }
}

/**
 * Run OpenAI's Chat Completions API. Used when the user picked OpenAI as the
 * learning provider — a thin wrapper over {@link runOpenAICompatible}.
 */
export function runOpenAI(apiKey: string, model: string): RunModel {
  return runOpenAICompatible('https://api.openai.com/v1/chat/completions', model, 'OpenAI', apiKey)
}

/**
 * Run a local OpenAI-compatible server (Ollama / LM Studio). Both expose
 * `{baseUrl}/v1/chat/completions` and need no API key. `baseUrl` is the server
 * root the user configured on the Settings page (e.g. `http://127.0.0.1:11434`).
 */
export function runLocalOpenAI(baseUrl: string, model: string, label: string): RunModel {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
  return runOpenAICompatible(url, model, label)
}

/**
 * Run OpenRouter (openrouter.ai) — one key, 200+ models, OpenAI-compatible. Same
 * Chat Completions shape as OpenAI with a different base URL; model ids are
 * namespaced like `openai/gpt-4o-mini` or `anthropic/claude-3.5-sonnet`. The
 * optional Referer/X-Title headers are courtesy attribution, not required.
 */
export function runOpenRouter(apiKey: string, model: string): RunModel {
  return async (system, prompt) => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/abdulmahdi3/URterminal',
        'X-Title': 'URterminal'
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    }).catch((e) => {
      throw new Error(`OpenRouter request failed: ${(e as Error).message}`)
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      throw new Error(`OpenRouter failed: HTTP ${r.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`)
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

/** Fallback model id per provider when the user hasn't picked one. Local
 *  providers have no universal default (depends what's installed); '' forces the
 *  user to pick a discovered model. */
const DEFAULT_MODEL_BY_PROVIDER: Record<Exclude<LearningProvider, 'claude-cli'>, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  openrouter: 'openai/gpt-4o-mini',
  ollama: 'llama3.1',
  lmstudio: ''
}

/**
 * Base URL for a local provider, read fresh from the shared settings store so it
 * tracks whatever the user set on the Settings page. Falls back to the documented
 * default if settings are unavailable.
 */
function localBaseUrl(provider: 'ollama' | 'lmstudio'): string {
  try {
    const url = new SettingsStore().getLocalBaseUrl(provider).trim()
    if (url) return url
  } catch {
    /* settings store unavailable — use the documented default */
  }
  return defaultLocalBaseUrl(provider)
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

  // Local providers (Ollama / LM Studio): no API key; base URL comes from the
  // shared settings store. The model id must be one the user picked/discovered.
  if (provider === 'ollama' || provider === 'lmstudio') {
    const model = cfg.providerModel || DEFAULT_MODEL_BY_PROVIDER[provider]
    if (!model) {
      return () =>
        Promise.reject(
          new Error(`Pick an installed ${provider} model in Learning settings, then retry.`)
        )
    }
    const label = provider === 'ollama' ? 'Ollama' : 'LM Studio'
    return runLocalOpenAI(localBaseUrl(provider), model, label)
  }

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
    case 'openrouter':
      return runOpenRouter(key, model)
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
