/**
 * "Auto-connect Uregant tools when a Claude pane opens" preference (Phase 3).
 * Off by default — opt-in, persisted in localStorage. When on, opening a `claude`
 * pane in a folder auto-registers the MCP bridge + installs the crew there.
 */
const KEY = 'uregant.autocrew'

export function getAutoCrew(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setAutoCrew(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}
