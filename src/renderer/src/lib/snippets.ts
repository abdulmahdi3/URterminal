import type { SnippetItem } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'
import { injectText } from '@renderer/lib/inject'
import { toast } from '@renderer/store/toasts'

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g

/** Unique {{variable}} names found in a snippet body, in first-seen order. */
export function parseVariables(body: string): string[] {
  const seen: string[] = []
  let m: RegExpExecArray | null
  VAR_RE.lastIndex = 0
  while ((m = VAR_RE.exec(body))) if (!seen.includes(m[1])) seen.push(m[1])
  return seen
}

/** Substitute {{variable}} placeholders with the provided values. */
export function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(VAR_RE, (_full, name: string) => values[name] ?? '')
}

/**
 * Insert a snippet into the active pane (pasted, not submitted, so it can be
 * reviewed/edited). If it contains {{variables}}, open the fill modal first.
 */
export function insertSnippet(snippet: SnippetItem): void {
  if (parseVariables(snippet.body).length) {
    useUi.getState().setFillSnippet(snippet)
    return
  }
  const id = useWorkspace.getState().activePaneId
  if (!id) {
    toast('No active pane to insert into', 'info')
    return
  }
  if (!injectText(id, snippet.body, false)) toast('Active pane has no running terminal', 'info')
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}
