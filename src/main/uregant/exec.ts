import { exec } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import type { UrExecRequest, UrExecResult } from '@shared/uregant'
import { isHardDenied } from './safety'

/**
 * Headless command execution for the run_command tool (UREGANT_PLAN.md §7).
 * Returns {ok, stdout, stderr, exitCode} deterministically — never throws across
 * the loop. Blocked by the §11.2 hard-deny tripwire before spawning.
 */
export function runCommand(req: UrExecRequest): Promise<UrExecResult> {
  return new Promise<UrExecResult>((resolve) => {
    const command = (req.command ?? '').trim()
    if (!command) {
      resolve({ ok: false, stdout: '', stderr: '', exitCode: null, error: 'empty command' })
      return
    }

    const deny = isHardDenied(command)
    if (deny.denied) {
      resolve({
        ok: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        error: `Blocked by Uregant safety policy: ${deny.reason}`
      })
      return
    }

    let cwd: string | undefined = req.cwd?.trim() || undefined
    if (cwd && (!existsSync(cwd) || !statSync(cwd).isDirectory())) {
      resolve({ ok: false, stdout: '', stderr: '', exitCode: null, error: `cwd not found: ${cwd}` })
      return
    }

    exec(
      command,
      { cwd, timeout: req.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const code = (err as { code?: number } | null)?.code
        const exitCode = typeof code === 'number' ? code : err ? 1 : 0
        resolve({
          ok: !err,
          stdout: String(stdout).slice(0, 20_000),
          stderr: String(stderr).slice(0, 8_000),
          exitCode,
          error: err ? err.message : undefined
        })
      }
    )
  })
}
