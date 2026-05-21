import { create } from 'zustand'
import type { SettingsPublic, SettingsPatch } from '@shared/types'
import i18n from '@renderer/i18n/i18n'
import { useWorkspace } from './workspace'

interface SettingsState {
  settings: SettingsPublic | null
  load: () => Promise<void>
  patch: (patch: SettingsPatch) => Promise<void>
  apply: (s: SettingsPublic) => void
}

function applySideEffects(s: SettingsPublic): void {
  // Single refined dark theme — no in-face theme switcher by design.
  document.documentElement.setAttribute('data-theme', 'dark')
  document.documentElement.setAttribute('dir', s.language === 'ar' ? 'rtl' : 'ltr')
  if (i18n.language !== s.language) void i18n.changeLanguage(s.language)
  useWorkspace.getState().setDefaults(s.defaultProvider, s.defaultModel)
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  apply: (s) => {
    applySideEffects(s)
    set({ settings: s })
  },
  load: async () => {
    const s = await window.api.getSettings()
    get().apply(s)
  },
  patch: async (patch) => {
    const s = await window.api.patchSettings(patch)
    get().apply(s)
  }
}))
