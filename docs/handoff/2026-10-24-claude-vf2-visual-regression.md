# 2026-10-24 · Claude · VF2 visual regression tests

## Done

- **Suite:** `tests/visual/` (`@atrium/visual-tests`, Playwright 1.64.1, exact pin). 34 screenshots: login, Home, My work, workspace Recents and Content tabs, board page, sidebar collapsed, workspace switcher, add menu, create-board dialog, notifications panel, 404 page, empty workspace, Home with no recents and mobile Home (drawer closed and open) in light and dark, plus Home and the board page in black. How-to: `docs/visual-testing.md`.
- **Start-up:** Playwright `webServer` starts emulators (auth, Firestore, functions) and Vite through the existing scripts, so `ATRIUM_PORT_OFFSET` applies. `scripts/emulators.mjs` gained `ATRIUM_EPHEMERAL_EMULATORS=1` (no import or export), so tests never read or overwrite `.emulator-data`.
- **Seed:** `src/seed.ts` creates Avery Atrium with the Admin SDK, using `bootstrapUserInTransaction` for the user and personal workspace. Fixed ids and timestamps relative to the frozen "now". Global setup signs in through the SDK and saves the session (storage state with IndexedDB).
- **Determinism:** clock frozen with `setFixedTime`, `en-GB`, UTC, 1440×900 at scale 1, reduced motion, animations off. Fonts come from pinned `@fontsource` packages (Google Fonts requests are answered locally); every other external request is blocked.
- **CI:** `visual` job in `ci.yml` (Playwright container, Java 21, report artifact on failure). `update-visual-baselines.yml` (manual, refuses `main`) regenerates and commits the Linux baselines, re-runs the suite to prove them stable, and starts CI for its commit. `scripts/visual-ci.test.mjs` fails `pnpm test` if the image tag and the Playwright version drift.

## Gotchas

- **Vibe menu items:** a bare click right after the menu opens can be missed. Hover the item first, then click with a small delay.
- **Dispatch needs the default branch:** GitHub refuses to dispatch a workflow file that is not on `main` yet, so the first baselines came from a temporary `push` trigger, removed afterwards. After this PR merges, the manual run works as documented.
- **Pushes from workflows don't start CI** (GITHUB_TOKEN rule), so the baseline workflow dispatches `ci.yml` itself (`workflow_dispatch` was added to it).
- **Same ports as `pnpm dev`:** the suite fails fast if a dev session already holds this copy's ports. Stop it first.
- **Orphaned baselines:** renaming or deleting a screen leaves its old `*-linux.png` behind. Delete it in the same PR.

## Next

- Other open PRs (item card, undo/archive/trash) will change some screenshots on purpose. Each runs the baseline workflow on its branch.
- Suggested `AGENTS.md` wording is in the PR description.
