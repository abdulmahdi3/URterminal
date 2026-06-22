/**
 * Uregant Claude Crew roster (Phase 3). Lightweight metadata shared with the
 * renderer (Registry → Agents tab). The full subagent markdown (frontmatter +
 * system prompt) is built in src/main/uregant/crewAgents.ts from this list.
 */
export interface UregantCrewRole {
  /** subagent name = filename stem (.claude/agents/<name>.md) */
  name: string
  role: string
  /** Claude model alias */
  model: 'opus' | 'sonnet' | 'haiku'
  blurb: string
  /** human-readable tool summary for the UI */
  tools: string
}

export const UREGANT_CREW: UregantCrewRole[] = [
  { name: 'uregant-planner', role: 'Planner', model: 'opus', blurb: 'Breaks a goal into a step plan and coordinates the other roles.', tools: 'read + delegate + panes' },
  { name: 'uregant-architect', role: 'Architect', model: 'opus', blurb: 'Designs the approach and key trade-offs before code is written.', tools: 'read-only' },
  { name: 'uregant-coder', role: 'Coder', model: 'sonnet', blurb: 'Implements features and fixes across files.', tools: 'full' },
  { name: 'uregant-reviewer', role: 'Reviewer', model: 'sonnet', blurb: 'Reviews diffs for correctness and quality.', tools: 'read + code-review' },
  { name: 'uregant-security', role: 'Security', model: 'opus', blurb: 'Audits changes for vulnerabilities, secrets and CWEs.', tools: 'read + security-review' },
  { name: 'uregant-debugger', role: 'Debugger', model: 'sonnet', blurb: 'Reproduces and fixes bugs in a tight loop.', tools: 'full' },
  { name: 'uregant-tester', role: 'Tester', model: 'sonnet', blurb: 'Writes and runs tests, chases edge cases.', tools: 'full' }
]
