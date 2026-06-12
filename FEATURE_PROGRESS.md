# URterminal — Feature Roadmap Progress

_Report generated mid-build. Tracks the agreed "next-level" 25-feature roadmap plus user-requested additions, what shipped, and what's left._

Full roadmap reference: `~/.claude/plans/suggest-25-features-that-fluttering-seahorse.md`

---

## Summary

- **25 / 25 roadmap features done.** 🎉 Since this report was first written at 0.3.17, **#6 Prompt enhancer**, **#3 Shared cross-agent memory**, **#14 Macros**, **#17 Local HTTP/CLI control**, **#2 Orchestrator pane**, **#19 macOS / Linux support**, **#5 Inline diff review & apply**, **#4 Structured stream-json pane**, and **#25 Web / mobile dashboard** have shipped. The roadmap is complete.
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
| 6 | Prompt enhancer v2 | 0.3.2x | `main/learning/enhancePrompt.ts` + `enhancer.ts`, `lib/enhance.ts`, EnhanceFab in `AiPane.tsx` |
| 3 | Shared cross-agent project memory | 0.3.2x | `main/learning/` brain (inject/brain/profile), per-project memory injected into each agent's context file |
| 14 | Macros | 0.3.27 | `lib/macroSchedule.ts` (pure) + `lib/macros.ts` (`runMacro`), `prefs.macros`, Settings → Macros, palette `macro.run.*`, What's New `macro` demo |
| 17 | Local HTTP/CLI control | 0.3.27 | `main/control/server.ts` (127.0.0.1, token-gated: `/health`, `/panes`, `/input`, `POST /panes`), `prefs.controlServer*`, `IPC.controlOpenPane/controlStatus`, `useControlServer.ts`, Settings → Local control, What's New `control` demo |
| 2 | Orchestrator pane | 0.3.27 | `lib/orchestratePlan.ts` (pure) + `lib/orchestrate.ts` (`runOrchestration`/`collectReport`), `store/orchestrator.ts`, `OrchestratorModal.tsx`, cmd `pane.orchestrate`, `seedPrompt(submit)` for fan-out, answer-block aggregation, What's New `orchestrate` demo |
| 19 | macOS / Linux support | 0.3.28 | platform plumbed via `app:info` → `osInfo.platform()`; per-OS shells in `lib/shells.ts` (`builtinShells`); `system/processes.ts` `ps` path + parsers; `ssh/sshfs.ts` POSIX FUSE backend (macFUSE/fusermount, dir mountpoints); `electron-builder.yml` mac (dmg+zip) + linux (AppImage+deb) targets; CI release matrix `.github/workflows/release.yml`; What's New `crossplatform` demo |
| 5 | Inline diff review & apply | 0.3.29 | `shared/diff.ts` pure `parsePatches`/`applyPatch` (drift-tolerant, new-file/delete) + tests; `IPC.diffApply` handler (atomic write, cwd-scoped) + preload `applyDiff`; `store/diffReview.ts`; `DiffReviewModal.tsx` (per-file accept + colored preview); cmd `pane.reviewDiff` + SelectionTranslate action; What's New `diffreview` demo |
| 4 | Structured stream-json pane | 0.3.30 | new `PaneType` 'stream' + `StreamPaneState`; `shared/streamJson.ts` pure NDJSON→cards parser (+ `summarizeTool`/`editPreview`) + tests; `store/streams.ts` + `hooks/useStreamData.ts` (turn transcript, `--resume` continuity); `StreamPane.tsx` cards (text, tool calls, edit diffs reuse `.diff-line`, todos, result footer); spawns `claude -p --output-format stream-json` w/ optional `--dangerously-skip-permissions`; EmptyPane + `pane.newStream`; What's New `streamcards` demo |
| 25 | Web / mobile dashboard | 0.3.31 | extends the control server (`main/control/server.ts`): serves `dashboard.ts` web UI at `/`, SSE `/events` live output (ANSI-stripped), `/state`, `/pane/output`, input by paneId, `/panes/close`, `/workspaces/switch` + tests; `pty:data` tap → `pushOutput`; `controlDashboardSync`/`controlClosePane`/`controlSwitchWorkspace` IPC; `hooks/useDashboardSync.ts` + `useControlServer` close/switch; Settings “Open dashboard”; What's New `dashboard` demo |
| — | Prompt minimap (extra) | 0.3.16 | `components/PromptMinimap.tsx`, per-chat persistence `main/prompts/store.ts` + `prompts:get/append` IPC |

---

## Remaining (not started)

None — all 25 roadmap features have shipped (0.3.13 → 0.3.31).

### Deferred
- **#9 Saved layouts / "projects"** — overlaps the existing named session snapshots + pane templates; would be a near-duplicate. Revisit only if a distinct "blueprint" behavior is wanted.

---

## Conventions established (for whoever continues)

1. **Every shipped feature** adds a step to the current version's `RELEASE_NOTES` entry in `src/renderer/src/lib/whatsNew.ts`, with an animated demo (`WhatsNewDemoView` in `WhatsNewModal.tsx` + CSS in `styles/whatsnew.css`), or a real `.gif` via the `media` field.
2. **One notes entry per version** — never merge versions into one key (the dynamic multi-version tour depends on this).
3. **Release flow:** commit source → bump `package.json` patch → commit "Release X.Y.Z: …" → `git push` → `git tag vX.Y.Z` → push tag. Pushing the tag triggers `.github/workflows/release.yml`, a win/mac/linux matrix that builds each OS's installer and publishes it (+ its `latest*.yml`) to the GitHub Release. For a Windows-only quick cut you can still run `npm run publish:win` locally (mac/linux installers must be built on those OSes — that's what the matrix is for). Verify with `gh release view`.
4. `npm run typecheck` + `npm run build` must be clean before every release.
5. Commit trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Known caveats
- **Prompt minimap persistence starts at 0.3.16** — chats created before it won't show ticks on restore (no saved prompts); new chats remember their prompts.
- A single-instance lock means dev builds won't launch while an installed copy is running — fully quit it (incl. tray/lingering processes) before `npm run dev`.
