import { app } from 'electron'
import { join } from 'path'
import { readMcp, writeMcp } from '../mcp/config'

/**
 * Wiring for the BridgeMemory MCP server (resources/bridge-mcp.mjs): resolve its
 * on-disk path (works in dev and from inside the packaged asar.unpacked), and
 * register it into a project's `.mcp.json` so agents launched there get the hub
 * tools. The agent is the MCP host; we just curate the config it reads.
 */
export function bridgeServerPath(): string {
  // resources/** is asarUnpack'd, so a spawned `node` must read the unpacked copy.
  const base = app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
  return join(base, 'resources', 'bridge-mcp.mjs')
}

/** Add (or refresh) the `bridgememory` MCP server in `cwd`'s .mcp.json. */
export function connectAgents(cwd: string): { ok: boolean; error?: string } {
  if (!cwd) return { ok: false, error: 'This pane has no folder.' }
  const servers = readMcp(cwd).filter((s) => s.name !== 'bridgememory')
  servers.push({ name: 'bridgememory', command: 'node', args: [bridgeServerPath()] })
  return writeMcp(cwd, servers)
}
