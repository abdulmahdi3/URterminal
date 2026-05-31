import { useEffect } from 'react'
import type { MosaicNode } from 'react-mosaic-component'
import type { Pane, LastSessionPayload } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { useSettings } from '@renderer/store/settings'
import { applyRestore } from '@renderer/store/sessions'
import { capturePane } from '@renderer/lib/terminalPool'
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
    if (clone.shell) clone.shell = { shell: clone.shell.shell, args: clone.shell.args }
    if (clone.agent) clone.agent = { command: clone.agent.command, cwd: clone.agent.cwd }
    out[id] = clone
  }
  return out
}

/** Capture the chat content (replayable terminal transcript) of every open pane. */
function captureTranscripts(panes: Record<string, Pane>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of Object.keys(panes)) {
    const text = capturePane(id)
    if (text) out[id] = text
  }
  return out
}

/** Build the full auto-save snapshot of the current workspace (panes + layout + chats). */
function snapshot(): LastSessionPayload {
  const { panes, layout } = useWorkspace.getState()
  return { panes: sanitize(panes), layout, transcripts: captureTranscripts(panes), savedAt: Date.now() }
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
      .then((last) => {
        const max = useSettings.getState().settings?.prefs.maxRestorePanes ?? 0
        if (last && last.panes && Object.keys(last.panes).length) {
          const capped = capPanes(
            last.panes,
            (last.layout as MosaicNode<string> | null) ?? null,
            max
          )
          applyRestore(capped.panes, capped.layout, last.transcripts ?? {})
          return
        }
        try {
          const raw = localStorage.getItem(KEY)
          if (!raw) return
          const data = JSON.parse(raw) as Persisted
          if (data.layout && data.panes && Object.keys(data.panes).length) {
            const capped = capPanes(data.panes, data.layout, max)
            applyRestore(capped.panes, capped.layout, {})
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
          clear ? { panes: {}, layout: null, transcripts: {}, savedAt: Date.now() } : snapshot()
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
