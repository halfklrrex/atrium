# Visual testing

Screenshot tests guard the look of the key screens. Every PR renders them again in CI and compares them with the committed baselines, so a UI change can't slip in unnoticed and every intentional one shows up as an image diff you can review. The suite lives in `tests/visual/` (package `@atrium/visual-tests`, built on Playwright). The spec is `docs/specs/VF2-visual-regression.md`.

## What is covered

Light and dark for each screen (black as well for Home and the board page):

- Login
- Home
- My work
- Workspace page: Recents tab and Content tab
- Board page: the table of "Product roadmap" (three groups, 18 items, every core column type), plus it scrolled to the last columns, with the status picker open, with the date picker open, with a group collapsed, with two rows selected (batch bar) and with a search active
- Sidebar collapsed
- Workspace switcher open
- "Add to workspace" menu open
- Create board dialog
- Notifications panel open
- 404 page
- Empty workspace
- Home with no recents
- Mobile (390×844): Home with the drawer closed and open

Every run uses the same world: time frozen at 2026-10-24 09:00 UTC, locale `en-GB`, timezone `UTC` (so Home says "Good morning, Avery!"), a 1440×900 viewport at scale 1, animations off, fonts served from pinned `@fontsource` packages instead of Google, and every other external request blocked. The data is seeded fresh into empty emulators with fixed ids and timestamps ("Avery Atrium", two workspaces, a folder with two boards, one root board, a favourite and a few recents).

## Updating baselines after a UI change

Baselines are the **Linux** images made in CI's container. Fonts and anti-aliasing differ per OS, so never commit images from your own machine (Windows and macOS images are gitignored).

1. Push your branch and open the PR. The `visual` job fails if your change moved any pixels. That is expected.
2. In GitHub, open **Actions → Update visual baselines → Run workflow**, pick your branch and run it. From a terminal: `gh workflow run update-visual-baselines.yml -f branch=<your-branch>`, then `gh run watch`.
3. The workflow reruns the suite in the same container with `--update-snapshots`, commits the changed PNGs to your branch as "chore: update visual baselines", checks that a plain second run passes, and starts CI for the new commit. It refuses to run on `main`.
4. Open the PR's **Files changed** tab and review the image diffs (GitHub shows the old and new image side by side, with swipe and onion-skin views). Only merge when every changed image is intended.

By default the update workflow only rewrites screens that fail the gate. Playwright's per-pixel colour threshold treats small colour shifts as equal, so a subtle colour-token change can pass the gate while the committed images go stale. For a token change, run the workflow with a screen filter, which rewrites the matching screens even when they pass: `gh workflow run update-visual-baselines.yml -f branch=<branch> -f grep="Kanban"` (the value is a Playwright `-g` title pattern). Then review the image diffs in the PR. Rewriting everything is avoided on purpose: rendering is not byte-identical between runs, so it would touch every PNG and make parallel PRs conflict.

If you rename or remove a screen, delete its old `*-linux.png` from `tests/visual/__screenshots__/` in the same PR. Orphaned images are not detected.

Because the workflow pushes with the default token, the new commit does not start CI on its own. The workflow starts CI for it with a `workflow_dispatch`, and that run appears under the PR's checks. If the checks look stale, rerun CI by pushing any commit.

## Reading a failure

When the `visual` job fails, open the run and download the **visual-report** artifact (kept 14 days), unzip it and open `playwright-report/index.html`. For each failing screenshot the report shows:

- **Expected**: the committed baseline
- **Actual**: what this run rendered
- **Diff**: changed pixels highlighted in red
- Tabs to flip between them, or a slider to swipe across

A diff on a screen you did not touch usually means another PR changed something shared (the sidebar, a theme token). A diff on the very first line of text across all screens can mean the container image changed; the image tag is pinned to the Playwright version for exactly that reason.

The same report is written locally to `tests/visual/playwright-report/` (`pnpm exec playwright show-report` inside `tests/visual`). Failed runs also keep a trace per test in `tests/visual/test-results/`.

The tolerance is `maxDiffPixelRatio: 0.002` (0.2% of pixels) with Playwright's default anti-aliasing handling. A single changed label is usually below that on a large screen, so the failing tests are the ones where a visible area moved. If a small but real change slips under the threshold, tighten it in `tests/visual/playwright.config.ts`.

## Running locally

```
pnpm test:visual:update   # first time on your machine: writes your own (gitignored) baselines
pnpm test:visual          # compare against them
```

- Local baselines are named `*-win32.png` or `*-darwin.png` and stay out of git. They only tell you whether _your_ changes moved pixels on _your_ machine, which is still a fast way to check before pushing.
- The run starts its own emulators (auth, Firestore, functions) and the Vite dev server through the usual scripts, on the ports of your `ATRIUM_PORT_OFFSET`, with empty throwaway data. It never touches your `.emulator-data`. Stop `pnpm dev` in the same copy first, because the ports are the same.
- Install the browser once with `pnpm --filter @atrium/visual-tests exec playwright install chromium`.
- Add a screen by adding a test to `tests/visual/src/screens.spec.ts` that calls `shoot(page, 'name')` after the page has finished loading (wait on real content, never on a timer).
- Seed data lives in `tests/visual/src/seed.ts`. It reuses the same `bootstrapUserInTransaction` logic as the `bootstrapUser` function for the user and personal workspace.

## When the Playwright version changes

The CI image tag, the update workflow and `@playwright/test` must all name the same exact version, and every baseline must be regenerated, because a new Chromium build renders slightly differently. Bump all three together, then run the update workflow. `scripts/visual-ci.test.mjs` fails `pnpm test` if they drift.
