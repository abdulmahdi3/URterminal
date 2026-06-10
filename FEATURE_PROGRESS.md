# URterminal — Feature Roadmap Progress

_Report generated mid-build. Tracks the agreed "next-level" 25-feature roadmap plus user-requested additions, what shipped, and what's left._

Full roadmap reference: `~/.claude/plans/suggest-25-features-that-fluttering-seahorse.md`

---

## Summary

- **~16 / 25** roadmap features done (several were already present in the codebase).
- **6 releases shipped** this effort: **0.3.13 → 0.3.17** (all published to GitHub with installer + `latest.yml` auto-update).
- A **What's New tour** convention was established: every shipped feature adds an animated step, and **each version shows only its own new features** (dynamic multi-version: a 0.3.14→0.3.17 jump shows all versions between; a first install shows only the latest).

---

## Releases shipped

| Version | Features |
|---------|----------|
| **0.3.13** | What's New tour (#22), Quick-switcher `Ctrl+P` (#12), Session token budget (#7) |
| **0.3.14** | Agent doctor + 1-click install (#18), Git status in status bar (#10), Smart file drop (#15), dynamic multi-version What's New |
| **0.3.15** | Notification center (#24), Run-in-all-shells (#11), Output bookmarks `Alt+↑/↓` (#13), Session recap (#8), Theme studio (#20) |
| **0.3.16** | Prompt minimap (user-requested): per-prompt ticks on the right edge, hover to expand, click to jump; persisted per chat; Alt-key input-leak fix |
| **0.3.17** | App zoom `Ctrl +/−/0` (#23), Export pane to HTML/text (#21) |

---

## Done — feature by feature

| # | Feature | Release | Key files |
|---|---------|---------|-----------|
| 1 | Agent-to-agent handoff | _pre-existing_ | `hooks/useChainForwarding.ts` (turn-aware pipe forwarding) |
| 7 | Cost / budget guardrails | 0.3.13 | `hooks/useBudgetWarnings.ts`, pref `sessionTokenBudget`, status-bar meter |
| 8 | Session recap (auto-summarize, local) | 0.3.15 | `lib/summarize.ts`, cmd `agent.summarize` (types recap into pane, no API) |
| 10 | Git-aware status | 0.3.14 | `main/git/status.ts`, `hooks/useGitStatus.ts`, `git:status` IPC |
| 11 | Run command in all shells | 0.3.15 | `components/RunCommandModal.tsx`, cmd `pane.runInShells` |
| 12 | Quick-switcher (Ctrl+P) | 0.3.13 | `components/QuickSwitcher.tsx`, `lib/paneSwitch.ts` |
| 13 | Output bookmarks (Alt+↑/↓) | 0.3.15 | xterm markers in `terminalPool`, `jumpBookmark`, arrow keys in `keys.ts` |
| 15 | Smart file drop | 0.3.14 | drop handler in `TerminalPane.tsx`, `pasteText` in pool |
| 16 | Layout presets | _pre-existing_ | `lib/layoutPresets.ts`, `applyLayoutPreset` |
| 18 | Onboarding + agent doctor | 0.3.14 | `components/AgentDoctorModal.tsx`, `hooks/useAgentDoctor.ts`, `agents:install` + `app:relaunch` IPC, `installHint`s in `providers.ts` |
| 20 | Theme studio | 0.3.15 | pref `customTheme`, `applyCustomTheme`/`setTerminalSurface` in `settings.ts`, Settings → Appearance |
| 21 | Pane export (HTML/text) | 0.3.17 | `exportPaneHtml` (serializeAsHTML), cmds `pane.exportHtml/exportText` |
| 22 | What's New tour | 0.3.13 | `lib/whatsNew.ts`, `components/WhatsNewModal.tsx`, `hooks/useWhatsNew.ts`, pref `lastSeenVersion` |
| 23 | App zoom + a11y | 0.3.17 | `window:set-zoom` IPC, pref `uiZoom`, cmds `app.zoomIn/Out/Reset` |
| 24 | Notification center | 0.3.15 | `store/notifications.ts`, `hooks/useNotificationFeed.ts`, `components/NotificationBell.tsx` |
| — | Prompt minimap (extra) | 0.3.16 | `components/PromptMinimap.tsx`, per-chat persistence `main/prompts/store.ts` + `prompts:get/append` IPC |

---

## Remaining (not started)

All remaining items are heavier — large, architecturally risky, or dependent on the learning layer. Listed roughly easiest → hardest.

| # | Feature | Effort | Notes / risk |
|---|---------|--------|--------------|
| **14** | **Macros** | M | _Was the next one in progress when stopped — no code written yet._ Saved command sequences replayed into a pane. Needs a Settings manager (mirror the Snippets section in `SettingsModal.tsx`), `prefs.macros`, a `lib/macros.ts` runner, and dynamic "Run macro: X" palette commands. |
| 17 | Local HTTP/CLI control | M | Localhost server (127.0.0.1 + token) to list panes / open panes / send prompts from scripts. Mirror the Telegram bridge event pattern; security-sensitive. |
| 6 | Prompt enhancer v2 (context attach) | M | @-attach files/URLs into the enhancer. Depends on the learning model being configured (`window.api.learning.enhance`). |
| 5 | Inline diff review & apply | M–L | Detect file-edit blocks in agent output, show accept/reject, write to disk. Relies on fragile parsing of agent output — needs a robust detector. |
| 3 | Shared cross-agent project memory | L | Unify the learning-layer brain so all agents read the same per-project memory. Touches `main/learning/`. |
| 2 | Orchestrator pane | L | A pane that fans a goal to worker agent panes and aggregates. Builds on broadcast + paneStatus; new coordination logic. |
| 4 | Structured stream-json pane | L | Render Claude's `--output-format stream-json` (tool calls, diffs, todos) as native UI cards. New `Pane.type` + renderer; biggest visual leap. |
| 19 | macOS / Linux support | L | Abstract Windows-only bits (ConPTY, WSL detection, SSHFS-Win). Broadens the user base materially. |
| 25 | Web / mobile dashboard | L | Authenticated web view to see panes + send prompts remotely. Generalize the Telegram bridge into an HTTP+WS service. |

### Deferred
- **#9 Saved layouts / "projects"** — overlaps the existing named session snapshots + pane templates; would be a near-duplicate. Revisit only if a distinct "blueprint" behavior is wanted.

---

## Conventions established (for whoever continues)

1. **Every shipped feature** adds a step to the current version's `RELEASE_NOTES` entry in `src/renderer/src/lib/whatsNew.ts`, with an animated demo (`WhatsNewDemoView` in `WhatsNewModal.tsx` + CSS in `styles/whatsnew.css`), or a real `.gif` via the `media` field.
2. **One notes entry per version** — never merge versions into one key (the dynamic multi-version tour depends on this).
3. **Release flow:** commit source → bump `package.json` patch → commit "Release X.Y.Z: …" → `git push` → `git tag vX.Y.Z` → push tag → `npm run publish:win` (uploads installer + `latest.yml`). Verify with `gh release view`.
4. `npm run typecheck` + `npm run build` must be clean before every release.
5. Commit trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Known caveats
- **Prompt minimap persistence starts at 0.3.16** — chats created before it won't show ticks on restore (no saved prompts); new chats remember their prompts.
- A single-instance lock means dev builds won't launch while an installed copy is running — fully quit it (incl. tray/lingering processes) before `npm run dev`.
