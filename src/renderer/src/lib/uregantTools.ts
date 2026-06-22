/**
 * Renderer-side tool executor for Uregant (UREGANT_PLAN.md §7).
 * Pane tools run here (direct useWorkspace / terminalPool access); run_command is
 * delegated to main (headless). All tool-result text fed back to the model is
 * wrapped in an untrusted-data envelope with bidi controls stripped (§11.1).
 */
import type { UrToolCall, UrToolResult } from '@shared/uregant'
import { useWorkspace } from '../store/workspace'
import { pasteText, getScreenText, getFullText } from './terminalPool'

// Bidi controls to strip: U+202A–U+202E (LRE/RLE/PDF/LRO/RLO) and U+2066–U+2069
// (LRI/RLI/FSI/PDI). Numeric codepoints keep these invisible chars out of source.
const BIDI_CODES = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])

export function stripBidi(s: string): string {
  let out = ''
  for (const ch of s) if (!BIDI_CODES.has(ch.codePointAt(0) ?? 0)) out += ch
  return out
}

/** Wrap a tool result as untrusted data the model must treat as information only. */
export function wrapUntrusted(toolName: string, value: unknown): string {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  return `<tool_result tool="${toolName}" trust="untrusted">\n${stripBidi(text).slice(0, 6000)}\n</tool_result>`
}

export async function executeTool(call: UrToolCall): Promise<UrToolResult> {
  const name = call.function.name
  const a = call.function.arguments ?? {}
  try {
    switch (name) {
      case 'open_pane': {
        const type = a.type === 'ai' ? 'ai' : 'shell'
        const id = useWorkspace.getState().addPane(type, undefined, {
          label: typeof a.label === 'string' ? a.label : undefined,
          agentCwd: typeof a.cwd === 'string' ? a.cwd : undefined
        })
        if (!id) return { ok: false, error: 'pane limit reached (max 9)' }
        return { ok: true, value: { paneId: id, type } }
      }
      case 'write_to_pane': {
        const paneId = String(a.paneId ?? '')
        const text = String(a.text ?? '')
        const pane = useWorkspace.getState().panes[paneId]
        if (!pane) return { ok: false, error: `no pane ${paneId}` }
        pasteText(paneId, text)
        if (a.submit) {
          const ptyId = pane.shell?.ptyId ?? pane.agent?.ptyId
          if (ptyId) window.setTimeout(() => window.api.writePty(ptyId, '\r'), 250)
        }
        return { ok: true, value: 'typed' }
      }
      case 'read_pane': {
        const paneId = String(a.paneId ?? '')
        if (!useWorkspace.getState().panes[paneId]) return { ok: false, error: `no pane ${paneId}` }
        const text = a.full ? getFullText(paneId) : getScreenText(paneId)
        return { ok: true, value: text.slice(-4000) }
      }
      case 'run_command': {
        const res = await window.api.uregant.exec({
          command: String(a.command ?? ''),
          cwd: typeof a.cwd === 'string' ? a.cwd : undefined
        })
        if (!res.ok) return { ok: false, error: res.error ?? res.stderr ?? `exit ${res.exitCode}` }
        return { ok: true, value: { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode } }
      }
      case 'list_panes': {
        const panes = useWorkspace.getState().panes
        return {
          ok: true,
          value: Object.values(panes).map((p) => ({ id: p.id, type: p.type, title: p.title }))
        }
      }
      case 'done':
        return { ok: true, value: String(a.summary ?? 'done') }
      default:
        return { ok: false, error: `unknown tool ${name}` }
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
