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
- Settings: Profile, Appearance, Notifications (push not supported)
- 404 page
- Empty workspace
- Home with no recents
- Mobile (390×844, in the desktop Chromium job): Home with the drawer closed and open, and the full item view

Every run uses the same world: time frozen at 2026-10-24 09:00 UTC, locale `en-GB`, timezone `UTC` (so Home says "Good morning, Avery!"), a 1440×900 viewport at scale 1, animations off, fonts self-hosted by the app itself (the same pinned `@fontsource` files, see `scripts/fonts/sync-fonts.mjs`), and every other external request blocked. The data is seeded fresh into empty emulators with fixed ids and timestamps ("Avery Atrium", two workspaces, a folder with two boards, one root board, a favourite and a few recents).

## Phone projects (WebKit, iPhone 15)

Two more Playwright projects in `tests/visual/playwright.config.ts` run the app the way a phone does: WebKit with `devices['iPhone 15']` (touch, 3x, 393×659 viewport). Both are skipped by `--project=chromium`, and `chromium` skips them, so the desktop job and its baselines are untouched.

- **`mobile-webkit`** (`src/mobile-screens.spec.ts`) compares light-theme baselines of fourteen screens: login, the privacy notice, Home, a workspace page, the sidebar drawer open, the board table, Kanban, the full item view, the notifications panel, Settings > Profile, Settings > Notifications, the profile menu, the Send feedback dialog and the admin Inbox list. Files are `phone-<screen>-light-linux.png`. Refresh them with the same "Update visual baselines" workflow (it runs `chromium` and `mobile-webkit`).
- **`mobile-audit`** (`src/mobile-audit.spec.ts`) takes no screenshots. For about twenty screens (`src/mobile-screens.ts`) at 375×667, 390×844, 430×932, 360×800 and 768×1024 it measures the page and fails on hard defects: sideways page overflow, elements sticking out past a screen edge, something painted over the top bar, the page or visual viewport moving after scrolling _inside_ a dialog or panel (the old notification-settings dialog bug), the top bar leaving the top, and text fields under 16 px (iOS zooms into them). Today's defects are listed in `src/mobile-known-defects.json` (`screen|WxH|check` to a one-line description). The audit fails on any **new** defect and on any listed defect that **no longer reproduces**, so a fix PR deletes its lines from the list. The written audit and the fix plan are in `docs/plans/2026-11-09-mobile-audit.md`.

`pnpm test:visual` and `pnpm test:visual:update` run `chromium` and `mobile-webkit` (so CI's `visual` job and the "Update visual baselines" workflow cover the fourteen phone screens with no workflow change); the audit has its own script, `pnpm test:visual:audit`, because it has no baselines and takes several minutes (about 100 tests). It belongs in its own CI job so the desktop job keeps its time budget: see "Audit in CI" below. Every audit run appends its findings to `tests/visual/.audit/findings.ndjson`.

**WebKit on Linux is not iOS Safari.** It has the same layout engine family, but not Safari's collapsing toolbars, safe-area insets, rubber-band scrolling or the on-screen keyboard, so a green audit does not prove the app is fine on an iPhone. The owner still checks on a real iPhone (and the installed app).

Run them locally (install the browser once with `pnpm --filter @atrium/visual-tests exec playwright install webkit`):

```
pnpm --filter @atrium/visual-tests exec playwright test --project=mobile-webkit   # only the fourteen phone screens
pnpm test:visual:audit                              # the audit (no baselines needed)
pnpm test:visual:audit -g "Settings: Notifications"   # one screen
MOBILE_AUDIT_WRITE=1 pnpm test:visual:audit && node scripts/mobile-known-defects.mjs
                                                    # record every finding without failing, then rebuild the list
```

Notes: on macOS you need a JDK on the `PATH` for the emulators and Node 22. Pick an `ATRIUM_PORT_OFFSET` that is not taken by another working copy and that does not put Functions on port 5061 (offset 60: `fetch` refuses it as a bad port and the run hangs at "bootstrapUser"). Local findings can differ slightly from Linux ones (font metrics), so rebuild the known-defects list from the CI artifact, not from your Mac.

### Audit in CI

The audit job is `visual-mobile-audit` in `.github/workflows/ci.yml`: the same container, Java and install steps as `visual`, then `pnpm test:visual:audit`, and an `if: always()` upload of `tests/visual/.audit` (with `include-hidden-files: true`) so the findings of a failing run can be downloaded and turned into the known-defects list with `node scripts/mobile-known-defects.mjs <file>`. (If the job is missing from `ci.yml`, it still has to be added: the agent that wrote it had no GitHub `workflow` scope.)

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
