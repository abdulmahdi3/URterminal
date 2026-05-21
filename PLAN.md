# uregant-terminal — Architecture & Build Plan

A Windows-first Electron desktop app showing a grid of up to 9+ **panes**, where each
pane is either an **AI chat pane** (streaming from Anthropic / OpenAI / Gemini / Ollama)
or a **real shell pane** (node-pty + xterm.js), plus a Telegram bridge, Settings screen,
perf hardening, and a packaged build.

## Stack
- electron-vite + React 18 + TypeScript
- State: Zustand
- Shell panes: node-pty (main) + xterm.js + @xterm/addon-fit (renderer)
- AI history virtualization: @tanstack/react-virtual
- Secrets: Electron safeStorage persisted via electron-store
- Telegram: grammY
- i18n: i18next + react-i18next
- Layout: react-mosaic-component
- Packaging: electron-builder (NSIS installer + portable)

## Process & security model
Main process owns everything privileged (provider API calls, PTY processes, Telegram bot,
secret storage). Renderer is pure UI and never sees secrets. API keys / Telegram token
never cross IPC to the renderer — renderer only sees "isSet" booleans and masked previews.
contextIsolation: true, nodeIntegration: false, strict preload allowlist.

## Phases
0. Scaffold & tooling — `npm run dev` opens a window with HMR.
1. Pane workspace — Zustand store + react-mosaic grid, add/remove/focus/split.
2. Shell panes — PtyManager + xterm, bidirectional streaming, scrollback cap.
3. AI panes + adapters — SettingsStore + safeStorage, 4 streaming adapters, AI pane UI.
4. Settings screen — keys x4, Telegram token, defaults, theme, language, i18n.
5. Telegram bridge — grammY bot, outbound pane→chat (throttled), inbound chat→pane.
6. Perf hardening — virtualized history, rAF-batched commits, background capping, overlay.
7. Packaging — electron-builder Windows, node-pty native rebuild, smoke-test.
8. Finish / profile — 9 AI panes + 1 shell; fix jank/memory; confirm dev + packaged build.

## Top risks
1. node-pty native build vs Electron ABI on Windows.
2. Telegram rate limits (429s) — batch/throttle outbound.
3. Streaming re-render storms — rAF-batching is load-bearing.
4. Secret leakage — enforce "keys stay in main".
