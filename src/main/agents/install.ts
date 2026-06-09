import { exec } from 'child_process'

export interface AgentInstallResult {
  ok: boolean
  error?: string
}

/**
 * Run an agent's install command (e.g. `npm i -g @anthropic-ai/claude-code`) and
 * resolve when it finishes. Runs through the OS shell so package-manager commands
 * resolve as the user would type them. Output is discarded; only success/failure
 * + a short error tail is reported back. A generous timeout covers slow installs.
 */
export function installAgent(command: string): Promise<AgentInstallResult> {
  return new Promise((resolve) => {
    const cmd = command.trim()
    if (!cmd) {
      resolve({ ok: false, error: 'No install command for this agent.' })
      return
    }
    exec(
      cmd,
      { timeout: 240000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || '').toString().trim()
          resolve({ ok: false, error: msg.slice(-400) || 'Install failed.' })
          return
        }
        resolve({ ok: true })
      }
    )
  })
}
