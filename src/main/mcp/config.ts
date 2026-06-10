import { readFileSync, writeFileSync } from 'fs'
import { join, isAbsolute } from 'path'

/**
 * Read/write the project-level `.mcp.json` that agents like Claude Code load to
 * discover MCP servers. URterminal just curates that file for the user — the
 * agent is the MCP host. Other top-level keys in the file are preserved.
 */
export interface McpServer {
  name: string
  command: string
  args: string[]
}

function file(cwd: string): string {
  return join(cwd, '.mcp.json')
}

export function readMcp(cwd: string): McpServer[] {
  if (!cwd || !isAbsolute(cwd)) return []
  try {
    const data = JSON.parse(readFileSync(file(cwd), 'utf8')) as {
      mcpServers?: Record<string, { command?: string; args?: unknown }>
    }
    return Object.entries(data.mcpServers ?? {}).map(([name, v]) => ({
      name,
      command: v.command ?? '',
      args: Array.isArray(v.args) ? (v.args as string[]) : []
    }))
  } catch {
    return []
  }
}

export function writeMcp(cwd: string, servers: McpServer[]): { ok: boolean; error?: string } {
  if (!cwd || !isAbsolute(cwd)) return { ok: false, error: 'This pane has no folder.' }
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(readFileSync(file(cwd), 'utf8')) as Record<string, unknown>
  } catch {
    /* new file */
  }
  const map: Record<string, { command: string; args: string[] }> = {}
  for (const s of servers) {
    if (s.name.trim() && s.command.trim()) {
      map[s.name.trim()] = { command: s.command.trim(), args: s.args.filter((a) => a.trim()) }
    }
  }
  data.mcpServers = map
  try {
    writeFileSync(file(cwd), JSON.stringify(data, null, 2))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
