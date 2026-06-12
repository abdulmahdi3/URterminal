# BridgeSpace — implementation plan

**Status: all 6 features shipped (0.4.0 → 0.4.5), each committed + pushed to main with a bespoke What's New GIF.**


Source: 5 vision screenshots (BridgeMind / BridgeSpace / BridgeMemory). The loop is
**Task → Workspace → Agents → Review**. Build each feature as its own release +
GitHub push (convention: pure core + tests → IPC/preload → UI → command + What's
New entry + bespoke GIF → typecheck + tests + build clean → commit → push).

Built on the existing URterminal app (Electron + React, source `F:\uregant-terminal`).

## Features (build order — each is one release, pushed)

1. **BridgeMemory core** (`0.4.0`) — local-first `.bridgememory/` markdown notes next
   to the repo, `[[wikilinks]]`, backlinks, search, suggest-connections. Pure
   parsers + graph in `main/bridge/memory.ts` (tested); IPC + preload; a
   BridgeMemory panel (list / open / edit / search / backlinks). Auto-discovers the
   hub from a pane's cwd.

2. **BridgeMemory graph view** (`0.4.1`) — force-directed graph of notes (nodes) +
   wikilinks (edges) with the green central-hub look; click a node to open it;
   actions CREATE / SEARCH / BACKLINKS / SUGGEST. Pure layout simulation (tested).

3. **BridgeMemory MCP server** (`0.4.2`) — a bundled local MCP (stdio) server
   exposing the hub as agent tools: `create_memory`, `search_memories`,
   `read_memory`, `find_backlinks`, `suggest_connections`, `list_memories`, …
   (so Claude/Codex/etc. read+write the same hub). Auto-register into the project
   `.mcp.json` when enabled. Pure tool handlers tested against a temp hub.

4. **Rooms** (`0.4.3`) — focused workspace presets + a room side-rail:
   - **Command Room**: labeled role shells (dev server / test runner / agent shell /
     review diff).
   - **Swarm Room**: builder / reviewer / scout agents with live status chips
     (reuses the orchestrator).
   - **Review Room**: a panel — files changed (git), notes captured (bridge), checks
     running (test status), ship decision.

5. **Task board** (`0.4.4`) — local kanban (`.bridgespace/tasks.json`): columns,
   cards, drag; "Launch workspace" seeds a Room with the task as context.

6. **Build-move timeline** (`0.4.5`) — a live "watch the build move" loop view driven
   by the activity log: Task selected → Workspace launched → Agents running →
   Decision point, plus a Vibe-session status strip (builder / reviewer live).

## Conventions
- Each feature: bump `package.json` patch/minor, add a What's New entry with a
  bespoke GIF (extend `scripts/make-whatsnew-gifs.mjs` with a new scene), keep
  `typecheck` + `vitest` + `build` green, commit "Release X.Y.Z: …", `git push`.
- No release tags published unless asked (push commits to `main` only).
- Reuse existing infra: `learning/markdown.ts`, `mcp/config.ts`, layout presets,
  orchestrator, git status, diff viewer, activity log, notes.
