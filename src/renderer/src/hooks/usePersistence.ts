import { useEffect } from 'react'
import type { MosaicNode } from 'react-mosaic-component'
import type { Pane, LastSessionPayload, PersistedWorkspace } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import { useSettings } from '@renderer/store/settings'
import { applyRestore, applyLaunchRestore, useSessions } from '@renderer/store/sessions'
import { capturePaneScroll } from '@renderer/lib/terminalPool'
import { getLeaves } from '@renderer/lib/mosaicTree'
import { buildAutoLayout } from '@renderer/lib/layoutPresets'
import { toast } from '@renderer/store/toasts'
import { isSecondaryWindow } from '@renderer/lib/windowMode'

const KEY = 'urterminal.workspace.v1'

interface Persisted {
  panes: Record<string, Pane>
  layout: MosaicNode<string> | null
}

/** Strip runtime-only fields so a restored pane spawns fresh PTYs / no dangling streams. */
function sanitize(panes: Record<string, Pane>): Record<string, Pane> {
  const out: Record<string, Pane> = {}
  for (const [id, p] of Object.entries(panes)) {
    const clone: Pane = { ...p } // keeps pipeTargets, telegramChatId, notes, etc.
    // Keep the SSH target, working dir and startup command so a restored SSH pane
    // reconnects instead of opening a plain local shell — drop only runtime ptyId.
    if (clone.shell) {
      const { ptyId: _ptyId, ...shell } = clone.shell
      clone.shell = shell
    }
    // keep the pinned sessionId (chat resume) + sshTarget; only the runtime ptyId is dropped
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

/**
 * Build the auto-save snapshot of the WHOLE app: every workspace (the active one
 * from the live store, the rest from their saved snapshots) plus per-pane scroll
 * positions. Chat content is NOT inlined — it streams to per-pane transcript logs
 * in the main process and is referenced by pane id, so this stays small and the
 * synchronous close-flush is cheap.
 */
function snapshot(): LastSessionPayload {
  const wsStore = useWorkspaces.getState()
  const active = useWorkspace.getState()
  const workspaces: PersistedWorkspace[] = wsStore.list.map((w) =>
    w.id === wsStore.activeId
      ? { id: w.id, name: w.name, panes: sanitize(active.panes), layout: active.layout }
      : { id: w.id, name: w.name, panes: sanitize(w.panes ?? {}), layout: w.layout ?? null }
  )
  const scroll: Record<string, number> = {}
  for (const w of workspaces) {
    for (const id of Object.keys(w.panes)) {
      const up = capturePaneScroll(id)
      if (up > 0) scroll[id] = up
    }
  }
  return { workspaces, activeWorkspaceId: wsStore.activeId, scroll, savedAt: Date.now() }
}

/** Cap a restored snapshot to the first `max` panes (0 = unlimited), rebalancing the layout. */
function capPanes(
  panes: Record<string, Pane>,
  layout: MosaicNode<string> | null,
  max: number
): { panes: Record<string, Pane>; layout: MosaicNode<string> | null } {
  if (!max || max <= 0) return { panes, layout }
  const leaves = getLeaves(layout)
  if (leaves.length <= max) return { panes, layout }
  const keep = leaves.slice(0, max)
  const kept: Record<string, Pane> = {}
  for (const id of keep) if (panes[id]) kept[id] = panes[id]
  return { panes: kept, layout: buildAutoLayout(keep) }
}

export function usePersistence(): void {
  // Restore once on mount, unless the user disabled auto-restore. The flag is
  // mirrored to localStorage by the settings store so it's readable here before
  // the async settings load resolves (absent = on, preserving prior behavior).
  useEffect(() => {
    // Secondary windows always start empty — never restore the shared session.
    if (isSecondaryWindow) return
    if (localStorage.getItem('urterminal.autoRestore') === '0') return
    // Prefer the on-disk full snapshot (includes chat content); fall back to the
    // legacy localStorage config blob from older versions (layout only).
    void window.api
      .readLastSession()
      .then(async (last) => {
        const max = useSettings.getState().settings?.prefs.maxRestorePanes ?? 0
        // New multi-workspace snapshot: restore every tab, pulling each pane's
        // complete history from its main-process transcript log.
        if (last?.workspaces && last.workspaces.length) {
          const allIds = last.workspaces.flatMap((w) => Object.keys(w.panes ?? {}))
          const transcripts: Record<string, string> = {}
          await Promise.all(
            allIds.map(async (id) => {
              try {
                const t = await window.api.transcriptRead(id)
                if (t) transcripts[id] = t
              } catch {
                /* no log for this pane → restore its config only */
              }
            })
          )
          // Cap only the active workspace if a restore limit is set.
          const workspaces = last.workspaces.map((w) => {
            if (w.id !== last.activeWorkspaceId) return w
            const capped = capPanes(w.panes ?? {}, (w.layout as MosaicNode<string> | null) ?? null, max)
            return { ...w, panes: capped.panes, layout: capped.layout }
          })
          const activeId = last.activeWorkspaceId ?? workspaces[0].id
          await applyLaunchRestore(workspaces, activeId, transcripts, last.scroll ?? {})
          // Drop transcript logs for panes that no longer exist (crash orphans).
          void window.api.transcriptPrune(workspaces.flatMap((w) => Object.keys(w.panes ?? {})))
          return
        }
        // Legacy single-workspace snapshot (pre-multi-workspace upgrade).
        if (last && last.panes && Object.keys(last.panes).length) {
          const capped = capPanes(
            last.panes,
            (last.layout as MosaicNode<string> | null) ?? null,
            max
          )
          await applyRestore(capped.panes, capped.layout, last.transcripts ?? {})
          return
        }
        try {
          const raw = localStorage.getItem(KEY)
          if (!raw) return
          const data = JSON.parse(raw) as Persisted
          if (data.layout && data.panes && Object.keys(data.panes).length) {
            const capped = capPanes(data.panes, data.layout, max)
            await applyRestore(capped.panes, capped.layout, {})
          }
        } catch {
          toast('Workspace state was corrupted and could not be restored.', 'error')
        }
      })
      .catch(() => {})
  }, [])

  // Persist (debounced) whenever panes/layout change, and flush synchronously
  // when the window is closing so the latest layout + chat content is never lost.
  useEffect(() => {
    // Secondary windows must not write the shared last-session snapshot, or they
    // would overwrite the primary window's persisted workspace on close.
    if (isSecondaryWindow) return
    let handle = 0
    const save = (): void => {
      void window.api.writeLastSession(snapshot())
      // keep the resumable-chats list current (titles + new conversations) as
      // panes are opened, used, and closed — cheap, reads Claude's own titles
      void useSessions.getState().recordChats()
    }
    const unsub = useWorkspace.subscribe(() => {
      window.clearTimeout(handle)
      const secs = useSettings.getState().settings?.prefs.autoSaveSeconds ?? 1
      handle = window.setTimeout(save, Math.max(250, secs * 1000))
    })
    const flush = (): void => {
      try {
        // synchronous IPC — async writes don't complete during beforeunload.
        // "Clear workspace on exit" persists an empty snapshot so the next
        // launch starts fresh.
        const clear = useSettings.getState().settings?.prefs.clearWorkspaceOnExit
        window.api.flushLastSession(
          clear
            ? { workspaces: [], activeWorkspaceId: '', scroll: {}, savedAt: Date.now() }
            : snapshot()
        )
      } catch {
        /* non-fatal */
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.clearTimeout(handle)
      window.removeEventListener('beforeunload', flush)
      unsub()
    }
  }, [])
}
