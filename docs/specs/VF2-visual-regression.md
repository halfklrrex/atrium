# VF2: Visual regression tests

Author: Opus 5.5 · Implementer: Sonnet 5.5 (high effort) · Roadmap: VF "Visual regression tests" · Branch: `claude/vf2-visual-regression` · Worktree `ATRIUM_PORT_OFFSET=10`

## Why

Visual fidelity to monday is the owner's top priority, and two AI agents now change the UI in parallel. We need an automated guard: screenshots of key screens, compared on every PR, so polish can't silently regress and every UI change shows up as a reviewable image diff.

## What to build

1. **Playwright harness** in `tests/visual/`, a new workspace package `@atrium/visual-tests`, using `@playwright/test`.
   - **Start-up:** the run starts the emulators and the Vite dev server through the existing scripts, which honour `ATRIUM_PORT_OFFSET`. Use Playwright's `webServer`, or a global setup that runs `pnpm dev`. Wait for readiness; don't sleep.
   - **Seeding:** a global setup seeds **deterministic** data with `firebase-admin` against the emulators. It creates:
     - a test user "Avery Atrium" (email and password)
     - their user doc and personal workspace, created exactly the way `bootstrapUser` would, so reuse the shared bootstrap logic if you can
     - a second workspace
     - a folder holding two boards, plus one root board
     - one favourite and a few recents
   - Use fixed ids and fixed timestamps.
   - **Sign-in:** sign in through the SDK with email and password, as the app's existing Auth emulator approach does. Save the storage state, so each test starts signed in.
2. **Determinism:**
   - Freeze time with `page.clock` or an injected `Date`, set to `2026-10-24T09:00:00Z` with locale `en-GB` and timezone `UTC`. The greeting becomes stable ("Good morning").
   - Disable animations: `animations: 'disabled'`, plus a style that kills transitions and caret blink.
   - Wait for `document.fonts.ready`.
   - Viewport 1440×900 at device scale factor 1.
   - Mask any dynamic avatars or images.
3. **Screens**, each in **light and dark** (set the theme the way the app does: user pref or localStorage). Also capture **black** for Home and the board page.
   - Login page
   - Home
   - My work
   - Workspace page: the Recents tab and the Content tab
   - Board page header and group placeholders, as currently implemented. Expect other PRs to update this snapshot.
   - Sidebar collapsed
   - Workspace switcher dropdown open
   - Add-to-workspace menu open
   - Create board dialog
   - Mobile width 390×844: Home with the drawer closed and open
4. **Thresholds:** `toHaveScreenshot` with `maxDiffPixelRatio: 0.002` and anti-aliasing tolerance at Playwright's default. Full-page shots only where the page scrolls; otherwise viewport shots.
5. **Baselines live in CI's environment.** Fonts render differently on Windows and Linux.
   - **Committed:** only Linux baselines, under `tests/visual/__screenshots__/` with Playwright's platform suffix. Local `win32` and `darwin` snapshots are gitignored.
   - **CI job:** add a `visual` job to `.github/workflows/ci.yml` that runs inside the official Playwright Docker image, pinned to the exact version matching the installed `@playwright/test`, with Java 21 for the emulators.
   - **On failure:** upload the HTML report (with diffs) as an artifact.
   - **Baseline workflow:** a `workflow_dispatch` workflow `update-visual-baselines.yml` that takes a branch input, runs the suite with `--update-snapshots` in the same container, and commits the new Linux baselines back to that branch as "chore: update visual baselines". It must refuse to run on `main`.
   - **First baselines:** generate them by running that workflow on your branch after pushing. You have `gh` and can trigger it with `gh workflow run`, then wait for it with `gh run watch`.
6. **Scripts:**
   - `pnpm test:visual`: runs locally against the local platform's own (gitignored) baselines.
   - `pnpm test:visual:update`: refreshes the local baselines.
7. **Docs:** a short `docs/visual-testing.md` explaining:
   - how a UI PR updates its baselines (run the workflow on the branch, then review the image diffs in the PR's Files tab)
   - how to read a failure report
   - Don't edit `AGENTS.md`. Report what it should say instead.

## Constraints

- Work only in your worktree, on `claude/vf2-visual-regression` created from `origin/main`.
- Leave app UI code alone. Read-only test hooks such as `data-testid` attributes are OK if they're truly needed. Antigravity is working on the item card and on undo/archive/trash, and another Claude agent is on empty states, so expect other PRs to change some screenshots.
- Keep `pnpm-lock.yaml` changes limited to the new dependency.

## Done

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- `pnpm test:visual` passes locally twice in a row; it must not flake.
- The CI `visual` job is green with the committed Linux baselines.
- A PR is open to `main`. End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, and end the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Don't merge or deploy.
- **Report:** the PR URL, the screens covered, the flake check, and the AGENTS.md wording you suggest.
