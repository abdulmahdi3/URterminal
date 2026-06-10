# BridgeSpace Parity — Implementation Plan

_Plan only. Nothing here is executed. Build the phases in order when ready; each is independently shippable as its own URterminal release. Feature IDs (G1–G11) map to `BRIDGESPACE_ANALYSIS.md`._

**Project conventions every phase must honour** (from CLAUDE.md + memory):
- Each shipped feature adds ONE `RELEASE_NOTES` entry in `src/renderer/src/lib/whatsNew.ts` with a short GIF/animated demo step. One version key per release.
- `npm run typecheck` + `npm run build` clean before any release.
- Release flow: commit → bump `package.json` patch → "Release X.Y.Z" commit → push → tag → `npm run publish:win` → verify `gh release view`.
- Main process owns all privilege (PTY, secrets, fs); renderer is pure UI behind the `contextBridge`. New native work = new IPC channel in `@shared/types` `IPC` enum + handler in `src/main/ipc/index.ts` + method in `src/preload/index.ts`.

Ordering principle: cheapest, highest-marketing-value, and already-scaffolded work first; the heavy platform/editor lifts last.

---

## Phase 0 — Quick wins (1 release, ~1–2 days)

### 0a. GPU terminal rendering (G11)
- **Why:** matches BridgeSpace's "GPU-accelerated" claim; real scroll/throughput win.
- **How:** add `@xterm/addon-webgl` (+ `@xterm/addon-canvas` fallback) and load it in the terminal pool where the `Terminal` is constructed (search the pool/`terminalPool` module used by `TerminalPane.tsx`). Feature-detect WebGL; on `context lost` event, dispose the addon and fall back to canvas. Add a Settings → Appearance toggle (default on).
- **Effort:** S. **Risk:** WebGL context loss on some GPUs — the fallback handles it.

### 0b. `urterminal .` CLI launch (G10)
- **Why:** parity with `bridgespace .`; nice DX.
- **How:** on Windows ship a small `urterminal.cmd` shim (or register an `urterminal://` protocol + PATH entry in the NSIS installer, `electron-builder.yml`). Shim calls the app with the cwd as argv; reuse the existing single-instance lock (`second-instance` event in `src/main/index.ts`) to open a workspace rooted at that folder. Persist the folder as the default cwd for new panes in that window.
- **Effort:** S–M. **Risk:** installer PATH editing; single-instance arg passing already exists.

**Release:** What's New step "GPU terminals + launch from any folder".

---

## Phase 1 — Finish MCP (G5) (1 release, ~2–4 days)

Already scaffolded: `src/main/mcp/config.ts` (`readMcp`/`writeMcp`/`McpServer`), `.mcp.json` at repo root, IPC imports present.

- **Goal:** (a) a UI to add/edit/remove MCP servers; (b) launched agents actually receive them; (c) optionally serve URterminal's own tools over MCP.
- **How:**
  - **Consume:** most CLI agents read a project `.mcp.json` / `~/.claude.json`. On pane launch, ensure the chosen server set is written to the agent's expected location (Claude Code: project `.mcp.json`; others per their docs). Add `mcp:list/add/remove/test` IPC channels wrapping `config.ts`.
  - **UI:** new Settings → "MCP servers" section (mirror the Snippets/Skills section pattern in `SettingsModal.tsx`): name, transport (stdio/http/sse), command/url, env. A "Test" button spawns and pings.
  - **Serve (optional, later):** expose URterminal actions (list panes, open pane, send prompt) as an MCP stdio server so external agents can drive it — reuses the Telegram-bridge command surface.
- **Effort:** M. **Risk:** per-agent config formats differ — start with Claude Code + Codex, document the rest.
- **Release:** What's New "Connect MCP servers to every agent".

---

## Phase 2 — Orchestrator + Roles + Rooms (G7, G8) (1–2 releases, ~3–6 days)

Builds on existing `store/broadcast.ts`, `hooks/useBroadcast.ts`, `store/paneStatus.ts`, `hooks/useChainForwarding.ts`, `lib/layoutPresets.ts`.

### 2a. Roles + shared mailbox (G7)
- **Goal:** assign each AI pane a role (builder / reviewer / scout / **coordinator**) and let them message each other.
- **How:**
  - Add `role` to the pane model (`store/workspace.ts`) + a role badge in the pane header (`PaneView.tsx`/`TitleBar.tsx`).
  - **Mailbox:** a `store/mailbox.ts` Zustand store + a main-side append-only log (reuse `prompts/store.ts` pattern). A coordinator pane fans a goal out (extend `useBroadcast`/`useChainForwarding`); worker panes post results back to the mailbox; the coordinator's next turn is fed the aggregated mailbox. This is the **Orchestrator pane** (roadmap #2) realised as role routing rather than a new pane type.
- **Effort:** M–L. **Risk:** turn-aware routing is fiddly — `useChainForwarding` already solves the "wait for a turn to finish" half.

### 2b. Rooms (G8)
- **Goal:** Command / Swarm / Review presets — one click arranges panes for a workflow.
- **How:** extend `lib/layoutPresets.ts` into named "rooms" that also seed pane *kinds/roles* (Swarm = N builder panes + 1 reviewer; Command = dev-server shell + agent + git pane). Add a Rooms switcher to the workspace tab bar. Quick room switch = existing workspace switch.
- **Effort:** M. **Risk:** low — mostly composition over existing layout + launcher code.
- **Release:** What's New "Swarm rooms: coordinate a team of agents".

---

## Phase 3 — Review Room: diff accept / ship (G3) (1 release, ~4–7 days)

This is roadmap #5 (inline diff review & apply).

- **Goal:** detect file-edit blocks in agent output, show side-by-side diff with accept/reject, write accepted changes to disk.
- **How:**
  - **Detector** (`src/main/review/detect.ts`): parse agent output for unified diffs / fenced `path + ```lang` edit blocks / Claude's edit markers. Keep it tolerant; surface only confident matches. (The roadmap notes parsing fragility — gate behind a confidence threshold and always show the raw block.)
  - **Diff UI:** new `components/ReviewPanel.tsx` using a diff viewer (`monaco-editor` diff mode, or lightweight `react-diff-view`). Accept → `fs.writeFile` via a `review:apply` IPC channel (main owns fs); reject → discard. Show check status + notes per change.
  - Best paired with Phase 4's structured stream-json pane (roadmap #4) but works standalone on raw text.
- **Effort:** L. **Risk:** HIGH — output parsing is the crux. Prefer agents that emit machine-readable diffs (Claude `--output-format stream-json`) and treat freeform text as best-effort.
- **Release:** What's New "Review Room: accept or reject agent edits".

---

## Phase 4 — Memory graph (G4) (1 release, ~3–5 days)

Builds on the learning layer: `src/main/learning/` (`brain.ts`, `markdown.ts`, `paths.ts`, `merge.ts`) and the "What it learned" view (`components/LearningPanel.tsx`, `store/settings.ts`).

- **Goal:** `[[wikilinks]]` + backlinks between memories/skills, plus a force-directed graph visualization.
- **How:**
  - **Links:** extend `learning/markdown.ts` to parse `[[slug]]` references when reading/writing memory + skill files; build a `find_backlinks` map in `brain.ts` (`readAllMemories` already enumerates them). The auto-distiller (`distiller.ts`) can emit links when a new memory references an existing slug.
  - **Graph UI:** add a graph tab to `LearningPanel.tsx` using `react-force-graph-2d` (or d3-force). Nodes = memories/skills, edges = wikilinks. Click a node → open/edit that memory (reuse existing pin/archive/delete controls).
  - Expose `learning:graph` IPC returning `{nodes, edges}`.
- **Effort:** M. **Risk:** low — additive over existing storage; graph lib is the only new dep.
- **Release:** What's New "See how your memories connect".

---

## Phase 5 — Kanban task board (G2) (1 release, ~4–7 days)

- **Goal:** native task/Kanban board, not just the TickTick/Google Tasks integrations.
- **How:**
  - **Store:** `store/board.ts` (columns + cards) persisted via a `board:get/save` IPC to `{userData}/boards/<projectHash>.json` (reuse `learning/paths.ts` `projectHash` for per-project boards).
  - **UI:** `components/BoardPanel.tsx` (or a new `Pane.type: 'board'`) using `react-dnd` (already a dependency). Drag cards across columns.
  - **Agent hook (optional):** a card can "send to agent" — opens/targets an AI pane with the card body as the prompt; on turn-done, move the card. This realises BridgeSpace's "task → workspace → agents → review" pipeline using existing `paneStatus` + done-notifications.
  - **Bridge (optional):** sync columns with the existing TickTick/Google Tasks clients (`src/main/integrations/`).
- **Effort:** M–L. **Risk:** medium — scope creep; ship a local board first, integrations later.
- **Release:** What's New "Plan work on a built-in board".

---

## Phase 6 — Integrated code editor (G1) (1–2 releases, ~1–2 weeks)

- **Goal:** edit project files in-app alongside terminals.
- **How:** new `Pane.type: 'editor'` rendering Monaco (`monaco-editor` / `@monaco-editor/react`) with a file-tree sidebar. File reads/writes via `editor:read/write/list` IPC (main owns fs). Share the diff viewer with Phase 3. Persist open files in the session snapshot (`store/sessions.ts`).
- **Effort:** L (largest UI lift). **Risk:** Monaco bundle size + xterm/Monaco layout interplay in react-mosaic; keep it a pane like any other.
- **Release:** What's New "Edit code without leaving URterminal".

---

## Phase 7 — Voice-to-code (G6) (1 release, ~2–4 days)

- **Goal:** speak a prompt, inject it into the focused agent pane.
- **How:** a mic button in the input bar; Web Speech API (`SpeechRecognition`) for zero-dependency dictation, or a local Whisper (`whisper.cpp` / `nodejs-whisper`) for offline accuracy via a `voice:transcribe` IPC. Transcript → existing prompt-inject path (`lib/inject.ts`). Push-to-talk hotkey.
- **Effort:** M. **Risk:** Web Speech needs network + Chromium support (fine in Electron); Whisper adds a binary/model download.
- **Release:** What's New "Talk to your agents".

---

## Phase 8 — macOS + Linux (G9) (multi-release, ~2–4 weeks)

Roadmap #19 — the broadest lift; do last.

- **Goal:** ship mac + Linux builds.
- **How:** abstract the Windows-only bits behind a platform interface: ConPTY/`node-pty` (cross-platform already, but verify prebuilds for the pinned Electron 29 on mac/Linux), WSL detection (`pty/wsl.ts` → no-op off Windows), SSHFS-Win (`ssh/sshfs.ts` → `sshfs`/`macfuse`), `safeStorage` keychain backends, installer (`electron-builder.yml` → add `dmg` + `AppImage`/`deb` targets), and a CI build matrix.
- **Effort:** XL. **Risk:** HIGH — node-pty prebuild availability per platform is the gating constraint (see `electron_nodepty_ceiling` memory: Electron pinned at 29 for the win32 prebuild; confirm mac/Linux prebuilds exist at that ABI before committing).
- **Release:** What's New "Now on macOS and Linux".

---

## Suggested build order (recap)

| Order | Phase | Gap | Effort | Ship as |
|---|---|---|---|---|
| 1 | GPU render + CLI launch | G11, G10 | S | one release |
| 2 | Finish MCP | G5 | M | one release |
| 3 | Orchestrator + roles + rooms | G7, G8 | M–L | 1–2 releases |
| 4 | Review Room (diff apply) | G3 | L | one release |
| 5 | Memory graph | G4 | M | one release |
| 6 | Kanban board | G2 | M–L | one release |
| 7 | Code editor | G1 | L | 1–2 releases |
| 8 | Voice-to-code | G6 | M | one release |
| 9 | macOS / Linux | G9 | XL | multi-release |

Phases 1, 4, 5 have existing scaffolding (MCP config, the diff/stream-json roadmap items, the learning brain) so they convert fastest relative to their value. Phases 8 (and 6/1) are the only ones that broaden the platform/audience materially.
