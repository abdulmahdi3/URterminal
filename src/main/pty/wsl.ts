import { execFile } from 'child_process'

export interface WslDistro {
  name: string
  /** the distro `wsl.exe` launches when no `-d` is given */
  default: boolean
}

/** Docker Desktop's internal distros — never useful as interactive shells. */
const HIDDEN = new Set(['docker-desktop', 'docker-desktop-data'])

function run(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      args,
      { windowsHide: true, timeout: 4000, encoding: 'buffer' },
      (err, stdout) =>
        // wsl.exe emits UTF-16LE; decode (keep spaces — `--verbose` is columnar)
        resolve(err || !stdout ? '' : Buffer.from(stdout).toString('utf16le'))
    )
  })
}

/** Strip the BOM and CRs WSL sprinkles through its output (keeps spaces). */
function clean(line: string): string {
  return line.replace(/﻿/g, '').replace(/\r/g, '').trim()
}

/**
 * Installed WSL distributions on Windows (empty everywhere else), with Docker's
 * internal distros filtered out and the default distro flagged + listed first.
 * The default is read from `--list --verbose`, whose leading `*` marker is
 * locale-independent (unlike the `--status` text).
 */
export async function listWslDistros(): Promise<WslDistro[]> {
  if (process.platform !== 'win32') return []

  const [quiet, verbose] = await Promise.all([
    run(['--list', '--quiet']),
    run(['--list', '--verbose'])
  ])

  const names = quiet
    .split(/\r?\n/)
    .map((l) => clean(l))
    .filter((n) => n && !HIDDEN.has(n))

  // Find the default distro: the `--verbose` row whose first non-space char is `*`.
  let defaultName: string | null = null
  for (const raw of verbose.split(/\r?\n/)) {
    const line = clean(raw)
    if (line.startsWith('*')) {
      defaultName = line.replace(/^\*/, '').trim().split(/\s+/)[0] || null
      break
    }
  }

  const distros = names.map((name) => ({ name, default: name === defaultName }))
  // Surface the default first.
  distros.sort((a, b) => Number(b.default) - Number(a.default))
  return distros
}
