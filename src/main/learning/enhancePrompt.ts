/**
 * Pure builders for the "AI prompt enhancer" — rewrite a user's rough request
 * into a clear, complete agent instruction, grounded in the learned brain
 * memory. Kept free of fs/electron imports so it can be unit-tested.
 */

export interface EnhanceMemory {
  title: string
  body: string
}
export interface EnhanceSkill {
  name: string
  description?: string
}

export const ENHANCE_SYSTEM = [
  'You are a prompt enhancer for a coding agent.',
  "Rewrite the user's rough request into a single, clear, complete instruction the agent can act on.",
  'Use the provided MEMORY (durable facts, conventions and preferences learned from past sessions) to',
  'fill in context, naming and constraints — but do NOT invent requirements the user did not imply,',
  "and keep the user's original intent and scope.",
  'Refer to the codebase generically as "this project". Do NOT add, guess, or include any absolute',
  'filesystem paths, drive letters, directory names, or working-directory locations — not even ones from',
  'your own runtime environment — unless the user wrote them in their request.',
  'Output ONLY the rewritten request as plain text: no preamble, no surrounding quotes, no explanation,',
  'no markdown headers.'
].join(' ')

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Build the model prompt body: a compact MEMORY/SKILLS block + the request. */
export function buildEnhancePrompt(
  userPrompt: string,
  memories: EnhanceMemory[],
  skills: EnhanceSkill[]
): string {
  const mem = memories.length
    ? memories.map((m) => `- ${oneLine(m.title)}: ${oneLine(m.body).slice(0, 280)}`).join('\n')
    : '(no memory recorded yet)'
  const sk = skills.length
    ? skills.map((s) => `- ${oneLine(s.name)}${s.description ? `: ${oneLine(s.description)}` : ''}`).join('\n')
    : ''
  return [
    'MEMORY:',
    mem,
    ...(sk ? ['', 'SKILLS:', sk] : []),
    '',
    'USER REQUEST:',
    userPrompt.trim(),
    '',
    'Rewritten request:'
  ].join('\n')
}
