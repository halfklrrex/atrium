# 2026-11-07 (evening), Ophelia: logo live, monday cleanup, owner decisions

## Done

- **New logo live** (#166, deployed with `ccfc7ce`). Checked on production: the HTML links the new icons, all eight icon files return 200 and `favicon.svg` and `icon-512.png` are byte-identical to the repo. The owner checked it and confirmed it works. `/manifest.webmanifest` still returns the SPA HTML because the PWA work has not started.
- **Production backfills are not needed.** Dry runs on 2026-11-07: `requiredColumnIds` 9 boards scanned, 0 to update; legacy activity 720 docs scanned, 0 legacy. The monday item is Done.
- **monday Roadmap cleaned up.** The owner confirmed the whole Automation work, the recipe builder name fix, bulk edit with Undo, the site admin feature and the logo. Those items are Done with Actionable = No. The only Yes left is the Windows flag emoji check.

## Owner decisions

- Bulk highlight border: 1px (today 2px, token `--atrium-table-bulk-outline-width` in `apps/web/src/theme/table-tokens.css`; the active cell uses 1px). Small fix, not yet made.
- PWA and web push: assigned, reply, mention, button push by default and automation does not; desktop browsers too; **account notifications follow the per-kind switches** (changes the spec); sign-out removes the device token; logo is final, name "Atrium". The spec `docs/specs/P4-pwa-web-push.md` still has the old default for question 4 and must be updated first.

## Next

See the queue in `2026-11-07-ophelia-queue-and-next-steps.md`, with the logo now done.

## Gotchas

- Local `main` had fallen 25 commits behind `origin/main`; run `git fetch origin` and fast-forward at the start of a session.
- The `Atrium-worktrees/` folder has many worktrees of merged PRs; remove them with `git worktree remove` when convenient.
