# BridgeSpace vs URterminal — Competitive Feature Analysis

_Source: https://www.bridgemind.ai/products/bridgespace (product page, single fetch — some claims are marketing-derived). Compared against URterminal README + release notes 0.3.13→0.3.24 + the learning layer._

BridgeSpace ("BridgeSpace by BridgeMind") positions itself as an **"Agentic Development Environment — the workspace for vibe coding"**: a desktop app consolidating terminals, a code editor, task boards, and up to 16 parallel AI agents. It is the closest direct competitor to URterminal.

---

## 1. Gaps — BridgeSpace features URterminal does NOT have (the steal-list)

| # | BridgeSpace feature | What it is | URterminal status |
|---|---|---|---|
| G1 | **Integrated code editor** | In-app editor with project context | ✗ terminal-only host |
| G2 | **Kanban task boards** | Built-in project / task management | ✗ none (has TickTick + Google Tasks integrations only) |
| G3 | **Review Room** | Side-by-side diff + notes + check status + "ship" decision | ✗ inline diff review is roadmap #5, not shipped |
| G4 | **BridgeMemory graph** | Local `.bridgememory/` knowledge graph; `[[wikilinks]]`, backlinks, `suggest_connections`, force-directed graph viz | ✗ learning memory is flat markdown, no links/graph |
| G5 | **MCP integration** | 12 MCP tools; consume + serve | ◐ partial — `src/main/mcp/config.ts` + `.mcp.json` exist, not wired into launched agents or UI |
| G6 | **Voice-to-code (BridgeVoice)** | Hands-free voice → code | ✗ none |
| G7 | **Role orchestration (BridgeSwarm)** | builder / reviewer / scout / **coordinator** roles + shared mailbox between agents | ◐ has broadcast + ask-all, but no roles / coordinator / mailbox |
| G8 | **"Rooms"** | Command / Swarm / Review task-oriented workspace presets | ◐ has layout presets, not workflow rooms |
| G9 | **macOS + Linux** | Cross-platform | ✗ Windows-first only |
| G10 | **`bridgespace .` CLI launch** | Open a workspace from any dir | ✗ app-launched only |
| G11 | **GPU-accelerated terminal** | Marketed perf claim | ◐ xterm.js (no WebGL addon confirmed) |

---

## 2. Parity — both have it

Multi-pane parallel terminals · multiple AI agents at once · real shells with config preserved · Claude + Codex support · live agent status · local-first markdown memory (git-friendly) · context persistence across sessions · works with existing projects (no migration) · multi-agent fan-out · quick switching.

---

## 3. URterminal's advantage — features NOT in BridgeSpace

### Strategic / unique
- **Telegram bridge / phone control** — forward pane output, inject inbound messages as prompts, `/run` a pane remotely, chat whitelist. BridgeSpace has nothing remote.
- **WSL + PowerShell/cmd native** (Kali, any distro). BridgeSpace is `.zshrc/.bashrc` mac/Linux-centric.
- **Wider agent roster** — Gemini, Aider, OpenCode on top of Claude/Codex (they list only Claude/Codex/Jarvis).
- **OpenRouter** — one key → 200+ models in the learning layer.
- **Self-improving learning layer** — *automatic* observe→distill→inject across all agents; "what it learned about you" transparency; pin/archive/delete/tidy curation; **About-you profile + Persona** injected into every agent. (BridgeMemory is a *manual* graph; URterminal's is auto-curated.)
- **Full-text search across ALL past conversations** + resume that exact chat in a new pane (`Ctrl+Shift+F`).
- **SSH backends** — `urssh` agent bridge + SSHFS mounting.

### Productivity edge
Session save/restore (named snapshots) · snippet library w/ `{{variables}}` · pane templates · run-command-in-all-shells · output bookmarks + prompt minimap · `@diff/@staged/@git/@file/@url` context refs · theme studio + per-pane accent + **Arabic / RTL** · app zoom · export pane to HTML/text · agent doctor (1-click install) · git status bar · smart file drop · token-budget meter + perf overlay (RAM/CPU/tok/s) · notification center · offline session recap · encrypted settings (token never crosses IPC) · move live panes between workspaces · dynamic What's New tour.

### Business-model edge
BridgeSpace is **$16–100/mo with metered credits** (Basic/Pro/Ultra). URterminal launches *your own already-installed CLIs* — no credit markup; you keep your own agent subscriptions.

---

## 4. Verdict — what actually threatens the moat

Four BridgeSpace capabilities are genuine and URterminal has no real answer:
1. **MCP** (G5) — partly scaffolded; finish it.
2. **Kanban / task layer** (G2).
3. **Review Room** — diff accept / ship (G3) — already roadmap #5.
4. **Memory graph visualization** (G4) — wikilinks + backlinks + force graph.

Everything else BridgeSpace markets, URterminal already matches or beats. Implementation plan for the gaps: see `BRIDGESPACE_PARITY_PLAN.md`.
