// Shared types used across main, preload, and renderer.
// Keep this free of any node/electron/dom imports so all processes can use it.

import type { DiffHunk } from './diff'

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'lmstudio'

/**
 * Real runtime state of an agent CLI, probed live in the main process:
 *   `ready`   — installed on PATH and authenticated (ready to talk)
 *   `signin`  — installed but not authenticated (needs sign-in / a key)
 *   `update`  — installed but a newer version is available
 *   `missing` — not installed (not on PATH)
 */
export type AgentRuntimeStatus = 'ready' | 'signin' | 'update' | 'missing'

export type PaneType = 'ai' | 'shell' | 'empty' | 'stream' | 'openrouter' | 'uregant'

export interface ShellPaneState {
  shell: string
  /** extra args for the shell binary (e.g. ["-d", "Ubuntu"] for a WSL distro) */
  args?: string[]
  cwd?: string
  ptyId?: string
  /** command auto-typed once the shell is ready (used by pane templates) */
  startupCommand?: string
  /** when set, this pane is an SSH session (target = "user@host[:port]") */
  ssh?: { target: string }
}

/** An "AI pane" is a terminal that auto-launches an agent CLI (claude, codex, …). */
export interface AgentPaneState {
  /** command typed into the shell on launch, e.g. "claude" */
  command: string
  cwd?: string
  ptyId?: string
  shell?: string
  /** when this agent was opened over SSH, the target whose mount/conn it owns */
  sshTarget?: string
  /**
   * Caller-pinned conversation id for agents that support addressable sessions
   * (currently Claude, via `--session-id`). Assigned once when the pane is born
   * so the pane always owns ONE conversation: launched fresh with
   * `claude --session-id <id>`, and on restore relaunched with
   * `claude --resume <id>` — which is what lets two panes in the same folder keep
   * their own chats instead of both resuming the most-recent one.
   */
  sessionId?: string
}

/**
 * A "stream pane" runs Claude in `--output-format stream-json` and renders the
 * event stream as native cards (tool calls, diffs, todos) instead of raw xterm
 * text. Each prompt spawns a fresh `claude -p` turn; continuity is kept in the
 * renderer's stream store via the captured session id (`--resume`).
 */
export interface StreamPaneState {
  /** the agent CLI to drive in stream-json mode (Claude only, for now) */
  command: string
  cwd?: string
}

/** Token/cost summary for one OpenRouter reply (OpenRouter returns `cost` in USD). */
export interface OrUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  costUsd?: number
}

/** One message in an OpenRouter chat pane's transcript. */
export interface OrMessage {
  role: 'user' | 'assistant'
  content: string
  usage?: OrUsage
  /** set on an assistant message when the turn failed (content may be partial) */
  error?: string
}

/**
 * An OpenRouter chat pane: a native HTTP chat against OpenRouter (200+ models),
 * not a terminal. The transcript is persisted so it survives a restart.
 */
export interface OpenRouterPaneState {
  /** OpenRouter model id, e.g. "anthropic/claude-3.5-sonnet" */
  model: string
  /** persisted conversation transcript */
  messages?: OrMessage[]
  /** reserved (phase 2, no UI yet): system prompt */
  system?: string
  /** reserved (phase 2, no UI yet): sampling temperature (default 0.7) */
  temperature?: number
}

/** State for a Uregant local-orchestrator pane. */
export interface UregantPaneState {
  /** Ollama model id driving the loop, e.g. "qwen3.5:latest" */
  model?: string
}

/** A single checkable item in a pane's to-do list. */
export interface TodoItem {
  id: string
  text: string
  done: boolean
}

export interface Pane {
  id: string
  type: PaneType
  title: string
  agent?: AgentPaneState
  shell?: ShellPaneState
  stream?: StreamPaneState
  openrouter?: OpenRouterPaneState
  uregant?: UregantPaneState
  /** chat id this pane forwards output to, if linked */
  telegramChatId?: string
  /** pane IDs this pane pipes its output into (supports fan-out to multiple) */
  pipeTargets?: string[]
  /** free-form note attached to the pane (shown via the header note button) */
  notes?: string
  /** checkable to-do list attached to the pane (shown in the note popover) */
  todos?: TodoItem[]
}

/** Chat content for a saved session: per-pane terminal transcript (replayable ANSI). */
export interface SessionData {
  /** paneId -> serialized terminal buffer (ANSI snapshot produced by addon-serialize) */
  transcripts: Record<string, string>
}

/** What the main process can tell us about a Claude `--session-id` conversation on disk. */
export interface ClaudeSessionInfo {
  /** whether a `<id>.jsonl` transcript exists under ~/.claude/projects (decides resume vs re-create) */
  exists: boolean
  /** human-readable subject, from the session's `aiTitle` (falls back to first prompt) */
  title?: string
  /** working directory the conversation ran in */
  cwd?: string
  /** last-modified time of the transcript file (ms) */
  updatedAt?: number
}

/**
 * A single resumable chat shown in the sessions menu's "Chats" list. Keyed by the
 * Claude session id so clicking it relaunches `claude --resume <sessionId>`.
 */
export interface ChatSession {
  /** Claude `--session-id` / `--resume` uuid */
  sessionId: string
  /** subject line (from the session's aiTitle) shown in the list */
  title: string
  /** folder the conversation belongs to */
  cwd?: string
  /** agent command that owns it (currently always "claude") */
  agent: string
  /** when we last saw/updated this entry (ms) */
  updatedAt: number
  /** user-pinned: floats to the top and is never auto-dropped */
  pinned?: boolean
  /** Claude's transcript is gone — shown dimmed; recomputed on every refresh */
  missing?: boolean
  /** user dismissed it from the list ("Remove") — hidden from the menu, kept so
   *  a live pane / next launch can't silently resurrect it */
  hidden?: boolean
}

/** One workspace's panes + layout inside an auto-saved snapshot. */
export interface PersistedWorkspace {
  id: string
  name: string
  panes: Record<string, Pane>
  /** mosaic layout tree (pane-id leaves); kept loose to avoid importing react-mosaic here */
  layout: unknown
}

/**
 * Full auto-saved snapshot of the whole app, written on change + on close.
 *
 * Pane chat content is NOT inlined here — it streams to per-pane transcript logs
 * in the main process (see TranscriptStore) and is referenced by pane id, so the
 * synchronous close-flush stays cheap and the history isn't capped to what fits
 * in one JSON blob. `panes`/`layout`/`transcripts` remain for back-compat reading
 * of pre-multi-workspace snapshots.
 */
export interface LastSessionPayload {
  /** every workspace (tabs), not just the active one */
  workspaces?: PersistedWorkspace[]
  /** id of the workspace that was on screen */
  activeWorkspaceId?: string
  /** paneId -> lines scrolled up from the bottom (0 = at bottom) */
  scroll?: Record<string, number>
  /** epoch ms this snapshot was written (used to archive it into the session list) */
  savedAt?: number

  // ---- legacy single-workspace fields (still read for back-compat) ----
  panes?: Record<string, Pane>
  layout?: unknown
  transcripts?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Settings (renderer-safe view — secrets are never sent here in full)
// ---------------------------------------------------------------------------

export interface ProviderSettingsPublic {
  anthropic: { keySet: boolean; keyPreview?: string }
  openai: { keySet: boolean; keyPreview?: string }
  gemini: { keySet: boolean; keyPreview?: string }
  openrouter: { keySet: boolean; keyPreview?: string }
  ollama: { baseUrl: string }
  lmstudio: { baseUrl: string }
}

export interface TelegramSettingsPublic {
  tokenSet: boolean
  tokenPreview?: string
  defaultChatId?: string
  running: boolean
  /** bot @username once connected (getMe succeeded) */
  botUsername?: string
  /** last connection/polling error, surfaced in the UI when the bot isn't running */
  error?: string
}

export type ThemeName = 'dark' | 'light'

/** A reusable saved prompt or shell command (may contain {{variables}}). */
export interface SnippetItem {
  id: string
  name: string
  body: string
  kind: 'prompt' | 'shell'
}

/** A saved sequence of commands/prompts replayed into a pane, one line at a time. */
export interface MacroItem {
  id: string
  name: string
  /** each entry is one command/prompt line, submitted in order */
  steps: string[]
}

/** A saved pane configuration that can be spawned in one click. */
export interface PaneTemplate {
  id: string
  name: string
  type: 'ai' | 'shell'
  agentCommand?: string
  shell?: string
  shellArgs?: string[]
  cwd?: string
  /** command auto-typed once the shell is ready (shell templates) */
  startupCommand?: string
}

export type CursorStyle = 'block' | 'bar' | 'underline'
export type NotifySound = 'chime' | 'beep'

/**
 * Which to-do source the pane title-bar note button shows:
 *   'notes'    — the pane's own free-form note + checklist (local, per pane)
 *   'ticktick' — your open TickTick tasks (across projects)
 *   'google'   — your open Google Tasks (across lists)
 */
export type PaneNotesSource = 'notes' | 'ticktick' | 'google'

/** Free-form user preferences persisted as one JSON blob via electron-store. */
export interface AppPrefs {
  /** desktop notification when an agent finishes a turn */
  notifyOnDone: boolean
  /** play a short sound when an agent finishes a turn */
  notifySound: boolean
  /** also send a Telegram "finished" message on turn completion */
  telegramNotifyOnDone: boolean
  /** Telegram chat IDs allowed to control the app (empty = allow any) */
  telegramChatWhitelist: string[]
  /** local control HTTP server (127.0.0.1) — list/open panes + send prompts from scripts */
  controlServerEnabled: boolean
  /** port the local control server listens on */
  controlServerPort: number
  /** bearer token required by the local control server ('' = not yet generated) */
  controlServerToken: string
  /** terminal font family ('' = built-in default) */
  fontFamily: string
  /** terminal font size in px */
  fontSize: number
  /** reopen the last workspace (panes + layout) on launch */
  autoRestore: boolean
  /** saved reusable prompts / commands */
  snippets: SnippetItem[]
  /** saved command sequences replayed into a pane */
  macros: MacroItem[]
  /** saved pane configurations */
  templates: PaneTemplate[]
  /** recent SSH targets (most recent first, e.g. "user@host"), shown by the SSH button */
  sshHosts: string[]
  /** saved hosts in the SSH connections manager (richer than sshHosts recents) */
  sshSavedHosts: SshHost[]

  // ---- appearance / terminal ----
  /** app color theme (matches APP_THEMES: dark, amoled, ocean, forest, dusk, light, system) */
  appTheme: string
  /** terminal caret shape */
  cursorStyle: CursorStyle
  /** terminal caret blink */
  cursorBlink: boolean
  /** terminal line height multiplier (1.0 = default) */
  lineHeight: number
  /** terminal letter spacing in px */
  letterSpacing: number
  /** terminal scrollback buffer size (lines) */
  scrollback: number
  /** inner padding around terminal contents (px) */
  terminalPadding: number
  /** show the per-pane title/header bar */
  showPaneHeaders: boolean
  /** which to-do source the pane title-bar note button shows by default
   *  (local pane notes, TickTick, or Google Tasks) */
  paneNotesSource: PaneNotesSource
  /** terminal scroll speed multiplier */
  scrollSensitivity: number
  /** width (px) of the scrollbars (terminal viewport + scrollable UI) */
  scrollbarWidth: number
  /** play a short sound when the terminal emits a bell (\\a) */
  terminalBell: boolean

  // ---- behavior / workflow ----
  /** warn before closing a pane whose process is still running */
  confirmClose: boolean
  /** working directory new shell panes open in ('' = home) */
  defaultShellCwd: string
  /** debounce (seconds) before the live workspace is auto-saved to disk */
  autoSaveSeconds: number
  /** cap on how many panes are restored on launch (0 = unlimited) */
  maxRestorePanes: number
  /** focus a newly created pane automatically */
  focusNewPane: boolean
  /** copy the terminal selection to the clipboard automatically */
  copyOnSelect: boolean
  /** paste on right-click in a terminal */
  pasteOnRightClick: boolean
  /** clear the saved workspace on exit (next launch starts empty) */
  clearWorkspaceOnExit: boolean
  /** target language for the "Translate selection" command (sent to open agents) */
  defaultLanguage: string
  /** OPT-IN: mount the remote folder (SSHFS) when opening an agent over SSH so it can edit
   *  files in place. Off by default — the agent already manages the server via the urssh
   *  helper; mounting needs SSHFS-Win and can slow the open if the server's slow to mount. */
  sshAgentMount: boolean

  // ---- notifications ----
  /** only fire desktop/sound notifications when the window is NOT focused */
  notifyOnlyUnfocused: boolean
  /** notification chime volume (0–100) */
  notifyVolume: number
  /** which built-in notification sound to play */
  notifySoundName: NotifySound
  /** Discord incoming-webhook URL — agent-finished notices are posted here */
  discordWebhook: string
  /** Slack incoming-webhook URL — agent-finished notices are posted here */
  slackWebhook: string

  // ---- app lifecycle ----
  /** last app version whose "What's new" tour the user has seen (drives the
   *  first-launch-after-update preview). Empty until the tour first records one. */
  lastSeenVersion: string
  /** soft session token budget (approx output tokens); 0 = off. Drives the
   *  status-bar usage meter and 80%/100% warning toasts. */
  sessionTokenBudget: number
  /** whether the first-run agent-doctor (install checklist) has been auto-shown */
  agentSetupSeen: boolean
  /** user-defined theme (applied when appTheme === 'custom') — a base surface,
   *  text, and accent from which the rest of the palette is derived */
  customTheme: { bg: string; text: string; accent: string }
  /** whole-app UI zoom factor (Chromium zoom); 1 = 100%. Ctrl +/-/0 adjust it. */
  uiZoom: number
}

export const DEFAULT_PREFS: AppPrefs = {
  notifyOnDone: false,
  notifySound: false,
  telegramNotifyOnDone: false,
  telegramChatWhitelist: [],
  controlServerEnabled: false,
  controlServerPort: 8777,
  controlServerToken: '',
  fontFamily: '',
  fontSize: 13,
  autoRestore: true,
  snippets: [],
  macros: [],
  templates: [],
  sshHosts: [],
  sshSavedHosts: [],

  appTheme: 'dark',
  cursorStyle: 'block',
  cursorBlink: true,
  lineHeight: 1.0,
  letterSpacing: 0,
  scrollback: 3000,
  terminalPadding: 8,
  showPaneHeaders: true,
  paneNotesSource: 'notes',
  scrollSensitivity: 1,
  scrollbarWidth: 14,
  terminalBell: false,

  confirmClose: false,
  defaultShellCwd: '',
  autoSaveSeconds: 1,
  maxRestorePanes: 0,
  focusNewPane: true,
  copyOnSelect: true,
  pasteOnRightClick: true,
  clearWorkspaceOnExit: false,
  defaultLanguage: 'English',
  sshAgentMount: false,

  notifyOnlyUnfocused: false,
  notifyVolume: 60,
  notifySoundName: 'chime',
  discordWebhook: '',
  slackWebhook: '',

  lastSeenVersion: '',
  sessionTokenBudget: 0,
  agentSetupSeen: false,
  customTheme: { bg: '#0b0d12', text: '#e7ecf3', accent: '#4c8dff' },
  uiZoom: 1
}

/** External to-do services the user can connect for syncing tasks. */
export type IntegrationId = 'todoist' | 'ticktick' | 'microsoftTodo' | 'googleTasks' | 'notion'

/** Public view of a connected integration — never exposes raw token, just status. */
/** Update-related payload pushed from the main-process auto-updater. */
export interface UpdaterStatus {
  version: string
  releaseNotes?: string
  releaseDate?: string
}

/** Download-progress tick while a new version is being fetched. */
export interface UpdaterProgress {
  /** 0–100 percent of the installer downloaded. */
  percent: number
  version?: string
}

/** Result of a manual "check for updates" trigger from the renderer. */
export type UpdaterCheckResult =
  /** A newer release exists; download has started (watch for updater:downloaded). */
  | { status: 'available'; version: string }
  /** Already on the latest release. */
  | { status: 'not-available'; version: string }
  /** Auto-update isn't possible in this build (dev run / portable). */
  | { status: 'unsupported' }
  /** The check failed (offline, GitHub unreachable, etc.). */
  | { status: 'error'; message: string }

export interface IntegrationStatus {
  /** true if a credential/token is stored for this service */
  connected: boolean
  /** epoch ms the user connected (or last refreshed the token) */
  connectedAt?: number
}
/** TickTick has extra setup fields (client_id/client_secret) it needs from the user. */
export interface TickTickStatus extends IntegrationStatus {
  /** the user's app client_id, shown plain (it's not secret on its own) */
  clientId?: string
  /** whether a client_secret has been saved (not the value itself) */
  clientSecretSet: boolean
}
export interface IntegrationsPublic {
  todoist: IntegrationStatus
  ticktick: TickTickStatus
  microsoftTodo: IntegrationStatus
  googleTasks: IntegrationStatus
  notion: IntegrationStatus
}

// ---------------------------------------------------------------------------
// TickTick open API surface (subset we actually use)
// ---------------------------------------------------------------------------

export interface TickTickProject {
  id: string
  name: string
  color?: string
  closed?: boolean
  viewMode?: string
  kind?: 'TASK' | 'NOTE' | string
}

export interface TickTickChecklistItem {
  id: string
  title: string
  status: number // 0 = normal, 1 = completed
  startDate?: string
  isAllDay?: boolean
  timeZone?: string
  sortOrder?: number
  completedTime?: string
}

export interface TickTickTask {
  id: string
  projectId: string
  title: string
  content?: string
  desc?: string
  isAllDay?: boolean
  startDate?: string
  dueDate?: string
  timeZone?: string
  reminders?: string[]
  tags?: string[]
  repeatFlag?: string
  priority?: number // 0 None, 1 Low, 3 Medium, 5 High
  status?: number // 0 Open, 2 Completed
  completedTime?: string
  sortOrder?: number
  items?: TickTickChecklistItem[]
}

export interface TickTickProjectData {
  project: TickTickProject
  tasks: TickTickTask[]
  columns?: unknown[]
}

// ---- Google Tasks ----
export interface GoogleTaskList {
  id: string
  title: string
}
export interface GoogleTask {
  id: string
  title: string
  notes?: string
  status: 'needsAction' | 'completed'
  /** due date (RFC 3339; Google only stores the date part) */
  due?: string
  completed?: string
  updated?: string
}
/** A task list plus its (open) tasks — what the agenda is built from. */
export interface GoogleTaskGroup {
  list: GoogleTaskList
  tasks: GoogleTask[]
}

export interface SettingsPublic {
  providers: ProviderSettingsPublic
  telegram: TelegramSettingsPublic
  defaultProvider: ProviderId
  defaultModel: string
  /** agent CLI new AI panes launch by default (e.g. "claude") */
  defaultAgent: string
  /** shell binary new shell panes launch by default ("" = OS default) */
  defaultShell: string
  /** args for the default shell (e.g. ["-d", "Ubuntu"]) */
  defaultShellArgs: string[]
  theme: ThemeName
  accentColor: string
  prefs: AppPrefs
  integrations: IntegrationsPublic
}

/** A standalone, app-wide note (lives outside any pane; persisted to disk). */
export interface NoteDoc {
  id: string
  title: string
  body: string
  /** optional tags for grouping in the notes panel */
  tags?: string[]
  /** optional inline to-do list */
  todos?: TodoItem[]
  createdAt: number
  updatedAt: number
  /** "pinned to top" in the notes panel sidebar */
  pinned?: boolean
}

// Patch shapes the renderer may send to mutate settings.
export interface SettingsPatch {
  providerKey?: { provider: ProviderId; key: string | null }
  ollamaBaseUrl?: string
  lmstudioBaseUrl?: string
  telegramToken?: string | null
  telegramDefaultChatId?: string | null
  defaultProvider?: ProviderId
  defaultModel?: string
  defaultAgent?: string
  defaultShell?: string
  defaultShellArgs?: string[]
  theme?: ThemeName
  accentColor?: string
  /** shallow-merged into the stored prefs blob */
  prefs?: Partial<AppPrefs>
  /** set or clear a to-do service credential (token = null disconnects) */
  integrationToken?: { id: IntegrationId; token: string | null }
  /** set TickTick app client_id (registered on developer.ticktick.com); null clears it */
  tickTickClientId?: string | null
  /** set TickTick app client_secret; null clears it */
  tickTickClientSecret?: string | null
}

// ---------------------------------------------------------------------------
// PTY (shell) streaming
// ---------------------------------------------------------------------------

export interface PtySpawnRequest {
  paneId: string
  shell?: string
  /** extra args for the shell binary (e.g. ["-d", "Ubuntu"] for a WSL distro) */
  shellArgs?: string[]
  cwd?: string
  cols: number
  rows: number
  /** optional command typed into the shell once it is ready (e.g. "claude") */
  startupCommand?: string
  /** spawn this program directly as the pty process (e.g. "claude"), instead of a shell */
  command?: string
  /** extra args for the directly-spawned `command` (e.g. ["--continue"] to resume a session) */
  commandArgs?: string[]
  /** reset this pane's transcript log at spawn — used when a resumable agent will
   *  reprint its own history (e.g. `claude --continue`) so it isn't duplicated. */
  freshLog?: boolean
}

/** Result of setting up "agent over SSH" for a target. */
export interface SshAgentResult {
  ok: boolean
  /** local working directory for the agent pane: the SSHFS mount path, else home */
  cwd?: string
  /** starter message to inject into the agent pane (when ok) */
  instruction?: string
  /** true if the remote folder was mounted locally via SSHFS */
  mounted?: boolean
  /** drive letter of the SSHFS mount (e.g. "Z") when mounted */
  drive?: string
  /** true when SSHFS-Win isn't installed (agent still works via urssh; file editing needs it) */
  needsSshfs?: boolean
  /** non-fatal mount failure (the agent still opened via the urssh fallback) */
  mountError?: string
  /** failure reason (when !ok) */
  error?: string
}

/** Whether the SSHFS toolchain (WinFsp + SSHFS-Win) is available, + how to get it. */
export interface SshfsStatus {
  installed: boolean
  /** absolute path to sshfs.exe when found */
  sshfsPath?: string
  /** one-line winget command to install the toolchain */
  installCommand: string
  /** docs/download URL */
  url: string
}

/** How a saved SSH host authenticates. */
export type SshAuthMethod = 'key' | 'password' | 'ask'

/**
 * A saved SSH host in the connections manager. The live target string is derived
 * as `user@host[:port]`; everything else is metadata for organizing/auth.
 */
export interface SshHost {
  id: string
  /** display label, e.g. "prod-web-1" (falls back to host when empty) */
  name: string
  user: string
  /** hostname or IP */
  host: string
  /** SSH port (22 default) */
  port: number
  /** folder/group name for the sidebar ('' = Ungrouped) */
  group: string
  /** freeform tags, e.g. ["nginx", "ubuntu"] */
  tags: string[]
  favorite: boolean
  authMethod: SshAuthMethod
  /** path to the private key when authMethod === 'key' */
  identityFile?: string
  /** epoch ms of the last successful connect */
  lastUsedAt?: number
  /** number of times this host has been connected */
  sessionCount: number
}

/** A private key found in ~/.ssh, for the identity-file picker. */
export interface SshKeyInfo {
  /** absolute path to the private key */
  path: string
  /** short display name, e.g. "id_ed25519" */
  name: string
  /** key type when detectable, e.g. "ED25519" / "RSA" */
  type?: string
  /** approximate bit strength when detectable */
  bits?: number
  /** OpenSSH SHA256 fingerprint of the matching .pub key, e.g. "SHA256:n8Xq…4kP2" */
  fingerprint?: string
}

/** A host parsed out of ~/.ssh/config for the Import action. */
export interface SshConfigHost {
  name: string
  host: string
  user: string
  port: number
  identityFile?: string
}

/** A saved credential listed in the vault tab. */
export interface SshCredential {
  /** the host target the credential belongs to ("user@host[:port]") */
  target: string
  /** what kind of secret is stored */
  type: 'password' | 'key'
}

/** Open an SSH session that streams through the same pty:data/pty:exit channels. */
export interface SshSpawnRequest {
  paneId: string
  /** "user@host" or "user@host:port" */
  target: string
  /** password for a fresh connection; omit to use a previously saved one */
  password?: string
  /** persist the password (encrypted) for next time */
  savePassword?: boolean
  /** auth strategy; defaults to password when omitted */
  authMethod?: SshAuthMethod
  /** private-key path when authMethod === 'key' */
  identityFile?: string
  cols: number
  rows: number
}

export interface PtyDataEvent {
  ptyId: string
  paneId: string
  data: string
}

export interface PtyExitEvent {
  ptyId: string
  paneId: string
  exitCode: number
}

/** Request to start a streaming OpenRouter chat turn for a pane. */
export interface OrSendRequest {
  paneId: string
  model: string
  /** the conversation so far (user/assistant); system is passed separately */
  messages: { role: 'user' | 'assistant'; content: string }[]
  temperature?: number
  system?: string
}

/** main -> renderer: an incremental chunk of assistant text for a pane. */
export interface OrDeltaEvent {
  paneId: string
  delta: string
}

/** main -> renderer: a pane's turn finished (usage + finish reason). */
export interface OrDoneEvent {
  paneId: string
  usage?: OrUsage
  /** 'stop' | 'length' | 'aborted' | … */
  finishReason?: string
}

/** main -> renderer: a pane's turn failed. */
export interface OrErrorEvent {
  paneId: string
  message: string
}

/** A model from OpenRouter's catalog (for the in-pane picker). */
export interface OrModelInfo {
  id: string
  name?: string
  contextLength?: number
  /** USD per token */
  promptPrice?: number
  completionPrice?: number
}

/** OpenRouter account credit/usage snapshot (GET /api/v1/key). */
export interface OrCredits {
  remaining?: number
  usage?: number
  limit?: number | null
}

/** A live PTY process, surfaced to the renderer's task manager. */
export interface PtyTaskInfo {
  ptyId: string
  paneId: string
  pid: number
  /** the shell or program that was launched (e.g. "powershell.exe", "claude") */
  shell: string
  /** epoch ms when the process was spawned */
  startedAt: number
}

/** A single OS process row for the system tab of the task manager. */
export interface SystemProcess {
  pid: number
  name: string
  /** working-set memory in MB */
  memMB: number
  /** CPU usage 0–100, derived from the delta of cumulative CPU time between samples */
  cpuPercent: number
}

/** Clipboard contents resolved in the main process (image wins over text). */
export interface ClipboardContent {
  text?: string
  /** absolute path to a temp PNG written from a clipboard image, if any */
  imagePath?: string
}

// ---------------------------------------------------------------------------
// Pane registry (sent from renderer → main so Telegram commands can inspect)
// ---------------------------------------------------------------------------

export interface PaneInfo {
  /** 1-based display number in layout leaf order */
  number: number
  id: string
  type: PaneType
  title: string
  agentCommand?: string
  shellName?: string
  linkedChatId?: string
  /** working directory the pane was launched in, if known */
  cwd?: string
}

// ---------------------------------------------------------------------------
// Telegram bridge
// ---------------------------------------------------------------------------

export interface TelegramInbound {
  /** target pane the message should be injected into as a prompt */
  paneId: string
  text: string
  chatId: string
}

export interface TelegramStatus {
  running: boolean
  error?: string
  botUsername?: string
}

/** Request from Telegram (/run) to open a new pane remotely. */
export interface TelegramCreatePane {
  type: 'ai' | 'shell'
  /** agent CLI for ai panes (e.g. "claude") */
  agentCommand?: string
  /** shell binary for shell panes (e.g. "powershell.exe") */
  shell?: string
  /** working directory to launch in */
  cwd?: string
  /** chat that requested it — the new pane is auto-linked back to it */
  chatId: string
}

/** A pane the local control server asked the renderer to open. */
export interface ControlCreatePane {
  type: 'ai' | 'shell'
  /** agent CLI for ai panes (e.g. "claude") */
  command?: string
  /** shell binary for shell panes */
  shell?: string
  /** working directory to launch in */
  cwd?: string
}

/** Running state of the local control server, for the Settings panel. */
export interface ControlServerStatus {
  running: boolean
  port?: number
  error?: string
}

/** One workspace tab, as shown in the web dashboard. */
export interface DashboardWorkspace {
  id: string
  name: string
  active: boolean
}

/** Snapshot the renderer pushes to main so the web dashboard can render + drive
 *  the app: the workspace tabs, the active workspace's panes, and the focus. */
export interface DashboardState {
  workspaces: DashboardWorkspace[]
  panes: PaneInfo[]
  activePaneId: string | null
}

// ---------------------------------------------------------------------------
// Perf
// ---------------------------------------------------------------------------

export interface PerfSample {
  mainRssMB: number
  heapUsedMB: number
  /** Main-process CPU usage since the previous sample, 0–100 (per core-second). */
  cpuPercent: number
  timestamp: number
}

/**
 * Live Claude usage from Anthropic's OAuth usage endpoint (the same source as
 * `/usage`). Account-global, not per-pane. `percent` is the real plan
 * utilization; `resetInMs` counts down to the window reset.
 */
export interface ClaudeUsageWindow {
  /** Plan utilization for this window, 0–100 (rounded). */
  percent: number
  /** Milliseconds until this window resets. */
  resetInMs: number
}
export interface ClaudeUsage {
  /** A usage reading was obtained (token present + endpoint answered). */
  ok: boolean
  /** Rolling 5-hour window. */
  fiveHour: ClaudeUsageWindow | null
  /** Rolling 7-day window. */
  sevenDay: ClaudeUsageWindow | null
}

// ---------------------------------------------------------------------------
// Window controls + file save (frameless window)
// ---------------------------------------------------------------------------

export interface FileSaveRequest {
  /** Suggested file name shown in the save dialog. */
  defaultName: string
  /** UTF-8 contents to write. */
  contents: string
}

export interface FileSaveResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

/** Apply one file's parsed diff hunks to disk (the inline diff-review feature). */
export interface DiffApplyRequest {
  /** working folder the file path is resolved against (the pane's cwd) */
  cwd: string
  /** target file path — relative to cwd, or an absolute path that stays inside it */
  file: string
  hunks: DiffHunk[]
  /** create the file from the additions (ignores any on-disk content) */
  isNew?: boolean
  /** delete the file instead of writing */
  isDelete?: boolean
}

export interface DiffApplyResult {
  ok: boolean
  /** absolute path written / removed on success */
  path?: string
  error?: string
}

/** One cross-session search result: a past Claude conversation that matched. */
export interface SessionHit {
  /** Claude session id (resume target) */
  sessionId: string
  /** the conversation's subject (aiTitle or first prompt) */
  title?: string
  /** working directory the conversation ran in */
  cwd?: string
  /** last-modified epoch ms */
  when: number
  /** matched excerpt with surrounding context */
  snippet: string
}

/** An MCP server entry in a project's .mcp.json. */
export interface McpServer {
  name: string
  command: string
  args: string[]
}

/** Git working-tree summary for a folder (null when it isn't a git repo). */
export interface GitStatus {
  /** current branch name, or a short SHA when detached */
  branch: string
  /** commits ahead of upstream */
  ahead: number
  /** commits behind upstream */
  behind: number
  /** files with staged changes */
  staged: number
  /** tracked files with unstaged changes */
  unstaged: number
  /** untracked files */
  untracked: number
  /** any uncommitted change at all */
  dirty: boolean
}

// ---------------------------------------------------------------------------
// IPC channel names — single source of truth.
// ---------------------------------------------------------------------------

export const IPC = {
  // app info (version, etc.)
  appInfo: 'app:info',
  // relaunch the whole app (used after installing an agent so PATH is re-read)
  appRelaunch: 'app:relaunch',
  // show an OS notification (e.g. when an agent finishes installing)
  appNotify: 'app:notify',

  // settings
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  settingsChanged: 'settings:changed',

  // providers: discover installed models from a local server (Ollama / LM Studio)
  providersDiscoverModels: 'providers:discover-models',

  // pty
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyList: 'pty:list',
  ptyData: 'pty:data', // main -> renderer (event)
  ptyExit: 'pty:exit', // main -> renderer (event)

  // shells (list installed WSL distros for the shell launcher)
  shellListWsl: 'shell:list-wsl',
  // which: report which of the given commands are installed on PATH
  commandsCheck: 'shell:check-commands',
  // agents: discover the merged agent list (built-ins + manifest + gh extensions)
  agentsDiscover: 'agents:discover',
  // agents: run an agent's install command (one-click install from the doctor)
  agentsInstall: 'agents:install',
  // agents: probe each agent CLI's real status (installed + authenticated) by command
  agentsStatus: 'agents:status',
  // openrouter: native streaming chat pane — send/stop a turn, list models, credits.
  // delta/done/error are main -> renderer events keyed by paneId.
  openrouterSend: 'openrouter:send',
  openrouterStop: 'openrouter:stop',
  openrouterModels: 'openrouter:models',
  openrouterCredits: 'openrouter:credits',
  openrouterDelta: 'openrouter:delta', // main -> renderer (event)
  openrouterDone: 'openrouter:done', // main -> renderer (event)
  openrouterError: 'openrouter:error', // main -> renderer (event)

  // uregant: local AI orchestrator — loop controller lives in MAIN (uregant/controller.ts).
  // renderer -> main commands:
  uregantStart: 'uregant:start',
  uregantApprove: 'uregant:approve',
  uregantDeny: 'uregant:deny',
  uregantStop: 'uregant:stop',
  uregantResync: 'uregant:resync',
  uregantToolResult: 'uregant:tool-result', // renderer -> main: result of a dispatched pane tool
  uregantExec: 'uregant:exec', // renderer -> main (invoke): headless run_command
  // main -> renderer events:
  uregantDelta: 'uregant:delta', // live assistant text
  uregantState: 'uregant:state', // authoritative run snapshot
  uregantExecTool: 'uregant:exec-tool', // run a pane tool, reply via uregant:tool-result
  // prompts: durable per-chat prompt history (rebuilds the prompt minimap on restore)
  promptsGet: 'prompts:get',
  promptsAppend: 'prompts:append',
  // git: working-tree status for a folder (branch / ahead-behind / dirty counts)
  gitStatus: 'git:status',
  // sessions: full-text search across past Claude conversations (cross-session recall)
  sessionsSearch: 'sessions:search',
  // references: expand a @diff / @url / @file / @git reference into prompt context
  referenceExpand: 'reference:expand',
  // mcp: read/write the project .mcp.json that agents load
  mcpRead: 'mcp:read',
  mcpWrite: 'mcp:write',
  // webhook: post a message to a Discord/Slack incoming webhook (from main, no CORS)
  webhookPost: 'webhook:post',

  // learning layer (local observe -> distill -> inject; opt-in, default off)
  learningTurnMarker: 'learning:turn-marker', // renderer -> main: a submitted user prompt
  learningGetConfig: 'learning:get-config',
  learningSetConfig: 'learning:set-config',
  learningOpenStore: 'learning:open-store', // reveal the local learning dir in the OS
  learningListCandidates: 'learning:list-candidates', // renderer -> main: pending review queue
  learningCandidates: 'learning:candidates', // main -> renderer (event): new gate candidates
  learningDistill: 'learning:distill', // renderer -> main: run a distillation pass (model call)
  learningListMemory: 'learning:list-memory', // renderer -> main: current brain (memories+skills)
  learningBrainView: 'learning:brain-view', // renderer -> main: full memories + skills (with bodies)
  learningGetProfile: 'learning:get-profile', // renderer -> main: USER.md / SOUL.md content
  learningSetProfile: 'learning:set-profile', // renderer -> main: save USER.md / SOUL.md
  learningSkillAction: 'learning:skill-action', // pin/unpin/archive/unarchive/delete a skill
  learningMemoryDelete: 'learning:memory-delete', // delete a learned memory
  learningTidySkills: 'learning:tidy-skills', // archive stale, unpinned skills
  learningInstallSkill: 'learning:install-skill', // install a skill from a URL (agentskills.io / GitHub)
  learningListPendingOps: 'learning:list-pending-ops', // renderer -> main: distilled ops awaiting review
  learningApproveOp: 'learning:approve-op', // renderer -> main: write a pending op into the brain
  learningRejectOp: 'learning:reject-op', // renderer -> main: discard a pending op
  learningForgetProject: 'learning:forget-project', // renderer -> main: wipe one project's learning
  learningInject: 'learning:inject', // renderer -> main: write the brain into an agent's context file
  learningEnhance: 'learning:enhance', // renderer -> main: rewrite a prompt using brain memory

  // clipboard (right-click paste of text + images)
  clipboardRead: 'clipboard:read',

  // system process monitor (task manager "System" tab)
  systemProcList: 'system:proc-list',
  systemProcKill: 'system:proc-kill',

  // saved sessions (named workspace snapshots persisted to disk)
  sessionsRead: 'sessions:read', // metadata + pane config list (sessions.json)
  sessionsWrite: 'sessions:write',
  // per-session chat content (terminal transcripts), stored one file per session
  sessionDataRead: 'sessions:data-read',
  sessionDataWrite: 'sessions:data-write',
  sessionDataDelete: 'sessions:data-delete',
  // auto-saved "last session" (full snapshot incl. transcripts) for crash/close restore
  lastSessionRead: 'sessions:last-read',
  lastSessionWrite: 'sessions:last-write',
  lastSessionFlush: 'sessions:last-flush', // synchronous write used on window close
  // complete per-pane terminal history (full session restore), kept in main
  transcriptRead: 'transcript:read',
  transcriptPrime: 'transcript:prime',
  transcriptRemove: 'transcript:remove',
  transcriptPrune: 'transcript:prune',
  // Claude's own per-conversation transcripts (~/.claude/projects/*/<id>.jsonl):
  // existence (resume vs re-create) + subject title for the "Chats" list
  claudeSessionInfo: 'claude:session-info',
  // resumable-chat registry surfaced in the sessions menu (chat-sessions.json)
  chatsRead: 'chats:read',
  chatsWrite: 'chats:write',

  // standalone, app-wide notes (separate file under userData, survives close)
  notesRead: 'notes:read',
  notesWrite: 'notes:write',

  // app self-update (electron-updater backed by GitHub releases)
  updaterCheck: 'updater:check', // renderer -> main: check now, returns UpdaterCheckResult
  updaterAvailable: 'updater:available', // main -> renderer (event)
  updaterProgress: 'updater:progress', // main -> renderer (event): download percent
  updaterDownloaded: 'updater:downloaded', // main -> renderer (event)
  updaterError: 'updater:error', // main -> renderer (event)
  updaterInstall: 'updater:install', // renderer -> main: quit + apply

  // TickTick to-do integration (OAuth via main-process loopback server + REST)
  tickTickConnect: 'ticktick:connect',
  tickTickDisconnect: 'ticktick:disconnect',
  tickTickListProjects: 'ticktick:list-projects',
  tickTickCreateProject: 'ticktick:create-project',
  tickTickDeleteProject: 'ticktick:delete-project',
  tickTickProjectData: 'ticktick:project-data',
  tickTickCreateTask: 'ticktick:create-task',
  tickTickUpdateTask: 'ticktick:update-task',
  tickTickCompleteTask: 'ticktick:complete-task',
  tickTickDeleteTask: 'ticktick:delete-task',

  // Google Tasks to-do integration (bearer token paste + REST)
  googleTasksVerify: 'gtasks:verify',
  googleTasksListLists: 'gtasks:list-lists',
  googleTasksListTasks: 'gtasks:list-tasks',
  googleTasksCreateTask: 'gtasks:create-task',
  googleTasksUpdateTask: 'gtasks:update-task',
  googleTasksCompleteTask: 'gtasks:complete-task',
  googleTasksDeleteTask: 'gtasks:delete-task',
  googleTasksAgenda: 'gtasks:agenda',

  // selection translation (Google gtx endpoint, main-side to avoid CORS)
  translateText: 'translate:text',

  // "agent over SSH" — set up the urssh exec bridge for a local agent
  sshOpenAgent: 'ssh:open-agent',
  // release a target's resources (unmount + close exec conn) when its pane closes
  sshCloseAgent: 'ssh:close-agent',
  // SSHFS (mount remote folder so a local agent can edit files): status + install
  sshfsStatus: 'sshfs:status',
  sshfsInstall: 'sshfs:install',

  // local control server (drive panes from scripts over 127.0.0.1)
  controlOpenPane: 'control:open-pane', // main -> renderer (event): open a pane on request
  controlClosePane: 'control:close-pane', // main -> renderer (event): close a pane (dashboard)
  controlSwitchWorkspace: 'control:switch-workspace', // main -> renderer (event): switch workspace
  controlDashboardSync: 'control:dashboard-sync', // renderer -> main: push workspace/pane state
  controlStatus: 'control:status', // renderer -> main: running state for Settings

  // telegram
  telegramStatus: 'telegram:status',
  telegramRestart: 'telegram:restart',
  telegramTest: 'telegram:test', // send a test message to verify the round trip
  telegramLinkPane: 'telegram:link-pane',
  telegramForward: 'telegram:forward',
  telegramStartTurn: 'telegram:start-turn', // show prompt + "working" placeholder
  telegramFinishTurn: 'telegram:finish-turn', // delete placeholder + send result
  telegramNotifyDone: 'telegram:notify-done', // ping linked chat that a turn finished
  telegramInbound: 'telegram:inbound', // main -> renderer (event)
  telegramCreatePane: 'telegram:create-pane', // main -> renderer (event): /run
  telegramStatusChanged: 'telegram:status-changed', // main -> renderer (event)

  // perf
  perfSample: 'perf:sample',

  // claude usage (live from Anthropic's OAuth /usage endpoint)
  claudeUsage: 'claude:usage',

  // window controls (frameless)
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximize-toggle',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximizedChanged: 'window:maximized-changed', // main -> renderer (event)
  windowSetOverlay: 'window:set-overlay', // recolor the native caption-button overlay (theme)
  windowSetZoom: 'window:set-zoom', // scale the whole app UI (Chromium zoom factor)
  windowOpenNew: 'window:open-new', // open a fresh, independent window (current desktop)

  // file save dialog
  fileSave: 'file:save',

  // diff review: apply an approved file patch (parsed hunks) to disk
  diffApply: 'diff:apply',

  // directory picker (choose the folder to open an agent in)
  dialogOpenDir: 'dialog:open-dir',

  // open a path in the OS file manager (Explorer / Finder)
  shellOpenPath: 'shell:open-path',
  // fs: directory autocomplete for the launcher's folder field
  fsListDirs: 'fs:list-dirs',

  // open an SSH session (streams via the pty:data/pty:exit channels)
  sshSpawn: 'ssh:spawn',
  // connections manager: TCP reachability + latency probe for a host
  sshPing: 'ssh:ping',
  // connections manager: list private keys in ~/.ssh for the identity picker
  sshListKeys: 'ssh:list-keys',
  // connections manager: parse ~/.ssh/config into importable hosts
  sshImportConfig: 'ssh:import-config',
  // credentials vault: list saved secrets, and forget one
  sshListCredentials: 'ssh:list-credentials',
  sshDeleteCredential: 'ssh:delete-credential',

  // pane registry (renderer pushes snapshot to main on every workspace change)
  panesUpdate: 'panes:update',

  // screenshot → Telegram
  screenshotPane: 'screenshot:pane',
  screenshotWindow: 'screenshot:window'
} as const
