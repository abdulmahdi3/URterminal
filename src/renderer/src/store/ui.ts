import { create } from 'zustand'

interface UiState {
  showSettings: boolean
  showCommandPalette: boolean
  showShortcuts: boolean
  linkingPaneId: string | null
  /** when set, only this pane is rendered (zoom / maximize) */
  zoomedPaneId: string | null

  setShowSettings: (v: boolean) => void
  setShowCommandPalette: (v: boolean) => void
  toggleCommandPalette: () => void
  setShowShortcuts: (v: boolean) => void
  toggleShortcuts: () => void
  setLinkingPaneId: (id: string | null) => void
  setZoomedPaneId: (id: string | null) => void
  toggleZoom: (id: string) => void
  /** close every transient overlay (used by Escape) */
  closeOverlays: () => void
}

export const useUi = create<UiState>((set, get) => ({
  showSettings: false,
  showCommandPalette: false,
  showShortcuts: false,
  linkingPaneId: null,
  zoomedPaneId: null,

  setShowSettings: (v) => set({ showSettings: v }),
  setShowCommandPalette: (v) => set({ showCommandPalette: v }),
  toggleCommandPalette: () => set((s) => ({ showCommandPalette: !s.showCommandPalette })),
  setShowShortcuts: (v) => set({ showShortcuts: v }),
  toggleShortcuts: () => set((s) => ({ showShortcuts: !s.showShortcuts })),
  setLinkingPaneId: (id) => set({ linkingPaneId: id }),
  setZoomedPaneId: (id) => set({ zoomedPaneId: id }),
  toggleZoom: (id) => set({ zoomedPaneId: get().zoomedPaneId === id ? null : id }),
  closeOverlays: () =>
    set({
      showSettings: false,
      showCommandPalette: false,
      showShortcuts: false,
      linkingPaneId: null
    })
}))
