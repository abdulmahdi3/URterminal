import { create } from 'zustand'
import type { MosaicNode } from 'react-mosaic-component'
import type { ChatSession, LastSessionPayload, Pane, PersistedWorkspace } from '@shared/types'
import { useWorkspace } from './workspace'
import { useWorkspaces } from './workspaces'
import { toast } from './toasts'
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
    // keep sessionId (so the chat resumes) + sshTarget (so SSH panes free their
    // remote resources on close) — dropping the runtime ptyId is the only goal here
    if (clone.agent)
      clone.agent = {
        command: clone.agent.command,
        cwd: clone.agent.cwd,
        sessionId: clone.agent.sessionId,
        sshTarget: clone.agent.sshTarget
      }
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
 * Build the relaunch args for a restored agent pane. A pane that pinned its own
 * Claude session id resumes that EXACT conversation (`--resume <id>`) — which is
 * what gives two panes in one folder their own chats. If the session file no
 * longer exists on disk (claude never wrote it, or history was cleared) we
 * re-create it with the same id (`--session-id <id>`) instead of erroring on a
 * dead `--resume`. Panes with no pinned id (older saves) fall back to the
 * agent's legacy resume flag (`--continue`).
 */
function restoreArgsFor(pane: Pane, existing: Set<string>): string[] | undefined {
  if (pane.type !== 'ai') return undefined
  const desc = getAgentDescriptor(pane.agent?.command)
  const sid = pane.agent?.sessionId
  if (desc?.sessionId && sid) {
    return existing.has(sid) ? [desc.sessionId.resume, sid] : [desc.sessionId.pin, sid]
  }
  return desc?.resumeArgs
}

/**
 * Ask the main process which pinned Claude conversations actually exist on disk,
 * so restore can choose resume vs re-create per pane (see `restoreArgsFor`).
 * Resolved up front (in parallel) before any terminals are torn down.
 */
async function existingClaudeSessions(paneMaps: Record<string, Pane>[]): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const panes of paneMaps) {
    for (const p of Object.values(panes)) {
      if (p.type === 'ai' && p.agent?.sessionId && getAgentDescriptor(p.agent.command)?.sessionId) {
        ids.add(p.agent.sessionId)
      }
    }
  }
  const present = new Set<string>()
  await Promise.all(
    [...ids].map(async (sid) => {
      try {
        const info = await window.api.claudeSessionInfo(sid)
        if (info?.exists) present.add(sid)
      } catch {
        /* treat as missing → restore re-creates it with --session-id */
      }
    })
  )
  return present
}

/**
 * Restore a NAMED session into the live workspace: tear down the current panes'
 * terminals, seed each restored pane with its chat replay (or agent-resume
 * args), then hydrate. Panes get fresh ids (remap) so they can't collide with
 * anything still running, and each replayed pane's main-process transcript log
 * is primed so subsequent auto-saves keep the restored history.
 */
export async function applyRestore(
  panes: Record<string, Pane>,
  layout: MosaicNode<string> | null,
  transcripts: Record<string, string>
): Promise<void> {
  const remapped = remapIds(sanitize(panes), layout, transcripts)
  // Resolve which pinned chats still exist BEFORE disposing anything.
  const existing = await existingClaudeSessions([remapped.panes])

  // Kill the outgoing workspace's terminals so they don't leak/keep running.
  for (const id of Object.keys(useWorkspace.getState().panes)) disposeTerminal(id)

  for (const [id, pane] of Object.entries(remapped.panes)) {
    const resumeArgs = restoreArgsFor(pane, existing)
    if (resumeArgs?.length) {
      // Agent resumes its own session → relaunch with the resume/pin flag; it
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
export async function applyLaunchRestore(
  workspaces: PersistedWorkspace[],
  activeWorkspaceId: string,
  transcripts: Record<string, string>,
  scroll: Record<string, number>
): Promise<void> {
  const wsList = workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    panes: sanitize(w.panes ?? {}),
    layout: (w.layout as MosaicNode<string> | null) ?? null
  }))

  // Which pinned chats still exist — decides resume vs re-create per pane.
  const existing = await existingClaudeSessions(wsList.map((w) => w.panes))

  for (const id of Object.keys(useWorkspace.getState().panes)) disposeTerminal(id)

  for (const w of wsList) {
    for (const [id, pane] of Object.entries(w.panes)) {
      const resumeArgs = restoreArgsFor(pane, existing)
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

/** A claude (session-capable) pane found across all workspaces, with its pinned id. */
interface ClaudePaneRef {
  sessionId: string
  agent: string
  cwd?: string
}

/** Every claude pane that owns a pinned session id, across all workspaces (live + snapshots). */
function collectClaudePanes(): ClaudePaneRef[] {
  const active = useWorkspace.getState()
  const wsStore = useWorkspaces.getState()
  const out: ClaudePaneRef[] = []
  const gather = (panes: Record<string, Pane>): void => {
    for (const p of Object.values(panes)) {
      const sid = p.agent?.sessionId
      if (p.type === 'ai' && sid && getAgentDescriptor(p.agent?.command)?.sessionId) {
        out.push({ sessionId: sid, agent: p.agent!.command, cwd: p.agent?.cwd })
      }
    }
  }
  for (const w of wsStore.list) {
    gather(w.id === wsStore.activeId ? active.panes : w.panes ?? {})
  }
  return out
}

interface SessionsState {
  sessions: SavedSession[]
  /** resumable per-conversation chats (named by subject), shown in the menu's CHATS list */
  chats: ChatSession[]
  /** snapshot the current workspace (panes, layout, chat content) under a name */
  save: (name: string) => void
  /** load a saved session into the current workspace (async: reads chat from disk) */
  restore: (id: string) => Promise<SavedSession | undefined>
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  /** refresh the chats registry from the live claude panes (titles pulled from disk) */
  recordChats: () => Promise<void>
  /** reopen a saved chat as a NEW claude pane in the current workspace (resumes it) */
  resumeChat: (chat: ChatSession) => void
  /** drop a chat from the menu list (does NOT delete Claude's own transcript) */
  removeChat: (sessionId: string) => void
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  chats: [],

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
    await applyRestore(session.panes, session.layout ?? null, data?.transcripts ?? {})
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
  },

  recordChats: async () => {
    // Secondary windows display chats but never own the on-disk registry.
    if (isSecondaryWindow) return
    const refs = collectClaudePanes()
    if (!refs.length) return
    const byId = new Map(refs.map((r) => [r.sessionId, r]))
    const prev = new Map(get().chats.map((c) => [c.sessionId, c]))
    const now = Date.now()
    await Promise.all(
      [...byId.values()].map(async (r) => {
        let info
        try {
          info = await window.api.claudeSessionInfo(r.sessionId)
        } catch {
          /* unreadable — keep any previous entry untouched */
        }
        // Only list a chat once Claude has actually written its transcript.
        if (!info?.exists) return
        const was = prev.get(r.sessionId)
        prev.set(r.sessionId, {
          sessionId: r.sessionId,
          title: info.title || was?.title || 'Claude session',
          cwd: info.cwd || r.cwd || was?.cwd,
          agent: r.agent,
          updatedAt: info.updatedAt || now
        })
      })
    )
    const chats = [...prev.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    set({ chats })
    void window.api.writeChats(chats)
  },

  resumeChat: (chat) => {
    const ws = useWorkspace.getState()
    // Already open in the current workspace? Just focus it — never spawn a second
    // `--resume` on the same id (that would recreate the very collision we fixed).
    const live = Object.values(ws.panes).find((p) => p.agent?.sessionId === chat.sessionId)
    if (live) {
      ws.setActive(live.id)
      return
    }
    // Open a fresh pane (handles layout); addPane mints its own session id, which
    // we immediately replace with the chat's id and seed the resume — both BEFORE
    // the pane mounts, so it spawns straight into `claude --resume <id>`.
    const id = ws.addPane('ai', undefined, {
      agentCommand: chat.agent,
      agentCwd: chat.cwd,
      label: chat.title
    })
    if (!id) {
      toast('Max 9 panes reached', 'info')
      return
    }
    const resume = getAgentDescriptor(chat.agent)?.sessionId?.resume ?? '--resume'
    ws.updatePane(id, {
      agent: { command: chat.agent, cwd: chat.cwd, sessionId: chat.sessionId },
      title: chat.title
    })
    seedRestore(id, { resumeArgs: [resume, chat.sessionId] })
  },

  removeChat: (sessionId) => {
    const chats = get().chats.filter((c) => c.sessionId !== sessionId)
    set({ chats })
    void window.api.writeChats(chats)
  }
}))

/**
 * Build the CHATS list on launch: the saved registry UNION every claude pane in
 * the last session (so a pane that ran last time always shows up), each title
 * refreshed from Claude's own transcript and any whose transcript is gone dropped.
 */
async function loadChats(last: LastSessionPayload | null): Promise<ChatSession[]> {
  const raw = await window.api.readChats()
  const stored: ChatSession[] = Array.isArray(raw) ? (raw as ChatSession[]) : []
  const candidates = new Map<string, { agent: string; cwd?: string }>()
  for (const c of stored) candidates.set(c.sessionId, { agent: c.agent, cwd: c.cwd })
  const wsList: { panes?: Record<string, Pane> }[] =
    last?.workspaces ?? (last?.panes ? [{ panes: last.panes }] : [])
  for (const w of wsList) {
    for (const p of Object.values(w.panes ?? {})) {
      const sid = p.agent?.sessionId
      if (p.type === 'ai' && sid && getAgentDescriptor(p.agent?.command)?.sessionId) {
        candidates.set(sid, { agent: p.agent!.command, cwd: p.agent?.cwd })
      }
    }
  }
  const prev = new Map(stored.map((c) => [c.sessionId, c]))
  const refreshed = await Promise.all(
    [...candidates.entries()].map(async ([sid, meta]) => {
      let info
      try {
        info = await window.api.claudeSessionInfo(sid)
      } catch {
        /* unreadable */
      }
      if (!info?.exists) return null // transcript gone → drop from the list
      const was = prev.get(sid)
      return {
        sessionId: sid,
        title: info.title || was?.title || 'Claude session',
        cwd: info.cwd || meta.cwd || was?.cwd,
        agent: meta.agent,
        updatedAt: info.updatedAt || was?.updatedAt || Date.now()
      } as ChatSession
    })
  )
  return refreshed
    .filter((c): c is ChatSession => !!c)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

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
    const rawChats = await window.api.readChats()
    useSessions.setState({
      sessions: list,
      chats: Array.isArray(rawChats) ? (rawChats as ChatSession[]) : []
    })
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

  // Refresh the resumable-chats list (saved entries + last session's claude panes).
  const chats = await loadChats(last)
  void window.api.writeChats(chats)
  useSessions.setState({ sessions: kept, chats })
}

void bootstrapSessions()
