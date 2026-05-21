# uregant-terminal

A Windows-first Electron desktop app: a tiling workspace of up to 9+ **panes**, where
each pane is either an **AI chat pane** (streaming from Anthropic, OpenAI, Google Gemini,
or a local Ollama) or a **real shell pane** (node-pty + xterm.js). Includes a Telegram
bridge, an encrypted settings store, performance hardening, and a packaged build.

## Features

- **Tiling panes** — split/resize/close, mix AI and shell panes in one grid (react-mosaic).
- **Real shells** — interactive ConPTY shells (PowerShell/cmd) rendered with xterm.js.
- **AI streaming** — Anthropic, OpenAI, Gemini, Ollama; per-pane provider + model picker,
  live token streaming, stop button. API keys live only in the main process.
- **Telegram bridge** — link a pane to a chat to forward its output (throttled), and inject
  inbound Telegram messages as prompts (`/pane <id> <text>` or the linked pane).
- **Settings** — API keys (encrypted with OS `safeStorage`), Telegram token, default
  provider/model, theme (dark default), and language (English / العربية with RTL).
- **Perf** — virtualized chat history, rAF-batched stream commits (one re-render per frame
  across all panes), capped scrollback, and an in-app perf overlay (RAM, panes, streams/sec).

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
  AI panes ──prompt──────▶   ProviderAdapters (anthropic/openai/gemini/ollama, SSE/NDJSON)
  shell panes (xterm)        Streamer (per-stream AbortController)
  settings / perf   ◀events  PtyManager (node-pty)
                             TelegramBridge (grammY)
```

The **main process owns everything privileged** (API calls, PTYs, the Telegram bot, secret
storage). The renderer is pure UI behind a `contextBridge` (`contextIsolation: true`,
`nodeIntegration: false`). **API keys and the Telegram token never cross IPC to the
renderer** — it only ever sees `isSet` booleans and masked previews.

## Profiling / scripted harness

The real main process supports env-gated scripted runs (used during development to verify
behaviour against the real IPC layer):

```sh
# 9 AI panes + 1 shell, all streaming at once; writes smoke-profile.png and prints RSS
UREGANT_PROFILE=9 ./node_modules/.bin/electron out/main/index.js
```

Other modes: `UREGANT_SMOKE` (shell round-trip), `UREGANT_SMOKE_AI` (AI streaming vs a mock
Ollama), `UREGANT_SMOKE_SETTINGS`, `UREGANT_SMOKE_TG` (Telegram inbound routing).
