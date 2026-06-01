import { create } from 'zustand'
import type { MosaicNode } from 'react-mosaic-component'
import type { Pane, PersistedWorkspace } from '@shared/types'
import { useWorkspace } from './workspace'
import { useWorkspaces } from './workspaces'
import { getAgentDescriptor } from '@renderer/lib/agents'
import { capturePane, seedRestore, disposeTerminal } from '@renderer/lib/terminalPool'
import { isSecondaryWindow } from '@renderer/lib/windowMode'

/** A pane restore seed (structural — RestoreSeed isn't exported from terminalPool). */
interface Seed {
  transcript?: string
  resumeArgs?: string[]
  scrollFromBottom?: number
}

const uid = (): string => Math.random().toString(36).slice(2, 10)

/** A named snapshot of a whole workspace (panes + layout), persisted to disk. */
export interface SavedSession {
  id: string
  name: string
  savedAt: number
  paneCount: number
  panes: Record<string, Pane>
  layout: MosaicNode<string> | null
  /** true for snapshots archived automatically on launch (vs. user-named saves) */
  auto?: boolean
}

/** How long auto-saved snapshots are kept in the session list before pruning. */
const AUTO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // one week

/** Compact, readable timestamp for auto-snapshot names (e.g. "May 27, 19:42"). */
function formatStamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Drop runtime-only fields so a restored pane spawns fresh PTYs / no dangling streams. */
function sanitize(panes: Record<string, Pane>): Record<string, Pane> {
  const out: Record<string, Pane> = {}
  for (const [id, p] of Object.entries(panes)) {
    const clone: Pane = { ...p }
    if (clone.shell) clone.shell = { shell: clone.shell.shell, args: clone.shell.args }
    if (clone.agent) clone.agent = { command: clone.agent.command, cwd: clone.agent.cwd }
    out[id] = clone
  }
  return out
}

/** Rewrite a mosaic layout tree, swapping every pane-id leaf through `idMap`. */
function remapLayout(
  node: MosaicNode<string> | null,
  idMap: Record<string, string>
): MosaicNode<string> | null {
  if (node === null) return null
  if (typeof node === 'string') return idMap[node] ?? node
  return {
    ...node,
    first: remapLayout(node.first, idMap)!,
    second: remapLayout(node.second, idMap)!
  }
}

/**
 * Give every pane in a snapshot a brand-new id (and rewrite the layout +
 * pipe-targets to match). Restoring with fresh ids guarantees React mounts new
 * terminal components — so their first-spawn restore seeds fire — and never
 * collides with panes still alive in the current workspace.
 */
function remapIds(
  panes: Record<string, Pane>,
  layout: MosaicNode<string> | null,
  transcripts: Record<string, string>
): { panes: Record<string, Pane>; layout: MosaicNode<string> | null; transcripts: Record<string, string> } {
  const idMap: Record<string, string> = {}
  for (const id of Object.keys(panes)) idMap[id] = uid()
  const nextPanes: Record<string, Pane> = {}
  const nextTranscripts: Record<string, string> = {}
  for (const [oldId, pane] of Object.entries(panes)) {
    const newId = idMap[oldId]
    const next: Pane = { ...pane, id: newId }
    if (pane.pipeTargets) {
      const mapped = pane.pipeTargets.map((t) => idMap[t]).filter(Boolean)
      next.pipeTargets = mapped.length ? mapped : undefined
    }
    nextPanes[newId] = next
    if (transcripts[oldId]) nextTranscripts[newId] = transcripts[oldId]
  }
  return { panes: nextPanes, layout: remapLayout(layout, idMap), transcripts: nextTranscripts }
}

/**
 * Capture the complete chat history of every pane for a NAMED save. Pulls the
 * full transcript from the main-process log (unbounded by xterm's scrollback),
 * falling back to the live xterm serialize when no log exists.
 */
async function captureTranscripts(panes: Record<string, Pane>): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const id of Object.keys(panes)) {
    let text = ''
    try {
      text = await window.api.transcriptRead(id)
    } catch {
      /* fall back to the live buffer below */
    }
    if (!text) text = capturePane(id)
    if (text) out[id] = text
  }
  return out
}

/**
 * Restore a NAMED session into the live workspace: tear down the current panes'
 * terminals, seed each restored pane with its chat replay (or agent-resume
 * args), then hydrate. Panes get fresh ids (remap) so they can't collide with
 * anything still running, and each replayed pane's main-process transcript log
 * is primed so subsequent auto-saves keep the restored history.
 */
export function applyRestore(
  panes: Record<string, Pane>,
  layout: MosaicNode<string> | null,
  transcripts: Record<string, string>
): void {
  // Kill the outgoing workspace's terminals so they don't leak/keep running.
  for (const id of Object.keys(useWorkspace.getState().panes)) disposeTerminal(id)

  const remapped = remapIds(sanitize(panes), layout, transcripts)
  for (const [id, pane] of Object.entries(remapped.panes)) {
    const resumeArgs =
      pane.type === 'ai' ? getAgentDescriptor(pane.agent?.command)?.resumeArgs : undefined
    if (resumeArgs?.length) {
      // Agent can resume its own session → relaunch with the resume flag; it
      // reprints its history, so we don't replay the transcript (avoids dupes).
      seedRestore(id, { resumeArgs })
    } else if (remapped.transcripts[id]) {
      seedRestore(id, { transcript: remapped.transcripts[id] })
      // Prime the (new id's) main log so it carries the restored history forward.
      void window.api.transcriptPrime(id, remapped.transcripts[id])
    }
  }
  useWorkspace.getState().hydrate(remapped.panes, remapped.layout)
}

/**
 * Restore the WHOLE app on launch: every workspace (tabs), each with its panes,
 * layout, replayed chat history and scroll position. Pane ids are preserved (no
 * remap) so they stay aligned with their on-disk transcript logs. Background
 * workspaces are kept as snapshots and spawn lazily when first switched to —
 * their panes are seeded up front so the replay fires whenever they mount.
 */
export function applyLaunchRestore(
  workspaces: PersistedWorkspace[],
  activeWorkspaceId: string,
  transcripts: Record<string, string>,
  scroll: Record<string, number>
): void {
  for (const id of Object.keys(useWorkspace.getState().panes)) disposeTerminal(id)

  const wsList = workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    panes: sanitize(w.panes ?? {}),
    layout: (w.layout as MosaicNode<string> | null) ?? null
  }))

  for (const w of wsList) {
    for (const [id, pane] of Object.entries(w.panes)) {
      const resumeArgs =
        pane.type === 'ai' ? getAgentDescriptor(pane.agent?.command)?.resumeArgs : undefined
      const seed: Seed = {}
      if (resumeArgs?.length) seed.resumeArgs = resumeArgs
      else if (transcripts[id]) seed.transcript = transcripts[id]
      if (scroll[id]) seed.scrollFromBottom = scroll[id]
      if (seed.transcript || seed.resumeArgs || seed.scrollFromBottom) seedRestore(id, seed)
    }
  }

  const active = wsList.find((w) => w.id === activeWorkspaceId) ?? wsList[0]
  useWorkspaces.getState().hydrateAll(wsList, active?.id ?? activeWorkspaceId)
  useWorkspace.getState().hydrate(active?.panes ?? {}, active?.layout ?? null)
}

/** Write the session metadata list to the on-disk JSON file (transcripts stored separately). */
function persist(sessions: SavedSession[]): void {
  void window.api.writeSessions(sessions)
}

interface SessionsState {
  sessions: SavedSession[]
  /** snapshot the current workspace (panes, layout, chat content) under a name */
  save: (name: string) => void
  /** load a saved session into the current workspace (async: reads chat from disk) */
  restore: (id: string) => Promise<SavedSession | undefined>
  remove: (id: string) => void
  rename: (id: string, name: string) => void
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],

  save: (name) => {
    const { panes, layout } = useWorkspace.getState()
    const id = uid()
    const session: SavedSession = {
      id,
      name: name.trim() || `Session ${get().sessions.length + 1}`,
      savedAt: Date.now(),
      paneCount: Object.keys(panes).length,
      panes: sanitize(panes),
      layout
    }
    // Persist the complete chat history (per-pane) to its own file — async so a
    // large transcript read never blocks the save click.
    void captureTranscripts(panes).then((transcripts) =>
      window.api.writeSessionData(id, { transcripts })
    )
    const sessions = [session, ...get().sessions]
    persist(sessions)
    set({ sessions })
  },

  restore: async (id) => {
    const session = get().sessions.find((s) => s.id === id)
    if (!session) return undefined
    const data = await window.api.readSessionData(id)
    applyRestore(session.panes, session.layout ?? null, data?.transcripts ?? {})
    return session
  },

  remove: (id) => {
    void window.api.deleteSessionData(id)
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

/**
 * Startup: load the saved-session list, archive the previous run's auto-save
 * (its final state was flushed to last-session.json on close) into the list as
 * a dated "Auto" entry, and prune auto entries older than one week. Named
 * sessions are never pruned.
 */
async function bootstrapSessions(): Promise<void> {
  const raw = await window.api.readSessions()
  let list: SavedSession[] = Array.isArray(raw) ? (raw as SavedSession[]) : []

  // Secondary windows only display the saved-session list — they must not
  // archive the last run or rewrite sessions.json (the primary window owns
  // that, and a concurrent write would race / duplicate auto entries).
  if (isSecondaryWindow) {
    list.sort((a, b) => b.savedAt - a.savedAt)
    useSessions.setState({ sessions: list })
    return
  }

  // Archive the last run's snapshot as an auto entry (dedupe by its savedAt).
  // The auto entry captures the active workspace (matching pre-multi-workspace
  // behavior); its full chat content comes from the per-pane transcript logs.
  const last = await window.api.readLastSession()
  const activeWs = last?.workspaces
    ? last.workspaces.find((w) => w.id === last.activeWorkspaceId) ?? last.workspaces[0]
    : undefined
  const lastPanes = activeWs?.panes ?? last?.panes
  const lastLayout = (activeWs?.layout ?? last?.layout ?? null) as MosaicNode<string> | null
  if (lastPanes && Object.keys(lastPanes).length && last?.savedAt) {
    const already = list.some((s) => s.auto && s.savedAt === last.savedAt)
    if (!already) {
      const id = uid()
      const transcripts: Record<string, string> = {}
      for (const pid of Object.keys(lastPanes)) {
        let t = ''
        try {
          t = await window.api.transcriptRead(pid)
        } catch {
          /* fall back to legacy inline transcript below */
        }
        if (!t && last.transcripts?.[pid]) t = last.transcripts[pid]
        if (t) transcripts[pid] = t
      }
      await window.api.writeSessionData(id, { transcripts })
      list = [
        {
          id,
          name: formatStamp(last.savedAt),
          savedAt: last.savedAt,
          paneCount: Object.keys(lastPanes).length,
          panes: lastPanes,
          layout: lastLayout,
          auto: true
        },
        ...list
      ]
    }
  }

  // Prune expired auto snapshots (and their on-disk chat content).
  const cutoff = Date.now() - AUTO_RETENTION_MS
  const kept: SavedSession[] = []
  for (const s of list) {
    if (s.auto && s.savedAt < cutoff) {
      void window.api.deleteSessionData(s.id)
      continue
    }
    kept.push(s)
  }
  kept.sort((a, b) => b.savedAt - a.savedAt)

  void window.api.writeSessions(kept)
  useSessions.setState({ sessions: kept })
}

void bootstrapSessions()
