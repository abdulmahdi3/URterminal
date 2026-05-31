import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { CursorStyle, PtyDataEvent, PtyExitEvent } from '@shared/types'
import { agentLaunch } from '@shared/providers'
import { getAgentDescriptor } from './agents'
import { noteOutputChars } from './outputMetrics'
import { flashCopied } from '@renderer/store/copied'
import { useTokens } from '@renderer/store/tokens'
import { usePaneStatus } from '@renderer/store/paneStatus'
import '@xterm/xterm/css/xterm.css'

// 'Segoe UI'/'Tahoma' tail lets Arabic glyphs render (RTL) when present in output.
const DEFAULT_FONT_STACK =
  "'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Segoe UI', 'Tahoma', monospace"
// Current terminal font, updated live from settings and applied to every pane.
let currentFontFamily = DEFAULT_FONT_STACK
let currentFontSize = 13

/**
 * Live terminal options sourced from settings and applied to every pane.
 * Mutated in place by `setTerminalConfig` so event handlers created in
 * `createEntry` (copy-on-select, right-click paste) read the current values.
 */
const termCfg = {
  cursorStyle: 'block' as CursorStyle,
  cursorBlink: true,
  lineHeight: 1.0,
  letterSpacing: 0,
  scrollback: 3000,
  scrollSensitivity: 1,
  copyOnSelect: true,
  pasteOnRightClick: true,
  bell: false
}

/** Short terminal-bell blip (WebAudio, no asset). */
function playBell(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g)
    g.connect(ctx.destination)
    o.type = 'square'
    o.frequency.value = 880
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
    o.start()
    o.stop(ctx.currentTime + 0.13)
    window.setTimeout(() => void ctx.close(), 300)
  } catch {
    /* audio unavailable — ignore */
  }
}

/** Update terminal options from settings and apply them live to every open pane. */
export function setTerminalConfig(cfg: Partial<typeof termCfg> & { padding?: number }): void {
  const { padding, ...rest } = cfg
  if (padding !== undefined) {
    document.documentElement.style.setProperty('--term-pad', `${Math.max(0, padding)}px`)
  }
  Object.assign(termCfg, rest)
  for (const [id, entry] of pool) {
    const o = entry.term.options
    o.cursorStyle = termCfg.cursorStyle
    o.cursorBlink = termCfg.cursorBlink
    o.lineHeight = termCfg.lineHeight > 0 ? termCfg.lineHeight : 1
    o.letterSpacing = termCfg.letterSpacing
    o.scrollback = termCfg.scrollback
    o.scrollSensitivity = termCfg.scrollSensitivity > 0 ? termCfg.scrollSensitivity : 1
    fitTerminal(id)
    entry.term.refresh(0, entry.term.rows - 1)
  }
}
// Hide the boot loader only once this many bytes have streamed — early terminal
// setup sequences are tiny, so a threshold avoids hiding the loader before the
// CLI has actually painted anything.
const START_BYTES = 150

const darkTheme = {
  background: '#0b0d12',
  foreground: '#e7ecf3',
  cursor: '#4c8dff',
  selectionBackground: '#264f78',
  black: '#484f58',
  brightBlack: '#6e7681',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightWhite: '#f0f6fc'
}

// Per-app-theme terminal surface colors so the agent/shell background follows
// the selected theme (the ANSI palette is inherited from darkTheme). Each
// background matches the theme's --bg in themes.css so the pane and terminal
// surface are seamless.
const THEME_SURFACE: Record<string, Partial<typeof darkTheme>> = {
  dark: {},
  amoled: { background: '#000000' },
  ocean: { background: '#060c16', cursor: '#00b4e6', selectionBackground: '#16405e' },
  forest: { background: '#060e09', cursor: '#3fb950', selectionBackground: '#1c4026' },
  dusk: { background: '#100d08', cursor: '#e09a40', selectionBackground: '#473018' },
  // Light theme needs dark text on a light surface to stay readable.
  light: {
    background: '#f4f6fa',
    foreground: '#1a2230',
    cursor: '#2f74f0',
    selectionBackground: '#bcd0f0',
    black: '#1a2230',
    white: '#3b4757',
    brightWhite: '#1a2230'
  }
}

/** Live xterm theme, updated from the selected app theme via setTerminalTheme. */
let currentTheme: typeof darkTheme = { ...darkTheme }

/** Apply an app theme's surface colors to every terminal (and new ones). */
export function setTerminalTheme(themeName: string): void {
  currentTheme = { ...darkTheme, ...(THEME_SURFACE[themeName] ?? {}) }
  for (const [, entry] of pool) {
    entry.term.options.theme = currentTheme
    entry.term.refresh(0, entry.term.rows - 1)
  }
}

export interface TerminalOpts {
  command?: string
  /** explicit shell executable to spawn (e.g. "powershell.exe"); blank = OS default */
  shell?: string
  /** extra args for the shell binary (e.g. ["-d", "Ubuntu"] for a WSL distro) */
  shellArgs?: string[]
  cwd?: string
  /** command auto-typed once the shell is ready (pane templates) */
  startupCommand?: string
  /** when set, spawn an SSH session (via ssh2) instead of a local shell */
  ssh?: { target: string }
  onReady?: (ptyId: string, shell: string) => void
  onExit?: (code: number) => void
  /** fired once when the process produces its first output (boot finished) */
  onStarted?: () => void
}

// Ephemeral SSH credentials, keyed by pane id — set when the user connects and
// consumed once at spawn. Kept out of the pane/session state so passwords are
// never written to disk by the renderer (saving is handled in the main process).
const pendingSshCreds = new Map<
  string,
  { password?: string; savePassword?: boolean; startupCommand?: string }
>()
export function setSshCreds(
  paneId: string,
  creds: { password?: string; savePassword?: boolean; startupCommand?: string }
): void {
  pendingSshCreds.set(paneId, creds)
}

interface Entry {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  serialize: SerializeAddon
  command?: string
  cwd?: string
  ptyId: string | null
  onExit?: (code: number) => void
  onStarted?: () => void
  started: boolean
  bytes: number
  dispose: () => void
  lastCols: number
  lastRows: number
}

// ---- session restore seeding ---------------------------------------------
// When a saved/auto-saved session is restored, the workspace is hydrated with
// fresh pane ids; before that happens we stash, per pane id, the chat content
// to replay and/or the resume args to relaunch the agent with. `createEntry`
// consumes the seed exactly once on first spawn (re-mounts never respawn), so
// resume flags never fire twice and replayed history isn't duplicated.
interface RestoreSeed {
  /** serialized terminal buffer (ANSI) to write back into the pane before spawn */
  transcript?: string
  /** extra args to relaunch the agent with so it resumes (e.g. ["--continue"]) */
  resumeArgs?: string[]
}
const restoreSeeds = new Map<string, RestoreSeed>()

/** Stash restore data for a pane id; consumed when its terminal first spawns. */
export function seedRestore(paneId: string, seed: RestoreSeed): void {
  restoreSeeds.set(paneId, seed)
}

/**
 * Serialize a pane's current buffer (scrollback + screen) to a replayable ANSI
 * string — the faithful "what you see right now" snapshot used to persist chats.
 * `maxLines` caps the captured scrollback to bound file size.
 */
export function capturePane(paneId: string, maxLines = 2000): string {
  const entry = pool.get(paneId)
  if (!entry) return ''
  try {
    return entry.serialize.serialize({ scrollback: maxLines })
  } catch {
    return ''
  }
}

/** Whether a pane's process has already produced output (so no loader needed). */
export function isTerminalStarted(paneId: string): boolean {
  return pool.get(paneId)?.started ?? false
}

// ---- user-input notification (used by chain/telegram forwarding to detect a new turn) ----
// `data` is the raw keystroke(s) typed into the terminal, so listeners can both
// detect a new turn and reconstruct the submitted prompt.
type InputListener = (paneId: string, data: string) => void
const inputListeners = new Set<InputListener>()
export function onTerminalInput(cb: InputListener): () => void {
  inputListeners.add(cb)
  return () => inputListeners.delete(cb)
}

// ---- per-pane current input line (used by broadcast mode to grab what was typed) ----
// Reconstructed from raw keystrokes: printable chars append, backspace pops,
// Enter clears. Escape sequences (arrows, bracketed paste) are ignored.
const inputLines = new Map<string, string>()
const INPUT_ESC = new RegExp('\\u001B\\[[0-9;]*[~A-Za-z]|\\u001B[O][A-Za-z]?', 'g')

function noteInputLine(paneId: string, data: string): void {
  let buf = inputLines.get(paneId) ?? ''
  for (const ch of data.replace(INPUT_ESC, '')) {
    const code = ch.charCodeAt(0)
    if (code === 13 || code === 10) {
      // Enter submits the line — hand the clean, reconstructed prompt to the
      // learning recorder as an authoritative turn boundary (no-op in main
      // unless the learning layer is enabled).
      const submitted = buf.trim()
      if (submitted) window.api.learning?.turnMarker(paneId, submitted, Date.now())
      buf = ''
    } else if (code === 127 || code === 8) buf = buf.slice(0, -1)
    else if (code >= 32) buf += ch
  }
  inputLines.set(paneId, buf)
}

/** The text currently typed (not yet submitted) on a pane's input line. */
export function getInputLine(paneId: string): string {
  return inputLines.get(paneId) ?? ''
}

/** Forget a pane's typed line (after it's been submitted/broadcast). */
export function clearInputLine(paneId: string): void {
  inputLines.set(paneId, '')
}

/** Current visible screen text of a pane's terminal (the "result in current state"). */
export function getScreenText(paneId: string): string {
  const entry = pool.get(paneId)
  if (!entry) return ''
  const term = entry.term
  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < term.rows; i++) {
    const line = buf.getLine(buf.viewportY + i)
    lines.push(line ? line.translateToString(true) : '')
  }
  return lines.join('\n')
}

/** A single scrollback hit: buffer line index + the trimmed line text. */
export interface PaneMatch {
  line: number
  text: string
}

/**
 * Scan a pane's whole buffer (scrollback included) for `query`, case-insensitive.
 * Returns up to `max` matching lines — used by the workspace-wide search panel.
 */
export function findMatchesInPane(paneId: string, query: string, max = 40): PaneMatch[] {
  const entry = pool.get(paneId)
  if (!entry || !query) return []
  const needle = query.toLowerCase()
  const buf = entry.term.buffer.active
  const out: PaneMatch[] = []
  for (let i = 0; i < buf.length && out.length < max; i++) {
    const line = buf.getLine(i)
    if (!line) continue
    const text = line.translateToString(true)
    if (text.toLowerCase().includes(needle)) out.push({ line: i, text: text.trim() })
  }
  return out
}

/** Full terminal text including scrollback — used to extract the last agent result. */
export function getFullText(paneId: string): string {
  const entry = pool.get(paneId)
  if (!entry) return ''
  const buf = entry.term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i)
    lines.push(line ? line.translateToString(true) : '')
  }
  return lines.join('\n')
}

/**
 * Terminals (xterm + their PTY) live here, keyed by pane id, independent of
 * React mount/unmount. This keeps the running CLI and its on-screen buffer
 * intact when a pane is re-parented (zoom, drag-rearrange) instead of killing
 * and respawning it — which was causing duplicated/cut banners and slow zoom.
 */
const pool = new Map<string, Entry>()

// A SINGLE shared subscription to the pty data/exit streams, routing each event
// to the one terminal that owns the pane via a Map lookup. Previously every pane
// registered its own IPC listener and re-checked `paneId` on every chunk, so one
// output event was handed to all N panes' closures (O(N) per chunk). One listener
// + O(1) dispatch cuts that per-event work and the per-pane listener retention.
const dataRoutes = new Map<string, (e: PtyDataEvent) => void>()
const exitRoutes = new Map<string, (e: PtyExitEvent) => void>()
let routesInstalled = false
function ensurePtyRoutes(): void {
  if (routesInstalled) return
  routesInstalled = true
  window.api.onPtyData((e) => dataRoutes.get(e.paneId)?.(e))
  window.api.onPtyExit((e) => exitRoutes.get(e.paneId)?.(e))
}

function createEntry(paneId: string, container: HTMLElement, opts: TerminalOpts): Entry {
  const term = new Terminal({
    fontFamily: currentFontFamily,
    fontSize: currentFontSize,
    scrollback: termCfg.scrollback,
    cursorBlink: termCfg.cursorBlink,
    cursorStyle: termCfg.cursorStyle,
    lineHeight: termCfg.lineHeight > 0 ? termCfg.lineHeight : 1,
    letterSpacing: termCfg.letterSpacing,
    scrollSensitivity: termCfg.scrollSensitivity > 0 ? termCfg.scrollSensitivity : 1,
    allowProposedApi: true,
    theme: currentTheme
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const search = new SearchAddon()
  term.loadAddon(search)
  const serialize = new SerializeAddon()
  term.loadAddon(serialize)
  term.open(container)
  fit.fit()

  // Let the global hotkey layer own Ctrl+Tab / Ctrl+Shift+Tab (switch workspace).
  // Returning false stops xterm from translating them into a stray Tab/ESC[Z
  // sent to the shell; the event still bubbles to the window keydown handler.
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && ev.code === 'Tab') return false
    return true
  })

  // Consume any restore seed for this pane (set when a session is restored).
  // Replay the saved chat content into the buffer first, then a divider, so the
  // freshly spawned process / resumed agent prints below the restored history.
  const seed = restoreSeeds.get(paneId)
  restoreSeeds.delete(paneId)
  if (seed?.transcript) {
    term.write(seed.transcript)
    term.write('\r\n\x1b[90m── session restored ──\x1b[0m\r\n')
  }

  const entry: Entry = {
    term,
    fit,
    search,
    serialize,
    command: opts.command,
    cwd: opts.cwd,
    ptyId: null,
    onExit: opts.onExit,
    onStarted: opts.onStarted,
    started: false,
    bytes: 0,
    lastCols: term.cols,
    lastRows: term.rows,
    dispose: () => {}
  }

  const onData = term.onData((d) => {
    if (entry.ptyId) window.api.writePty(entry.ptyId, d)
    noteInputLine(paneId, d)
    inputListeners.forEach((cb) => cb(paneId, d))
  })
  // Copy-on-select: as soon as text is highlighted (mouse or keyboard), mirror it
  // to the clipboard. Fires on every selection change while dragging; the last
  // write wins, so the clipboard always holds the final selection.
  const onSelection = term.onSelectionChange(() => {
    if (!termCfg.copyOnSelect) return
    const sel = term.getSelection()
    if (sel) {
      void navigator.clipboard.writeText(sel).catch(() => {})
      flashCopied()
    }
  })
  const onBell = term.onBell(() => {
    if (termCfg.bell) playBell()
  })
  // Right-click to paste. Text is pasted as-is; an image on the clipboard is
  // written to a temp PNG and its path pasted (so the agent can read the file).
  // `term.paste` honors bracketed-paste mode, so multi-line text stays intact.
  const onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault()
    if (!termCfg.pasteOnRightClick) return
    void window.api
      .readClipboard()
      .then((clip) => {
        if (clip.imagePath) {
          term.paste(/\s/.test(clip.imagePath) ? `"${clip.imagePath}"` : clip.imagePath)
        } else if (clip.text) {
          term.paste(clip.text)
        }
      })
      .catch(() => {})
  }
  term.element?.addEventListener('contextmenu', onContextMenu)
  // Route this pane's pty stream through the shared dispatcher (the lookup key
  // already guarantees the event is ours, so no per-chunk paneId check needed).
  ensurePtyRoutes()
  dataRoutes.set(paneId, (e) => {
    if (!entry.started) {
      entry.bytes += e.data.length
      if (entry.bytes >= START_BYTES) {
        entry.started = true
        entry.onStarted?.()
      }
    }
    term.write(e.data)
    noteOutputChars(e.data.length)
    useTokens.getState().note(e.data.length, paneId)
  })
  exitRoutes.set(paneId, (e) => {
    if (entry.onExit) entry.onExit(e.exitCode)
    else term.write(`\r\n\x1b[90m[process exited: ${e.exitCode}]\x1b[0m\r\n`)
  })
  const offData = (): void => void dataRoutes.delete(paneId)
  const offExit = (): void => void exitRoutes.delete(paneId)

  entry.dispose = (): void => {
    try {
      onData.dispose()
      onSelection.dispose()
      onBell.dispose()
      term.element?.removeEventListener('contextmenu', onContextMenu)
    } catch {
      /* noop */
    }
    offData()
    offExit()
    if (entry.ptyId) window.api.killPty(entry.ptyId)
    try {
      term.dispose()
    } catch {
      /* noop */
    }
  }

  pool.set(paneId, entry)

  const creds = pendingSshCreds.get(paneId) ?? {}
  pendingSshCreds.delete(paneId)
  // Translate the agent id into the real program + args. Most agents spawn their
  // own id directly, but host-extension agents (e.g. `gh-copilot`) spawn `gh`
  // with launch args `['copilot']`. Resume args are appended after launch args.
  const launch = opts.command
    ? agentLaunch(getAgentDescriptor(opts.command), opts.command)
    : undefined
  const spawn = opts.ssh
    ? window.api.spawnSsh({
        paneId,
        target: opts.ssh.target,
        password: creds.password,
        savePassword: creds.savePassword,
        startupCommand: creds.startupCommand,
        cols: term.cols,
        rows: term.rows
      })
    : window.api.spawnPty({
        paneId,
        cols: term.cols,
        rows: term.rows,
        command: launch?.command,
        // launch args + resume args (e.g. `claude --continue`) when restoring a session
        commandArgs: launch ? [...launch.args, ...(seed?.resumeArgs ?? [])] : undefined,
        shell: opts.shell,
        shellArgs: opts.shellArgs,
        cwd: opts.cwd,
        startupCommand: opts.startupCommand
      })
  void spawn
    .then((res) => {
      entry.ptyId = res.ptyId
      opts.onReady?.(res.ptyId, res.shell)
    })
    .catch((err: Error) => {
      const msg = opts.ssh
        ? `\r\n\x1b[31mFailed to start SSH session.\x1b[0m\r\n${err.message}\r\n`
        : opts.command
          ? `\r\n\x1b[31mCould not launch "${opts.command}". Is it installed and on your PATH?\x1b[0m\r\n${err.message}\r\n`
          : `\r\n\x1b[31mFailed to start shell.\x1b[0m\r\n${err.message}\r\n`
      term.write(msg)
    })

  return entry
}

/** Attach the pane's terminal to `container`, creating + spawning it on first use. */
export function mountTerminal(paneId: string, container: HTMLElement, opts: TerminalOpts): void {
  let entry = pool.get(paneId)
  // command/cwd changed (e.g. switched agent) → tear down and start fresh
  if (entry && (entry.command !== opts.command || entry.cwd !== opts.cwd)) {
    disposeTerminal(paneId)
    entry = undefined
  }
  if (!entry) {
    createEntry(paneId, container, opts)
    return
  }
  entry.onExit = opts.onExit
  entry.onStarted = opts.onStarted
  if (entry.started) opts.onStarted?.() // re-attach (e.g. zoom): already running
  if (entry.term.element && entry.term.element.parentElement !== container) {
    container.appendChild(entry.term.element)
  }
  fitTerminal(paneId)
  entry.term.refresh(0, entry.term.rows - 1)
}

/**
 * Set the terminal font family + size and apply it live to every open pane.
 * An empty family falls back to the built-in monospace stack; a custom family
 * is layered on top of that stack for graceful fallback.
 */
export function setTerminalFont(family: string, size: number): void {
  const fam = family.trim()
  currentFontFamily = fam ? `${fam}, ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK
  currentFontSize = size > 0 ? size : 13
  for (const [id, entry] of pool) {
    entry.term.options.fontFamily = currentFontFamily
    entry.term.options.fontSize = currentFontSize
    fitTerminal(id)
    entry.term.refresh(0, entry.term.rows - 1)
  }
}

/** Bounds for Ctrl+scroll font zoom. */
const FONT_MIN = 8
const FONT_MAX = 32

/**
 * Adjust the terminal font size by `delta` px (Ctrl+scroll zoom), applying it
 * live to every open pane. Returns the clamped new size so the caller can
 * persist it to settings.
 */
export function bumpFontSize(delta: number): number {
  const next = Math.max(FONT_MIN, Math.min(FONT_MAX, currentFontSize + delta))
  if (next === currentFontSize) return next
  currentFontSize = next
  for (const [id, entry] of pool) {
    entry.term.options.fontSize = currentFontSize
    fitTerminal(id)
    entry.term.refresh(0, entry.term.rows - 1)
  }
  return next
}

/** Re-fit a terminal to its container and push the new size to the PTY (if changed). */
export function fitTerminal(paneId: string): void {
  const entry = pool.get(paneId)
  if (!entry) return
  try {
    entry.fit.fit()
    const { cols, rows } = entry.term
    if (entry.ptyId && (cols !== entry.lastCols || rows !== entry.lastRows)) {
      entry.lastCols = cols
      entry.lastRows = rows
      window.api.resizePty(entry.ptyId, cols, rows)
    }
  } catch {
    /* fit can throw if the element is detached mid-layout */
  }
}

/**
 * Force a pane's terminal to re-fit and repaint. xterm can render blank after
 * its element is re-parented into a freshly mounted container (e.g. moving a
 * pane to another workspace), so we fit + refresh across a couple of frames
 * once the new layout has settled.
 */
export function repaintTerminal(paneId: string): void {
  const run = (): void => {
    const entry = pool.get(paneId)
    if (!entry) return
    fitTerminal(paneId)
    entry.term.refresh(0, entry.term.rows - 1)
    entry.term.scrollToBottom()
  }
  requestAnimationFrame(() => {
    run()
    requestAnimationFrame(run)
  })
}

// ---- scrollback search (xterm search addon) ----
const SEARCH_DECORATIONS = {
  matchBackground: '#5a4a1a',
  matchBorder: '#d29922',
  matchOverviewRuler: '#d29922',
  activeMatchBackground: '#264f78',
  activeMatchBorder: '#4c8dff',
  activeMatchColorOverviewRuler: '#4c8dff'
}

/** Find the next/previous match of `query` in a pane's buffer, highlighting hits. */
export function searchInPane(paneId: string, query: string, dir: 'next' | 'prev'): void {
  const entry = pool.get(paneId)
  if (!entry) return
  if (!query) {
    entry.search.clearDecorations()
    return
  }
  const opts = { decorations: SEARCH_DECORATIONS }
  if (dir === 'next') entry.search.findNext(query, opts)
  else entry.search.findPrevious(query, opts)
}

/** Clear any search highlight in a pane. */
export function clearSearch(paneId: string): void {
  pool.get(paneId)?.search.clearDecorations()
}

/** Scroll a pane so the given buffer line sits near the top of the viewport. */
export function scrollPaneToLine(paneId: string, line: number): void {
  const entry = pool.get(paneId)
  if (!entry) return
  entry.term.scrollToLine(Math.max(0, line - 2))
}

/** Subscribe to result-count changes for a pane's search (resultIndex is -1 when none). */
export function onSearchResults(
  paneId: string,
  cb: (r: { resultIndex: number; resultCount: number }) => void
): () => void {
  const entry = pool.get(paneId)
  if (!entry) return () => {}
  const d = entry.search.onDidChangeResults(cb)
  return () => d.dispose()
}

/** Copy the active selection of a pane's terminal to the clipboard (keyboard copy). */
export function copySelection(paneId: string): void {
  const entry = pool.get(paneId)
  if (!entry) return
  const sel = entry.term.getSelection()
  if (!sel) return
  void navigator.clipboard.writeText(sel).catch(() => {})
  flashCopied()
}

/** Paste the clipboard into a pane's terminal (keyboard paste; image → temp path). */
export function pasteClipboard(paneId: string): void {
  const entry = pool.get(paneId)
  if (!entry) return
  void window.api
    .readClipboard()
    .then((clip) => {
      if (clip.imagePath) {
        entry.term.paste(/\s/.test(clip.imagePath) ? `"${clip.imagePath}"` : clip.imagePath)
      } else if (clip.text) {
        entry.term.paste(clip.text)
      }
    })
    .catch(() => {})
}

/** Permanently tear down a pane's terminal + PTY (called when the pane is closed). */
export function disposeTerminal(paneId: string): void {
  const entry = pool.get(paneId)
  if (!entry) return
  pool.delete(paneId)
  inputLines.delete(paneId)
  entry.dispose()
  useTokens.getState().clearPane(paneId)
  usePaneStatus.getState().remove(paneId)
}
