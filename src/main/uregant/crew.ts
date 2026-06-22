/**
 * Uregant Claude Crew bridge wiring (Phase 3, §8). The actual MCP server is the
 * standalone resources/uregant-mcp.mjs (stdio -> ControlServer HTTP). These
 * helpers resolve its path, persist the control-server {port, token} into a
 * userData file the bridge reads (so no secret lands in the repo's .mcp.json),
 * and register the bridge in a folder's .mcp.json so a `claude` pane picks it up.
 */
import { app } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMcp, writeMcp } from '../mcp/config'

/** Absolute path to the bundled bridge (asar-unpacked when packaged). */
export function bridgeServerPath(): string {
  const base = app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
  return join(base, 'resources', 'uregant-mcp.mjs')
}

/** userData file the bridge reads for the control server's port + token. */
export function controlConfigPath(): string {
  return join(app.getPath('userData'), 'uregant-control.json')
}

export function writeControlConfig(port: number, token: string): void {
  try {
    writeFileSync(controlConfigPath(), JSON.stringify({ port, token }), 'utf8')
  } catch {
    /* best-effort */
  }
}

/** Register (or refresh) the uregant-panes MCP server in a folder's .mcp.json. */
export function registerCrewMcp(cwd: string): { ok: boolean; error?: string } {
  const servers = readMcp(cwd).filter((s) => s.name !== 'uregant-panes')
  servers.push({
    name: 'uregant-panes',
    command: 'node',
    args: [bridgeServerPath(), '--config', controlConfigPath()]
  })
  return writeMcp(cwd, servers)
}
