import { app } from 'electron'
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * On-disk home + config for the learning layer. Everything lives under
 * `{userData}/learning/` so it sits next to the app's other state and is local
 * to the machine (never synced, never sent anywhere in this slice).
 *
 *   {userData}/learning/
 *     config.json
 *     projects/{projectHash}/transcripts/{YYYY-MM-DD}.jsonl
 *
 * Config is a flat JSON blob with get/merge/set, mirroring SettingsStore's idiom
 * but kept separate so the learning feature is self-contained and the master
 * switch defaults OFF (opt-in).
 */

export interface LearningConfig {
  /** Master switch. The entire layer is inert unless this is true. */
  enabled: boolean
  /** Record turns to local disk. (Distillation/egress are separate, later.) */
  capture: boolean
  /** Capture only AI-agent panes, skipping plain shells/SSH (cuts noise). */
  aiOnly: boolean
  /** ms of output silence that closes an agent turn. */
  turnIdleMs: number
  /** Hard cap on bytes buffered per turn (older bytes dropped, turn flagged). */
  maxTurnBytes: number
  /** Days to keep transcripts before pruning (enforced in a later slice). */
  retentionDays: number
  /** Extra user regexes added to the secret scrubber. */
  scrubExtraPatterns: string[]
  // ---- reserved for later slices (distill / inject); defaulted now so the
  //      config shape is forward-compatible and the UI can bind to it early.
  egressAllowed: boolean
  autoApprove: boolean
  /** When autoApprove is on, only ops at/above this confidence skip review. */
  autoApproveMinConfidence: number
  injectionPassive: boolean
  injectionActive: boolean
  /**
   * Which model distills transcripts into memory/skills (later slice). Default
   * 'claude-cli-headless' spawns the user's already-authenticated Claude Code
   * CLI — no new API key, same trust boundary they already accepted. Users can
   * switch to 'provider-api' (own key) or 'local' (zero egress) in settings.
   */
  model: 'claude-cli-headless' | 'provider-api' | 'local'
  distillIdleMs: number
  minTurns: number
  minClusterSupport: number
  maxInjectBytes: number
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  enabled: false,
  capture: true,
  aiOnly: true,
  turnIdleMs: 1500,
  maxTurnBytes: 262144,
  retentionDays: 30,
  scrubExtraPatterns: [],
  egressAllowed: false,
  autoApprove: false,
  autoApproveMinConfidence: 0.75,
  injectionPassive: true,
  injectionActive: false,
  model: 'claude-cli-headless',
  distillIdleMs: 90000,
  minTurns: 6,
  minClusterSupport: 2,
  maxInjectBytes: 8192
}

function root(): string {
  return join(app.getPath('userData'), 'learning')
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

const configPath = (): string => join(root(), 'config.json')

let cached: LearningConfig | null = null

export function getLearningConfig(): LearningConfig {
  if (cached) return cached
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<LearningConfig>
    cached = { ...DEFAULT_LEARNING_CONFIG, ...raw }
  } catch {
    cached = { ...DEFAULT_LEARNING_CONFIG }
  }
  return cached
}

export function setLearningConfig(patch: Partial<LearningConfig>): LearningConfig {
  const next = { ...getLearningConfig(), ...patch }
  cached = next
  try {
    ensureDir(root())
    writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* best-effort persist — never crash on a config write */
  }
  return next
}

/** Absolute path to the learning store root (for "reveal in file manager"). */
export function learningRoot(): string {
  return root()
}

function dayStamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** One reconstructed turn (user prompt + the agent output that followed). */
export interface TurnRecord {
  v: number
  turnId: string
  ts: number
  paneId: string
  sessionId: string
  agentId: string
  cwd: string
  projectHash: string
  turnIndex: number
  user: { text: string; ts: number } | null
  agent: { text: string; durationMs: number; exitMarker: string }
  /**
   * How `agent.text` was captured. 'ansi-scrape' (the only value today) means it
   * was assembled from the raw terminal stream with control codes stripped. A
   * later slice can launch agents in a structured/headless mode and record
   * 'stream-json' for higher-fidelity input to distillation.
   */
  channel: 'ansi-scrape' | 'stream-json'
  scrubbed: boolean
  truncated: boolean
}

/** Append one assembled, already-scrubbed turn to the per-project/day JSONL. */
export function appendTurn(rec: TurnRecord): void {
  try {
    const dir = join(root(), 'projects', rec.projectHash, 'transcripts')
    ensureDir(dir)
    appendFileSync(join(dir, `${dayStamp(rec.ts)}.jsonl`), JSON.stringify(rec) + '\n', 'utf8')
  } catch {
    /* capture must never crash the app — drop the record on any IO error */
  }
}

/**
 * Load recent turns for a project from the newest transcript files (for the
 * distiller, which needs the full text behind a candidate's turnIds). Reads at
 * most `maxFiles` day-files newest-first; tolerates missing/corrupt lines.
 */
export function readTurnsForProject(projectHash: string, maxFiles = 3): TurnRecord[] {
  const dir = join(root(), 'projects', projectHash, 'transcripts')
  let files: string[]
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .slice(-maxFiles)
  } catch {
    return []
  }
  const out: TurnRecord[] = []
  for (const f of files) {
    let raw: string
    try {
      raw = readFileSync(join(dir, f), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as TurnRecord)
      } catch {
        /* skip a corrupt line */
      }
    }
  }
  return out
}
