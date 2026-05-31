import { spawn } from 'child_process'
import type { RunModel } from './distiller'
import type { LearningConfig } from './store'

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

/** Pick the model runner for the configured backend. */
export function getRunModel(cfg: LearningConfig): RunModel {
  switch (cfg.model) {
    case 'claude-cli-headless':
      return runClaudeHeadless
    case 'provider-api':
      return () => Promise.reject(new Error('provider-api distillation not yet wired — choose Claude CLI in settings'))
    case 'local':
      return () => Promise.reject(new Error('local-model distillation not yet wired — choose Claude CLI in settings'))
    default:
      return runClaudeHeadless
  }
}
