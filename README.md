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
- **Telegram bridge** — link a pane to a chat to forward its output (throttled), and inject
  inbound Telegram messages as prompts (`/pane <id> <text>` or the linked pane).
- **Settings** — default agent + default terminal, Telegram token (encrypted with OS
  `safeStorage`), theme (dark default), and language (English / العربية with RTL).
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
