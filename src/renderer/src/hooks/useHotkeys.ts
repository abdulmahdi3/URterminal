import { useEffect } from 'react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { getCommands, runCommand } from '@renderer/lib/commands'
import { eventToCombo } from '@renderer/lib/keys'
import { useShortcuts, effectiveCombo } from '@renderer/store/shortcuts'

/**
 * Find the command bound to `combo` using the effective bindings (custom
 * override ?? built-in default; "" = unbound). A custom binding wins over a
 * built-in default that happens to use the same combo.
 */
function commandForCombo(combo: string): string | undefined {
  const custom = useShortcuts.getState().custom
  let defaultMatch: string | undefined
  for (const c of getCommands()) {
    const eff = effectiveCombo(custom, c.id, c.shortcut)
    if (eff !== combo) continue
    if (c.id in custom) return c.id // explicit custom binding takes priority
    defaultMatch ??= c.id
  }
  return defaultMatch
}

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable
}

/**
 * A regular app input (settings field, rename box, search) — i.e. an editable
 * element that is NOT the terminal's hidden textarea. Used to let the browser's
 * native copy/paste run there instead of our terminal clipboard shortcuts.
 */
function isAppInput(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t || !isTypingTarget(t)) return false
  return !t.closest('.shell-pane') // xterm's input lives inside .shell-pane
}

/**
 * Single global keydown handler — the only place hotkeys are wired.
 * Keeping the chrome empty (no on-screen buttons) and routing everything
 * through here + the command palette is what keeps the UI uncluttered.
 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      const ui = useUi.getState()

      // Command palette toggle — reserved, works everywhere (not rebindable).
      if (mod && e.shiftKey && e.code === 'KeyK') {
        e.preventDefault()
        ui.toggleCommandPalette()
        return
      }

      // Escape: close search → clear pane selection → overlays → exit zoom.
      if (e.key === 'Escape') {
        if (ui.searchOpen) {
          ui.setSearchOpen(false)
          return
        }
        if (useWorkspace.getState().selectedPaneIds.length) {
          useWorkspace.getState().clearPaneSelection()
          return
        }
        if (
          ui.showCommandPalette ||
          ui.showSettings ||
          ui.showShortcuts ||
          ui.showAskAll ||
          ui.showQuickSwitch ||
          ui.linkingPaneId
        ) {
          ui.closeOverlays()
          return
        }
        if (ui.zoomedPaneId) {
          ui.setZoomedPaneId(null)
          return
        }
        return
      }

      // All other shortcuts are data-driven: every combo maps to a command via
      // its effective binding (custom override ?? built-in default), so rebinds
      // in the Shortcuts modal take effect with no special-casing here.
      const combo = eventToCombo(e)
      if (combo) {
        const id = commandForCombo(combo)
        if (id) {
          // In regular app inputs, let the browser handle native copy/paste
          // instead of routing to the active terminal.
          if ((id === 'edit.copy' || id === 'edit.paste') && isAppInput(e.target)) return
          e.preventDefault()
          runCommand(id)
          return
        }
      }

      // "?" cheatsheet — only when not typing (can't be a combo: no modifier).
      if (!mod && e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault()
        runCommand('app.shortcuts')
      }
    }

    // A plain click anywhere drops the pane selection. A drag-to-move ends with
    // a 'dragend' (no 'click' is dispatched), so moving panes is unaffected.
    const onClick = (): void => {
      const ws = useWorkspace.getState()
      if (ws.selectedPaneIds.length) ws.clearPaneSelection()
    }

    // Safety net: always drop the cross-workspace drag state when any drag ends
    // (a mosaic rearrange can otherwise leave the "new workspace" affordance up).
    const onDragEnd = (): void => useUi.getState().setDraggingPanes(null)

    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [])
}
