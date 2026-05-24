import { create } from 'zustand'
import type { MosaicNode } from 'react-mosaic-component'
import type { Pane } from '@shared/types'
import { useWorkspace } from './workspace'

const uid = (): string => Math.random().toString(36).slice(2, 10)

/** A named snapshot of a whole workspace (panes + layout), persisted to disk. */
export interface SavedSession {
  id: string
  name: string
  savedAt: number
  paneCount: number
  panes: Record<string, Pane>
  layout: MosaicNode<string> | null
}

/** Drop runtime-only fields so a restored pane spawns fresh PTYs / no dangling streams. */
function sanitize(panes: Record<string, Pane>): Record<string, Pane> {
  const out: Record<string, Pane> = {}
  for (const [id, p] of Object.entries(panes)) {
    const clone: Pane = { ...p }
    if (clone.shell) clone.shell = { shell: clone.shell.shell }
    if (clone.agent) clone.agent = { command: clone.agent.command, cwd: clone.agent.cwd }
    if (clone.ai) clone.ai = { ...clone.ai, activeStreamId: undefined }
    out[id] = clone
  }
  return out
}

/** Write the session list to the on-disk JSON file (in the app's user-data dir). */
function persist(sessions: SavedSession[]): void {
  void window.api.writeSessions(sessions)
}

interface SessionsState {
  sessions: SavedSession[]
  /** snapshot the current workspace under a name */
  save: (name: string) => void
  /** load a saved session into the current workspace */
  restore: (id: string) => SavedSession | undefined
  remove: (id: string) => void
  rename: (id: string, name: string) => void
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],

  save: (name) => {
    const { panes, layout } = useWorkspace.getState()
    const session: SavedSession = {
      id: uid(),
      name: name.trim() || `Session ${get().sessions.length + 1}`,
      savedAt: Date.now(),
      paneCount: Object.keys(panes).length,
      panes: sanitize(panes),
      layout
    }
    const sessions = [session, ...get().sessions]
    persist(sessions)
    set({ sessions })
  },

  restore: (id) => {
    const session = get().sessions.find((s) => s.id === id)
    if (!session) return undefined
    useWorkspace.getState().hydrate(sanitize(session.panes), session.layout ?? null)
    return session
  },

  remove: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id)
    persist(sessions)
    set({ sessions })
  },

  rename: (id, name) => {
    const sessions = get().sessions.map((s) =>
      s.id === id ? { ...s, name: name.trim() || s.name } : s
    )
    persist(sessions)
    set({ sessions })
  }
}))

// Hydrate from the on-disk file once at startup.
void window.api.readSessions().then((sessions) => {
  if (Array.isArray(sessions) && sessions.length) {
    useSessions.setState({ sessions: sessions as SavedSession[] })
  }
})
