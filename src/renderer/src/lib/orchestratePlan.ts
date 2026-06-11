/**
 * Pure orchestration planning — no renderer/store/xterm imports, so it's
 * unit-testable in the node test environment. The stateful fan-out + result
 * collection lives in orchestrate.ts.
 */

/** Split a textarea body into trimmed, non-empty subtask lines. */
export function parseSubtasks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/** The prompt a single worker receives: the shared goal as context + its subtask. */
export function composeWorkerPrompt(goal: string, subtask: string): string {
  const g = goal.trim()
  const s = subtask.trim()
  if (!g) return s
  return [
    'You are one worker in a small team of agents working toward a shared goal.',
    `Shared goal: ${g}`,
    '',
    `Your subtask — focus only on this part: ${s}`
  ].join('\n')
}

/** A short pane label/title for a subtask. */
export function workerLabel(subtask: string, max = 24): string {
  const s = subtask.trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Assemble a markdown report from each worker's latest answer. */
export function buildReport(goal: string, results: { subtask: string; answer: string }[]): string {
  const lines: string[] = ['# Orchestration report', '', `**Goal:** ${goal.trim() || '(none)'}`, '']
  results.forEach((r, i) => {
    lines.push(`## Worker ${i + 1}: ${r.subtask}`, '', r.answer.trim() || '_(no answer captured yet)_', '')
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
