# URterminal

A Windows-first Electron desktop app: a tiling workspace of up to 9+ **panes**, where each
pane runs either an **AI coding-agent CLI** (Claude, ChatGPT/Codex, Gemini, Aider, OpenCode)
or a **real shell** — PowerShell, cmd, or any installed **WSL** distro — on node-pty +
xterm.js. Includes a Telegram bridge, an encrypted settings store, performance hardening, and
a packaged build.

## Features

- **Tiling panes** — split/resize/close, mix agent and shell panes in one grid (react-mosaic).
- **Agent CLIs** — launch `claude`, `codex` (ChatGPT), `gemini`, `aider`, or `opencode`
  directly in a chosen folder. Pick the agent in the launcher; the command palette flags any
  whose CLI isn't installed on PATH.
- **Real shells + WSL** — interactive ConPTY shells (PowerShell / cmd) and one entry per
  installed WSL distro (the default distro is flagged), launchable from the empty pane or the
  command palette. Docker's internal distros are filtered out.
- **Command palette** — `Ctrl+K` for everything; e.g. screenshot the active pane to its
  linked Telegram chat with `Ctrl+Shift+S`.
- **Move panes between workspaces** — drag a pane's grip onto another workspace tab (or the
  overflow menu) to move it there, keeping its live process and scrollback.
- **Agent orchestration**
  - **Broadcast input** — type once and `Ctrl+Enter` to send the same line to several
    selected panes at once.
  - **Ask all agents** — fan one prompt out to every AI pane to compare answers side by side.
  - **Status dots** — each AI pane shows Working / Awaiting / Idle, in the header and status bar.
  - **Done notifications** — optional desktop + sound (and Telegram) alerts when an agent
    finishes a turn.
- **Telegram bridge** — link a pane to a chat to forward its output (throttled) and inject
  inbound messages as prompts; a **chat whitelist** for phone + desktop control, and
  `/run <agent|shell> [folder]` to open a pane remotely.
- **Productivity**
  - **Scrollback search** — `Ctrl+F` to search a pane's buffer with next/prev + match count.
  - **Snippet library** — saved prompts/commands with `{{variables}}`, inserted from the palette.
  - **Pane templates** — save an agent/shell config and spawn it in one click from the title bar.
  - **Auto-restore** — optionally reopen the last workspace (panes + layout) on launch.
  - **Activity log** — record prompts + answers and export the timeline to Markdown.
- **Settings** — default agent + default terminal, Telegram token (encrypted with OS
  `safeStorage`), notifications, terminal font family + size, theme (dark default), and
  language (English / العربية with RTL).
- **Appearance** — per-pane accent tint to tell agents apart at a glance.
- **Cost** — rough per-pane / per-session token cost estimate in the Task Manager.
- **Perf** — rAF-batched output commits, capped scrollback, and an in-app perf overlay
  (RAM, CPU, tokens/sec).

## Requirements

- Windows 10/11, x64
- Node.js (the toolchain) + npm

## Setup

```sh
npm install
```

`postinstall` runs `scripts/setup-natives.mjs`, which:

1. Pins **Electron 29** (ABI 121) — the highest ABI for which a prebuilt `node-pty` binary
   exists, so no C/C++ compiler is required.
2. Recovers the Electron binary if the platform's archiver extracted it incompletely.
3. Fetches the Electron-ABI `node-pty` prebuilt binary (no source build).

> **Why this exists:** on very new Node versions (e.g. Node 26) on Windows, Electron's own
> `extract-zip` step and many native-module install scripts break (`spawn EINVAL`). The setup
> script works around both deterministically. If natives ever go missing, re-run:
>
> ```sh
> npm run rebuild
> ```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Launch in development with HMR. |
| `npm run build` | Build main/preload/renderer to `out/`. |
| `npm run pack:win` | Build + package NSIS installer and portable `.exe` into `dist/`. |
| `npm run typecheck` | Type-check both the node and web TS projects. |
| `npm run rebuild` | Re-fetch the Electron-ABI native binaries. |

## Architecture

```
Renderer (React)            Main process
  workspace grid    invoke   SettingsStore (electron-store + safeStorage)
  agent panes (xterm)        PtyManager (node-pty) — agent CLIs + shells + WSL
  shell panes  (xterm)  ◀──  wsl.ts (distro detection) / which.ts (PATH lookup)
  settings / perf   ◀events  TelegramBridge (grammY)
```

The **main process owns everything privileged** (PTYs, the Telegram bot, secret storage).
The renderer is pure UI behind a `contextBridge` (`contextIsolation: true`,
`nodeIntegration: false`). **The Telegram token never crosses IPC to the renderer** — it
only ever sees `isSet` booleans and masked previews.

## Code signing (Windows)

Packaging is unsigned by default. To produce a signed installer, electron-builder picks up
standard env vars automatically — no config change needed:

```sh
$env:CSC_LINK = "C:\path\to\cert.pfx"     # or a base64/URL to the .pfx
$env:CSC_KEY_PASSWORD = "<pfx password>"
npm run pack:win
```

For EV / Azure Trusted Signing (the modern path now that cheap OV certs are gone), add an
`azureSignOptions` block under `win:` in `electron-builder.yml`. Without a cert the installer
still builds; users just see a SmartScreen prompt on first run.

## Scripted harness

The real main process supports env-gated scripted runs (used during development to verify
behaviour against the real IPC layer):

```sh
# basic shell + pane round-trip, screenshot, exit
URTERMINAL_SMOKE=1 ./node_modules/.bin/electron out/main/index.js
```

Other modes: `URTERMINAL_SMOKE_SETTINGS` (settings persistence + EN/AR views).
