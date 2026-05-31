import { readMemories, readSkills } from './brain'
import { projectHash } from './paths'
import { getRunModel } from './model'
import { getLearningConfig } from './store'
import { ENHANCE_SYSTEM, buildEnhancePrompt } from './enhancePrompt'

/**
 * "AI prompt enhancer depend on memory": rewrite the user's rough request into a
 * clear, complete agent instruction, grounded in the distilled brain memory for
 * the current project (+ global). Uses the same model seam as distillation
 * (default: the user's authenticated Claude CLI, no new key). User-initiated, so
 * it isn't gated by the passive-distillation egress switch.
 */
export async function enhancePrompt(opts: { text: string; cwd?: string }): Promise<string> {
  const text = opts.text.trim()
  if (!text) throw new Error('Nothing to enhance')

  const ph = opts.cwd ? projectHash(opts.cwd) : null
  const memories = [...readMemories(null), ...(ph ? readMemories(ph) : [])].map((m) => ({
    title: m.title,
    body: m.body
  }))
  const skills = [...readSkills(null), ...(ph ? readSkills(ph) : [])].map((s) => ({
    name: s.name,
    description: s.description
  }))

  const run = getRunModel(getLearningConfig())
  const out = await run(ENHANCE_SYSTEM, buildEnhancePrompt(text, memories, skills))
  const trimmed = out.trim()
  if (!trimmed) throw new Error('The enhancer returned nothing')
  return trimmed
}
