# 2026-11-06, Ophelia: required columns done, P5d under way, site admin specced

## Merged and live today

- **Cleanup of last night's unfinished work:** #114 (inventory note), #115 (R4 Manage table with the Needs attention chip; it replaced #112, which conflicted with `main`), #117 (four catalog templates now ready), #118 (automation-authored updates show as "Automations"), #119 (flag emoji picture fallback for Windows, Twemoji CC-BY 4.0 from jsDelivr).
- **Required columns hard rule, all three parts:** #116 REQ-1 (`boards.requiredColumnIds`, rule refusing to empty a required cell, cap of 10 columns, backfill script), #122 REQ-2 (revert trigger for Done with an empty required cell, buttons and automations refused), #123 REQ-3 (toasts, column menu note, 11th-column block).
- **Specs:** #120 P5d time-based automations, #121 site admin role.
- **P5d-1 shared** (#124): `date_arrives` and `recurring` triggers, `computeNextRunAt` (DST aware, Intl only), `dateKeysOf`, run ids.

## In flight at the end of the session

See the open PRs and the Roadmap: P5d-2 (rules, indexes, `dateKeys` backfill) and P5d-3 (the scheduler Function), each on its own branch (`claude/p5d-2-rules-indexes`, `claude/p5d-3-functions`). Then P5d-4 (web builder and showcase).

## Owner decisions today

- Site admin role: existing accounts stay approved, a waiting screen for new sign-ups, a bell notification for requests (spec `docs/specs/ADMIN-site-admin-role.md`; three small open questions with defaults).
- Required columns: both rules, eventual revert, no bypass (spec updated).

## Decisions I made (the owner can change)

- Required-column cap is **10**, not 20: a rules test showed 20 unrolled checks exceed the 1000-expression limit when all cells are written at once. A write touching an 11th required column is refused, and REQ-3 blocks turning Required on past 10.
- P5d: the spec's five defaults stand (creator's time zone stored on the recipe, 24 h catch-up, once per item and date, recurring create-item group, at most 5 scheduled recipes per board).
- Site admin: claims-based (`acct` and `admin` custom claims) because Storage rules can't read Firestore; the gate ships separately and after the backfill so nobody is locked out; a blocked person's existing token works up to an hour.

## Not done / waiting

- **Production dry runs (read-only), not applied:** legacy-activity cleanup (1 of 476 activity docs would be deleted), `requiredColumnIds` backfill (8 boards). The required rule only works on a board once its list is filled (the next column save does it, or the backfill). Ask the owner before applying.
- **Chrome extension was not connected today,** so light mode, the Activity log, the recipe run and the VF visual QA against the reference are still open. Items at Actionable = Yes are waiting on the owner's live checks.
- **Next after P5d:** ADMIN-1a (types, claim helpers, backfill script; no gate), then the backfill run with the owner's go-ahead, then ADMIN-1b (the gate), ADMIN-2 and ADMIN-3. Also the Dashboard sharing server-side check item, and the VF QA.

## Gotchas

- **Force-push is blocked by the harness** (even `--force-with-lease` onto a branch with an open PR): open a replacement PR from a new branch and close the old one.
- **`pnpm -r typecheck` in parallel gets SIGKILLed;** run `pnpm -r --workspace-concurrency=1 typecheck`.
- **Rules expression budget:** every unrolled helper call costs dozens of expressions; measure with a test that writes all keys at once before choosing a cap.
- **The baselines workflow pushes with the repo token, so CI doesn't run on its commit:** push an empty commit afterwards.
- **Subagent worktrees:** each coding subagent works in `.claude/worktrees/agent-*`; port clashes in `pnpm test:rules` are fixed with a different `ATRIUM_PORT_OFFSET` in the worktree's `.env.local`. Remove worktrees with `git worktree remove` after the merge.
