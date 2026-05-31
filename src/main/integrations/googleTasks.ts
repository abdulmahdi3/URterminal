import type { SettingsStore } from '../settings/store'
import type { GoogleTask, GoogleTaskList, GoogleTaskGroup } from '@shared/types'

/**
 * Google Tasks REST client (main-process only).
 *
 * Google's full OAuth code-grant needs a registered client + a loopback flow;
 * to stay consistent with the other "paste a token" integrations, the user
 * pastes an OAuth access token with the Tasks scope (e.g. from the OAuth
 * Playground) into Settings → Integrations. We store it encrypted and attach it
 * as `Authorization: Bearer <token>` to every call; a 401 clears it so the
 * renderer prompts for reconnect.
 *
 * API reference: https://developers.google.com/tasks/reference/rest
 */
const API_BASE = 'https://tasks.googleapis.com/tasks/v1'

export class GoogleTasksError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'GoogleTasksError'
  }
}

/** Map a raw Google Tasks API task object to our trimmed GoogleTask shape. */
export function normalizeGoogleTask(raw: Record<string, unknown>): GoogleTask {
  return {
    id: String(raw.id ?? ''),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : '(untitled)',
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    status: raw.status === 'completed' ? 'completed' : 'needsAction',
    due: typeof raw.due === 'string' ? raw.due : undefined,
    completed: typeof raw.completed === 'string' ? raw.completed : undefined,
    updated: typeof raw.updated === 'string' ? raw.updated : undefined
  }
}

/** YYYY-MM-DD from a Google `due` RFC-3339 timestamp (date part only). */
export function dueDateOnly(due: string | undefined): string | undefined {
  if (!due) return undefined
  return due.slice(0, 10)
}

/**
 * Render lists + their open tasks as a compact plain-text agenda, suitable for
 * pasting into a pane or sending over Telegram. Empty lists are skipped.
 */
export function formatGoogleAgenda(groups: GoogleTaskGroup[]): string {
  const lines: string[] = []
  let total = 0
  for (const { list, tasks } of groups) {
    const open = tasks.filter((t) => t.status !== 'completed')
    if (open.length === 0) continue
    lines.push(`📋 ${list.title}`)
    for (const t of open) {
      const due = dueDateOnly(t.due)
      lines.push(`  • ${t.title}${due ? ` (due ${due})` : ''}`)
      total++
    }
    lines.push('')
  }
  if (total === 0) return 'No open Google Tasks. 🎉'
  return lines.join('\n').trimEnd()
}

export class GoogleTasksClient {
  constructor(private settings: SettingsStore) {}

  /** Whether an access token has been saved for Google Tasks. */
  isReady(): boolean {
    return !!this.settings.getIntegrationToken('googleTasks')
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.settings.getIntegrationToken('googleTasks')
    if (!token) throw new GoogleTasksError('Not connected to Google Tasks.', 401)
    const r = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {})
      }
    })
    if (r.status === 401) {
      this.settings.setIntegrationToken('googleTasks', null)
      throw new GoogleTasksError('Google Tasks token expired — please reconnect.', 401)
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new GoogleTasksError(`Google Tasks ${r.status}: ${text}`.trim(), r.status)
    }
    const text = await r.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Validate the saved token by hitting the lists endpoint. */
  async verify(): Promise<void> {
    await this.listTaskLists()
  }

  async listTaskLists(): Promise<GoogleTaskList[]> {
    const r = await this.call<{ items?: Array<Record<string, unknown>> }>('/users/@me/lists?maxResults=100')
    return (r?.items ?? []).map((l) => ({ id: String(l.id ?? ''), title: String(l.title ?? '(untitled list)') }))
  }

  async listTasks(listId = '@default', showCompleted = false): Promise<GoogleTask[]> {
    const params = new URLSearchParams({
      maxResults: '100',
      showCompleted: String(showCompleted),
      showHidden: 'false'
    })
    const r = await this.call<{ items?: Array<Record<string, unknown>> }>(
      `/lists/${encodeURIComponent(listId)}/tasks?${params.toString()}`
    )
    return (r?.items ?? []).map(normalizeGoogleTask)
  }

  createTask(listId: string, input: { title: string; notes?: string; due?: string }): Promise<GoogleTask> {
    return this.call<Record<string, unknown>>(`/lists/${encodeURIComponent(listId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input)
    }).then(normalizeGoogleTask)
  }

  completeTask(listId: string, taskId: string): Promise<void> {
    return this.call<void>(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' })
    })
  }

  /**
   * Patch a task's editable fields. `due` accepts an RFC-3339 string to set it
   * or `null` to clear it; `status` toggles complete/needsAction (clearing it
   * back to needsAction also drops the stored completion time on Google's side).
   */
  updateTask(
    listId: string,
    taskId: string,
    patch: { title?: string; notes?: string | null; due?: string | null; status?: GoogleTask['status'] }
  ): Promise<GoogleTask> {
    return this.call<Record<string, unknown>>(
      `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    ).then(normalizeGoogleTask)
  }

  deleteTask(listId: string, taskId: string): Promise<void> {
    return this.call<void>(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE'
    })
  }

  /** Fetch every list and its open tasks, grouped (for the agenda). */
  async getAgendaGroups(): Promise<GoogleTaskGroup[]> {
    const lists = await this.listTaskLists()
    const groups: GoogleTaskGroup[] = []
    for (const list of lists) {
      const tasks = await this.listTasks(list.id, false)
      groups.push({ list, tasks })
    }
    return groups
  }

  /** Convenience: full agenda as ready-to-display text. */
  async agendaText(): Promise<string> {
    return formatGoogleAgenda(await this.getAgendaGroups())
  }
}
