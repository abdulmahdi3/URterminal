import { create } from 'zustand'
import { DEFAULT_PREFS, type SettingsPublic, type SettingsPatch } from '@shared/types'
import {
  setTerminalFont,
  setTerminalConfig,
  setTerminalTheme,
  setTerminalSurface
} from '@renderer/lib/terminalPool'
import { useWorkspace } from './workspace'
import { useUi, type AppTheme } from './ui'

interface SettingsState {
  settings: SettingsPublic | null
  load: () => Promise<void>
  patch: (patch: SettingsPatch) => Promise<void>
  apply: (s: SettingsPublic) => void
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function darkenHex(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, ((n >> 16) & 255) - 29)
  const g = Math.max(0, ((n >> 8) & 255) - 20)
  const b = Math.max(0, (n & 255) - 15)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function applyAccentColor(hex: string): void {
  const el = document.documentElement
  el.style.setProperty('--accent', hex)
  el.style.setProperty('--accent-strong', darkenHex(hex))
  el.style.setProperty('--accent-soft', hexToRgba(hex, 0.14))
  el.style.setProperty('--accent-glow', hexToRgba(hex, 0.35))
}

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')

/** Lighten (or darken, with negative amt) a hex color by a flat RGB step. */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return toHex(((n >> 16) & 255) + amt, ((n >> 8) & 255) + amt, (n & 255) + amt)
}
/** Blend `t` (0–1) of `b` into `a`. */
function mixHex(a: string, b: string, t: number): string {
  const na = parseInt(a.replace('#', ''), 16)
  const nb = parseInt(b.replace('#', ''), 16)
  return toHex(
    ((na >> 16) & 255) * (1 - t) + ((nb >> 16) & 255) * t,
    ((na >> 8) & 255) * (1 - t) + ((nb >> 8) & 255) * t,
    (na & 255) * (1 - t) + (nb & 255) * t
  )
}

/** CSS surface/text/border vars set by the custom theme (cleared otherwise). */
const CUSTOM_VARS = [
  '--bg', '--bg-elev', '--bg-elev-2', '--bg-elev-3', '--bg-sunken',
  '--text', '--text-dim', '--text-faint', '--border', '--border-strong'
]

/** Apply a user custom theme: derive an elevation/text/border ramp from 3 colors. */
function applyCustomTheme(c: { bg: string; text: string; accent: string }): void {
  const el = document.documentElement
  el.style.setProperty('--bg', c.bg)
  el.style.setProperty('--bg-elev', shade(c.bg, 9))
  el.style.setProperty('--bg-elev-2', shade(c.bg, 17))
  el.style.setProperty('--bg-elev-3', shade(c.bg, 25))
  el.style.setProperty('--bg-sunken', shade(c.bg, -7))
  el.style.setProperty('--text', c.text)
  el.style.setProperty('--text-dim', mixHex(c.text, c.bg, 0.42))
  el.style.setProperty('--text-faint', mixHex(c.text, c.bg, 0.62))
  el.style.setProperty('--border', shade(c.bg, 16))
  el.style.setProperty('--border-strong', shade(c.bg, 26))
  applyAccentColor(c.accent)
}

/** Remove the custom-theme inline vars so a built-in theme class takes over. */
function clearCustomTheme(): void {
  const el = document.documentElement
  for (const v of CUSTOM_VARS) el.style.removeProperty(v)
}

function applySideEffects(s: SettingsPublic): void {
  // Mirror auto-restore to localStorage so usePersistence can read it
  // synchronously at startup, before this async settings load resolves.
  try {
    localStorage.setItem('urterminal.autoRestore', s.prefs.autoRestore ? '1' : '0')
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute('data-theme', 'dark')
  useWorkspace.getState().setDefaults({
    provider: s.defaultProvider,
    model: s.defaultModel,
    agent: s.defaultAgent,
    shell: s.defaultShell,
    shellArgs: s.defaultShellArgs,
    shellCwd: s.prefs.defaultShellCwd,
    focusNewPane: s.prefs.focusNewPane
  })
  // pane title bars (settings-controlled) — collapse the mosaic toolbar when off
  document.documentElement.classList.toggle('hide-pane-headers', !s.prefs.showPaneHeaders)
  // scrollbar thickness (px) — drives the --scrollbar-size CSS var used by global.css
  document.documentElement.style.setProperty(
    '--scrollbar-size',
    `${Math.max(6, s.prefs.scrollbarWidth || 14)}px`
  )
  setTerminalFont(s.prefs.fontFamily || '', s.prefs.fontSize || 13)
  setTerminalConfig({
    cursorStyle: s.prefs.cursorStyle,
    cursorBlink: s.prefs.cursorBlink,
    lineHeight: s.prefs.lineHeight,
    letterSpacing: s.prefs.letterSpacing,
    scrollback: s.prefs.scrollback,
    scrollSensitivity: s.prefs.scrollSensitivity,
    copyOnSelect: s.prefs.copyOnSelect,
    pasteOnRightClick: s.prefs.pasteOnRightClick,
    bell: s.prefs.terminalBell,
    padding: s.prefs.terminalPadding
  })
  // App color theme: 'system' resolves to light/dark via the OS preference;
  // 'custom' applies the user's Theme Studio colors; every other value is a
  // concrete theme class applied on .app (see App.tsx).
  const themePref = s.prefs.appTheme || 'dark'
  const resolved =
    themePref === 'system'
      ? window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : themePref
  let ov: { color: string; symbol: string }
  if (resolved === 'custom') {
    const c = s.prefs.customTheme ?? DEFAULT_PREFS.customTheme
    applyCustomTheme(c)
    setTerminalSurface({ background: c.bg, foreground: c.text, cursor: c.accent })
    ov = { color: shade(c.bg, 9), symbol: mixHex(c.text, c.bg, 0.42) }
  } else {
    clearCustomTheme()
    applyAccentColor(s.accentColor || '#4c8dff')
    setTerminalTheme(resolved) // agent/shell terminal background follows the theme
    ov = OVERLAY_COLORS[resolved] ?? OVERLAY_COLORS.dark
  }
  useUi.getState().setAppTheme(resolved as AppTheme)
  // Recolor the native window caption buttons to match the active theme.
  window.api.setWindowOverlay(ov.color, ov.symbol)
}

/** Native caption-overlay colors per theme — color = --bg-elev, symbol = --text-dim. */
const OVERLAY_COLORS: Record<string, { color: string; symbol: string }> = {
  dark: { color: '#12151c', symbol: '#8b94a6' },
  light: { color: '#ffffff', symbol: '#4f5b6e' },
  amoled: { color: '#090909', symbol: '#8b94a6' },
  ocean: { color: '#0c1524', symbol: '#8b94a6' },
  forest: { color: '#0b160e', symbol: '#8b94a6' },
  dusk: { color: '#1b1610', symbol: '#8b94a6' }
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
