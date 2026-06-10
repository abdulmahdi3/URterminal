# Hermes Agent → URterminal: Capability Extraction Report

Deep read of **NousResearch/hermes-agent** (cloned at `C:\Users\rog\AppData\Local\Temp\hermes-agent`, commit `47e77ae`, ~4,948 files). This is the **full, standalone "self-improving" coding agent** (Python) whose learning loop your URterminal "learning layer" already imitates ("Hermes-style"). This report lists every capability worth stealing, exactly how it stores memory + skills on disk, and answers your strategic questions.

---

## 0. TL;DR — the three answers you asked for

**Do I need to integrate the Hermes *agent* into URterminal?**
**No — and don't try to embed its engine.** Hermes is a complete standalone Python agent (5k files, its own model loop, gateway, tools). URterminal is an Electron *host* that launches CLI agents in panes. Two clean options instead:
1. **Add Hermes as one more launchable agent** in your registry (it ships a `hermes` CLI). Trivial — one entry in `agents.json` with an install hint. It then sits next to Claude/Codex/Gemini/Aider as a pane choice.
2. **Steal its patterns** to level up *your own* learning layer + features (memory format, skills lifecycle, FTS5 session recall, @-references, subagents, MCP, cron). This is where the "next level" is.

**Add more agents, or add OpenRouter?** They're **different axes** — do both:
- **Agents** = the CLI tools you launch in panes. You can cheaply add **Hermes, OpenHands, Grok-CLI, Blackbox, Antigravity** (Hermes even ships skills documenting these CLIs). More agent registry entries.
- **OpenRouter is NOT an agent source — it's a MODEL router.** One API key → **200+ models** behind one OpenAI-compatible endpoint (`https://openrouter.ai/api/v1`). It gives *models*, not *agents*. Your earlier guess ("router that contains much more agents") is **incorrect** on that point. Where it *is* very valuable: add OpenRouter as a **provider option in your learning layer** (the distiller + prompt-enhancer already pick a provider) → instant access to 200+ models with one key, no per-model code.

**Net recommendation:** add OpenRouter as a *provider* (high value, ~30 min), add 2–4 more *agents* to the launcher (cheap), and invest the real effort in the memory/skills/recall upgrades below.

---

## 1. What Hermes is

A self-improving terminal AI agent: *"creates skills from experience, improves them during use, nudges itself to persist knowledge, searches its own past conversations, and builds a deepening model of who you are across sessions."* Headline subsystems:

- **Closed learning loop** — agent-curated memory + periodic self-nudges, autonomous skill creation, skills that self-improve, **FTS5 session search** with LLM summarization for cross-session recall, optional **Honcho** dialectic user-modeling.
- **40+ tools / composable toolsets**, **subagent delegation**, **code-exec RPC** (scripts call tools at zero context cost), **MCP** (consume + serve).
- **Messaging gateway** (Telegram/Discord/Slack/WhatsApp/Signal/Email/…), **cron scheduler** with platform delivery.
- **Any model, any provider** (OpenRouter, Nous Portal, OpenAI, local) via one config; **models.dev** capability DB.
- **6 terminal backends** (local, Docker, SSH, Singularity, Modal, Daytona — last two serverless).
- **Skills Hub / agentskills.io** open standard for sharing skills; Electron **desktop app**.

---

## 2. How Hermes stores MEMORY on local disk  *(you asked for this explicitly)*

Root: `~/.hermes/` (a.k.a. `$HERMES_HOME`). Native Windows uses `%LOCALAPPDATA%\hermes`.

```
~/.hermes/
├── memories/
│   ├── MEMORY.md          # agent's durable notes. Cap 2200 chars.
│   ├── USER.md            # user profile (prefs, style, habits). Cap 1375 chars.
│   ├── MEMORY.md.lock     # fcntl/msvcrt file lock for read-modify-write
│   └── USER.md.lock
├── state.db              # SQLite (WAL) — ALL sessions + messages + FTS5 index
├── honcho.json           # config if the optional Honcho provider is used
├── config.yaml           # main config (memory:, curator:, skills: sections)
└── logs/ , cron/ , skills/ (see §3)
```

**MEMORY.md / USER.md format** — one markdown blob, entries separated by a literal `\n§\n` (section sign):
```markdown
Project uses pnpm, never npm.
§
User prefers terse answers and no preamble.
§
The deploy script lives at infra/deploy.sh and needs AWS_PROFILE=prod.
```
- **Char caps enforced** (MEMORY 2200, USER 1375) — forces curation, keeps the prompt small.
- **Loaded ONCE at session start** into the system prompt (a *frozen snapshot* — mid-session writes hit disk but not the live prompt) so the model's **prefix cache stays stable**.
- Each entry is **scanned for prompt-injection/promptware** at snapshot time; threats replaced with `[BLOCKED: …]`.
- **File locking** (`.lock`) + **drift detection**: before writing it re-reads disk; if something external changed it writes a `.bak.<timestamp>` and refuses to clobber.

**Sessions / recall store** — `~/.hermes/state.db` (SQLite, schema v15, WAL with NFS fallback):
- `sessions` table (id, source, model, title, `parent_session_id` for compression lineage, token/cost counters, cwd, archived).
- `messages` table (role, content, tool_calls, reasoning, `active` soft-delete flag for undo).
- `messages_fts` (FTS5 unicode61) + `messages_fts_trigram` (CJK substring search).
- Searched via the **`session_search` tool**: discovery (FTS5 + bookends), scroll (±N around a hit), read (full), browse (recent) — with **lineage dedup** (walks `parent_session_id` to the root so compressed sessions don't double-count).

**Optional richer memory: Honcho** — an external "dialectic" user-model service (peers, conclusions, session summaries) with 5 tools (`honcho_profile/search/reasoning/context/conclude`). Cross-session, cloud-backed. *Skip for URterminal v1; it needs an external service.*

> **vs URterminal today:** your learning layer already stores `{userData}/learning/global/memory/<slug>.md` (+ a `MEMORY.md` index) and per-project folders — close to Hermes, but you're **missing**: a dedicated **USER.md** profile, a **persona/SOUL.md**, the **§-single-file + char-cap + frozen-snapshot** discipline, prompt-injection scanning of stored memory, and the **SQLite/FTS5 session store**.

---

## 3. How Hermes stores SKILLS on local disk  *(you asked for this explicitly)*

```
~/.hermes/skills/
├── <category>/<skill-name>/
│   ├── SKILL.md           # YAML frontmatter + markdown body (the skill)
│   ├── references/        # supporting docs the skill points to
│   ├── templates/         # starter files to copy
│   ├── scripts/           # runnable helpers
│   └── assets/            # misc files
├── .usage.json            # per-skill telemetry (see below)
├── .archive/              # archived (stale) skills
├── .curator_state         # curator scheduler state (JSON)
├── .curator_backups/<UTC>/{skills.tar.gz, cron-jobs.json, manifest.json}
├── .hub/  +  .hub-installed.json   # skills installed from the Hub + lockfile
├── .bundled_manifest      # protects built-in skills
└── index-cache/           # cached remote registry indexes
~/.hermes/skill-bundles/*.yaml      # named multi-skill bundles
```

**SKILL.md format** (compatible with the **agentskills.io** open standard):
```yaml
---
name: github-pr-workflow              # required, <=64 chars, [a-z0-9_-]
description: >                        # required, <=1024 chars
  Open, review and merge PRs the way this user likes.
version: 1.0.0                        # optional (semver)
author: Jane Doe                      # optional
license: MIT                          # optional
platforms: [linux, macos, windows]    # optional OS gate
environments: [docker, kanban]        # optional runtime-relevance gate
metadata:
  hermes:
    tags: [git, github, review]
    related_skills: [code-review]
    config:                           # config vars the skill declares
      - key: github.default_reviewer
        default: "@team-lead"
---
# GitHub PR workflow
…freeform markdown instructions; supports ${HERMES_SKILL_DIR} template vars
and optional inline `!\`shell\`` substitution…
```

**`.usage.json`** (drives the lifecycle):
```json
{ "github-pr-workflow": {
    "created_at": "…", "last_used_at": "…", "use_count": 15,
    "state": "active",        // active | stale | archived
    "pinned": false, "curator_managed": true } }
```

**How skills work:**
- **Discovery**: scan `~/.hermes/skills/` (+ `skills.external_dirs`), parse frontmatter, filter by platform/environment/disabled → map `/<skill-name>` slash-commands. Cached.
- **Invocation**: `/<skill-name> <args>` loads the full SKILL.md body as a user message with an activation note + the skill's absolute dir + its config values + a list of its support files. **Bundles** (`~/.hermes/skill-bundles/*.yaml`) load several skills at once.
- **Autonomous creation / self-improvement**: a `skill_manage` tool lets the agent `create / edit / patch (fuzzy match) / write_file / delete (blocked if pinned)`. The **background-review nudge** (every N turns/iterations) forks a review agent whitelisted to *only* the memory+skills tools, which decides whether to patch a loaded skill, extend an umbrella, or create a new one — surfaced to the user as `💾 Self-improvement review: Memory updated · Skill created`.
- **Curator** (`hermes curator`, default every 7 days): a pure-function pass marks skills active→stale (30d)→archived (90d), then an LLM pass **consolidates** narrow skills into umbrella skills and **prunes** dead ones, with **tar.gz backup + rollback** and cron-reference rewrites. `pin` opts a skill out.
- **Skills Hub** (`agentskills.io`): install/share from many sources (official, GitHub, skills.sh, ClawHub, Claude Marketplace, LobeHub, URL). Quarantine → security scan → confirm → install → lockfile. A CI job rebuilds a global `skills-index.json`.

> **vs URterminal today:** you write `skills/<slug>/SKILL.md` but have **no usage telemetry, no lifecycle (stale/archive), no curator/consolidation, no bundles, no Hub/installer**. Those are the biggest skill-system upgrades available.

---

## 4. Full capability catalogue (with portability verdict for URterminal)

| # | Hermes capability | What it gives you | Port verdict for URterminal |
|---|---|---|---|
| 1 | **MEMORY.md + USER.md + SOUL.md** (caps, §-format, frozen snapshot, injection scan) | Durable agent memory + a *user profile* + a *persona* | **HIGH / easy.** Add USER.md + SOUL.md + caps to your learning layer. |
| 2 | **Nudge → background-review fork** (every N turns, whitelisted memory/skill tools) | Decides what to persist automatically | **HIGH.** You have auto-distill; adopt the "forked reviewer with only memory/skill tools" shape. |
| 3 | **Skill usage telemetry + lifecycle + curator** (active→stale→archived, LLM consolidation, backup/rollback, pin) | Skills that stay clean and merge over time | **HIGH.** New `.usage.json` + a periodic curator job. |
| 4 | **SQLite `state.db` + FTS5 session search** (`session_search`: discovery/scroll/read/browse, lineage dedup) | "Search my own past conversations" + recall | **HIGH / marquee.** You already persist transcripts → add SQLite+FTS5 + a search command/pane. |
| 5 | **Context compression** (structured handoff summary template, head/tail protect, tool-result pruning, iterative + temporal-anchored summary, compression locks) | Long-session continuity | **MED.** Hosted agents do their own compaction, but the **summary template** is reusable for your "recap" feature. |
| 6 | **Context references**: `@file:path:10-20`, `@folder`, `@diff`, `@staged`, `@git:3`, `@url` (token budgets, secret-path blocklist) | Inject files/diffs/URLs into a prompt | **HIGH / easy.** Add @-refs to your prompt enhancer / input box. |
| 7 | **Skills Hub (agentskills.io)** install/share | Community skills library | **HIGH.** A "Skills browser/installer" in URterminal; your agents already read CLAUDE.md/skills. |
| 8 | **Subagent delegation** (isolated child agents, restricted toolsets, approval callbacks, active-subagent registry, interrupt/pause, output-tail overlay) | Parallel workstreams | **MED.** You have panes; add "delegate to a child pane" + a registry. |
| 9 | **Code-exec RPC** (LLM writes a script that calls tools over a socket/file RPC → multi-step pipeline at *zero* context cost; env scrubbing; 7 sandbox-safe tools) | Cheap multi-tool pipelines | **MED/advanced.** |
| 10 | **MCP** (consume external MCP servers via stdio/HTTP/SSE incl. OAuth; serve your tools over MCP) | Instant ecosystem integrations (GitHub, Linear, filesystem…) | **HIGH.** Add MCP-server config that hosted agents/your layer can use. |
| 11 | **Cron scheduler** (`~/.hermes/cron/jobs.json`, tick loop, per-job toolsets, multi-platform delivery, `[SILENT]`, injection scan) | Unattended scheduled runs | **MED.** You already ship `/schedule` + `/loop`; this is the persistent-jobs version. |
| 12 | **Messaging gateway** (Telegram/Discord/Slack/WhatsApp/Signal/Email/Matrix/…, voice transcription, pairing/security) | "Talk to it from anywhere" | **MED.** You have a Telegram bridge; Hermes shows how to generalize to many platforms. |
| 13 | **Toolset system + 40+ tools + registry** (composable, per-platform gating, parallel-safe/path-scoped/destructive heuristics) | Tool gating + safe concurrency | **MED.** Relevant if URterminal grows its own tool layer. |
| 14 | **6 terminal backends** (local/Docker/SSH/Singularity/Modal/Daytona; serverless hibernation) | Run agents in cloud sandboxes | **MED.** You have SSH; add Docker, later Modal/Daytona. |
| 15 | **Provider/model routing** (`ProviderProfile`, base_url+key, models.dev capability DB, OpenRouter/Portal/local) | Any model via one config | **HIGH for the learning layer.** Add OpenRouter provider + models.dev data. |
| 16 | **Insights** (`hermes insights`: tokens, cost, tool/skill usage, activity patterns from state.db) | Analytics | **MED.** You track tokens; a richer insights view from a session store. |
| 17 | **Personalities / SOUL.md**, **OpenClaw migration**, **trajectory generation/compression** (training data) | Persona, import, research | **LOW–MED.** |

---

## 5. Recommended URterminal roadmap (prioritized)

**Tier 1 — close the "self-improving memory" gap (this is the heart of Hermes):**
1. **Cross-session recall** — SQLite + FTS5 over your existing transcripts/prompts, plus a **"Search past sessions"** command/pane (discovery → scroll → open). *(cap #4)*
2. **Memory upgrade** — add **USER.md** (user profile) + **SOUL.md** (persona) to the learning layer, with the §-format + char caps + frozen-at-start injection + injection scan. *(cap #1)*
3. **Skill lifecycle + curator** — `.usage.json`, active/stale/archived, a periodic LLM **curator** that consolidates skills, with backup. *(cap #3)*

**Tier 2 — high-value, cheap:**
4. **OpenRouter (and models.dev) in the learning-layer provider picker** → 200+ models, one key. *(cap #15)*
5. **`@file / @folder / @diff / @url` context references** in the prompt enhancer/input. *(cap #6)*
6. **Add more launcher agents** (Hermes, OpenHands, Grok-CLI, Blackbox, Antigravity). *(registry entries)*
7. **Skills browser/installer** from agentskills.io. *(cap #7)*

**Tier 3 — bigger bets:**
8. **MCP server config** for hosted agents/your layer. *(cap #10)*
9. **Subagent/delegate panes** with a registry + interrupt. *(cap #8)*
10. **Persistent cron jobs** (beyond `/schedule`) + **Docker/cloud backends**. *(caps #11, #14)*

---

## 6. Strategic answers (expanded)

**Integrate the Hermes agent?** Add it as a *pane agent* (one registry entry) if you want it available; do **not** embed its Python engine. The durable win is porting its *patterns* (Tier 1).

**Agents vs OpenRouter:**
- *Agents* live in your launcher and run in panes (Claude Code, Codex, Aider, Gemini, OpenCode, Copilot → + Hermes/OpenHands/Grok/Blackbox/Antigravity). Adding one = a registry entry + install hint. **Cheap, do a few.**
- *OpenRouter* is a **model** router (200+ models, one OpenAI-compatible API). It is **not** a source of agents. Add it as a **provider** in your learning layer (and any model picker). **Cheap, high value, do it.**
- Many CLI agents *also* accept a custom `base_url`/key, so once OpenRouter is a provider you can point compatible agents at it too.

---

## 7. "Steal-wholesale" file map (in the clone)

- Memory: `tools/memory_tool.py` (§-format, locks, drift, injection scan), `agent/background_review.py` (nudge fork), `agent/curator.py` + `agent/curator_backup.py`, `agent/insights.py`.
- Skills: `agent/skill_utils.py` (frontmatter parse/validate, platform match), `agent/skill_commands.py` (discovery/invocation), `agent/skill_bundles.py`, `tools/skill_usage.py` (lifecycle), `tools/skills_hub.py` (registry sources), `agent/skill_preprocessing.py` (template vars/inline shell).
- Recall/context: `hermes_state.py` (SQLite schema + FTS5 + `search_messages` + compression locks), `tools/session_search_tool.py`, `agent/context_compressor.py` (summary template), `agent/context_references.py` (@-refs).
- Tools/subagents/MCP/cron: `toolsets.py`, `tools/registry.py`, `tools/delegate_tool.py`, `tools/code_execution_tool.py`, `tools/mcp_tool.py`, `agent/transports/hermes_tools_mcp_server.py`, `cron/scheduler.py` + `cron/jobs.py`, `tools/environments/*` (6 backends).
- Model routing: `providers/__init__.py` + `providers/base.py`, `plugins/model-providers/openrouter/__init__.py`, `agent/models_dev.py`, `agent/transports/chat_completions.py`.

_(Clone retained at `C:\Users\rog\AppData\Local\Temp\hermes-agent` for reference; safe to delete.)_
