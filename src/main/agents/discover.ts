import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { app } from 'electron'
import { AGENT_REGISTRY, type AgentDescriptor, type AgentDiscovery } from '@shared/providers'
import { commandExists } from '../pty/which'
import { discoverModels } from '../providers/discoverModels'

/**
 * Runtime agent discovery — the dynamic layer on top of the built-in registry.
 *
 * Sources, merged by id (later sources extend/override earlier ones):
 *   1. built-in AGENT_REGISTRY (always present)
 *   2. a user manifest (agents.json) — declare any CLI with no rebuild
 *   3. installed GitHub `gh` agent extensions (e.g. `gh copilot`)
 *
 * Then each merged agent is PATH-probed so the renderer can show only what's
 * actually installed. All steps are best-effort: a bad manifest or a missing
 * `gh` never throws — discovery just falls back to fewer agents.
 */

/** Candidate locations for the user manifest, checked in order. */
function manifestPaths(): string[] {
  const paths = [join(homedir(), '.config', 'urterminal', 'agents.json')]
  try {
    paths.push(join(app.getPath('userData'), 'agents.json'))
  } catch {
    /* app not ready / unavailable in some contexts */
  }
  return paths
}

/** Read + validate the user manifest. Tolerates a missing file or partial entries. */
function loadManifest(): AgentDescriptor[] {
  const out: AgentDescriptor[] = []
  for (const path of manifestPaths()) {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      continue // file not present — fine
    }
    try {
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.agents) ? parsed.agents : []
      for (const e of list) {
        if (e && typeof e.id === 'string' && e.id) {
          out.push({
            id: e.id,
            label: typeof e.label === 'string' && e.label ? e.label : e.id,
            bin: typeof e.bin === 'string' ? e.bin : undefined,
            launchArgs: Array.isArray(e.launchArgs) ? e.launchArgs.map(String) : undefined,
            detect: Array.isArray(e.detect) ? e.detect.map(String) : undefined,
            resumeArgs: Array.isArray(e.resumeArgs) ? e.resumeArgs.map(String) : undefined,
            installHint: typeof e.installHint === 'string' ? e.installHint : undefined,
            supports:
              e.supports && typeof e.supports === 'object'
                ? { streamJson: !!e.supports.streamJson }
                : undefined,
            source: 'manifest'
          })
        }
      }
    } catch {
      console.warn(`[agents] ignoring malformed manifest: ${path}`)
    }
  }
  return out
}

/**
 * Known GitHub `gh` extensions that behave as agents. Only allow-listed ones are
 * surfaced — `gh extension list` also contains non-agent extensions we must not
 * pollute the launcher with. Add an entry here to support another gh agent.
 */
const GH_AGENT_EXTENSIONS: Record<string, AgentDescriptor> = {
  'gh-copilot': {
    id: 'gh-copilot',
    label: 'GitHub Copilot (gh)',
    bin: 'gh',
    launchArgs: ['copilot'],
    detect: ['gh', 'copilot'],
    installHint: 'gh extension install github/gh-copilot',
    source: 'gh-extension'
  }
}

/** Scan installed `gh` extensions and return descriptors for the agent-like ones. */
function scanGhExtensions(): AgentDescriptor[] {
  if (!commandExists('gh')) return []
  let output: string
  try {
    output = execFileSync('gh', ['extension', 'list'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true
    })
  } catch {
    return [] // gh present but no extensions / command failed
  }
  const found: AgentDescriptor[] = []
  for (const [key, desc] of Object.entries(GH_AGENT_EXTENSIONS)) {
    // a line looks like:  gh copilot   github/gh-copilot   v1.x.x
    if (output.includes(key)) found.push(desc)
  }
  return found
}

/** The base program checked on PATH to decide whether an agent is installed. */
function probeCommand(a: AgentDescriptor): string {
  return a.detect?.[0] ?? a.bin ?? a.id
}

/**
 * Each installed Ollama model surfaced as a launchable chat agent — opening one
 * spawns `ollama run <model>`, Ollama's native interactive REPL, in a pane. This
 * needs the `ollama` CLI on PATH (that's what makes it a real terminal chat), so
 * we skip discovery entirely when it's absent. LM Studio is intentionally NOT
 * included: it ships no interactive CLI (GUI + an OpenAI server only), so there's
 * nothing to spawn — it stays a provider for the model picker + learning layer.
 */
async function discoverLocalModelAgents(ollamaBaseUrl?: string): Promise<AgentDescriptor[]> {
  if (!commandExists('ollama')) return []
  let models: string[] = []
  try {
    models = await discoverModels('ollama', ollamaBaseUrl)
  } catch {
    return [] // server down / unreachable — no model agents this round
  }
  return models.map((m) => ({
    id: `ollama:${m}`,
    label: `Ollama · ${m}`,
    bin: 'ollama',
    launchArgs: ['run', m],
    detect: ['ollama'],
    installHint: 'Install Ollama from https://ollama.com',
    source: 'local-model' as const
  }))
}

export async function discoverAgents(ollamaBaseUrl?: string): Promise<AgentDiscovery> {
  // Merge by id, preserving first-seen order. Built-ins seed the map; manifest
  // entries extend/override them; gh extensions + local models append (never
  // clobber a builtin).
  const byId = new Map<string, AgentDescriptor>()
  for (const a of AGENT_REGISTRY) byId.set(a.id, { ...a, source: 'builtin' })
  for (const a of loadManifest()) byId.set(a.id, { ...byId.get(a.id), ...a })
  for (const a of scanGhExtensions()) if (!byId.has(a.id)) byId.set(a.id, a)
  for (const a of await discoverLocalModelAgents(ollamaBaseUrl)) if (!byId.has(a.id)) byId.set(a.id, a)

  const agents = [...byId.values()]
  const available = agents.filter((a) => commandExists(probeCommand(a))).map((a) => a.id)
  return { agents, available }
}
