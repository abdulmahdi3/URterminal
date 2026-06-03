---
description: Commit current changes, bump patch version, tag, push, build + publish a new GitHub release
---

You are wrapping up a coding session for URterminal. Run the **commit → bump → publish → release** flow end-to-end with no further prompts. Skip steps that don't apply (e.g. nothing to commit).

## Steps

1. **Snapshot state** — run `git status` and `git diff --stat HEAD` in parallel to see what changed since the last commit.

2. **Stage + commit** — if there are changes:
   - Stage all changed/new source files (avoid `.env`, `dist/`, `out/`, anything in `.gitignore`).
   - Write a commit message: 1-line title + short body grouping the changes by feature/fix. Keep the same tone as recent commits (run `git log --oneline -5` if needed). End with the standard `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
   - Commit.

3. **Bump version** — read `package.json`, increment the **patch** number (e.g. `0.3.3` → `0.3.4`). Commit just `package.json` with title `Release X.Y.Z: <short summary of this release's highlights>` plus the same trailer.

4. **Push** — `git push origin <current-branch>`. If the branch is not `main`/`staging`, confirm with the user before pushing.

5. **Tag** — `git tag v<X.Y.Z>` then `git push origin v<X.Y.Z>`.

6. **Build + publish** — run `npm run publish:win` (timeout 600000 ms). `GH_TOKEN` is set persistently in the user env, so electron-builder uploads the installer + `latest.yml` to the GitHub release directly. Check the tail of the output for errors.

7. **Fallback upload** — if `publish:win` succeeded but no release was created (e.g. permission issue), upload the artifacts manually:
   ```
   gh release create v<X.Y.Z> \
     dist/URterminal-<X.Y.Z>-Setup-x64.exe \
     dist/URterminal-<X.Y.Z>-Setup-x64.exe.blockmap \
     dist/URterminal-<X.Y.Z>-Portable-x64.exe \
     dist/latest.yml \
     --title "<X.Y.Z>" --notes "<bullet list of highlights from this release>"
   ```

8. **Report** — output a short summary:
   - Released version
   - Release URL (`https://github.com/abdulmahdi3/URterminal/releases/tag/v<X.Y.Z>`)
   - Anything that needs the user's attention (auth issue, build warning, etc.)

## Rules

- **Don't add features** in this command — only the commit/bump/publish flow.
- **Never use `--no-verify`** to skip hooks. If a commit hook fails, fix the underlying issue.
- **Type-check first** if any TS files changed: run `npm run typecheck` before committing. If it fails, stop and report — do not commit broken code.
- **Don't commit** `dist/`, `out/`, secrets, or `.env` files.
- **The current branch** is the publish branch — don't force-push, don't switch branches.
- **Highlight summary** for both the commit message and release notes should describe what *users* see, not the code refactor (e.g. "TickTick integration" not "added TickTickClient class").
