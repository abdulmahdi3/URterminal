// Remembers the last folder an agent was opened in, so the launcher form can
// prefill it and the user can re-open with one click.
const KEY = 'urterminal.lastAgentCwd'

export function getLastAgentCwd(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setLastAgentCwd(cwd: string): void {
  try {
    if (cwd) localStorage.setItem(KEY, cwd)
  } catch {
    /* ignore */
  }
}
