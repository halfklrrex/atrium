# Plan: build-ahead batch, "next few features" (2026-10-31)

On approval, a copy of this plan is committed as `docs/plans/2026-10-31-build-ahead-batch.md` (docs-only PR) so it survives the session.

## Context

The owner is away and suggested building a lot for a while, then accumulating all the checks and fixes in one go. That works with our rules if it is done as **build-ahead on branches**:

- Branch work has no limit; only **open PRs** are capped (me: 2, one per hot spot).
- Features are built one after another on stacked or independent branches, each with its own spec, Sonnet subagent, and green local checks.
- PRs open and merge as slots free up, in dependency order.
- Everything the owner needs to look at goes into **one check list** (`docs/plans/owner-check-list.md`, committed with the plan and appended to as each feature merges), instead of 10 separate Yes items. One summary update per feature still goes on its Roadmap item, with Actionable = Yes only on the final batch update.

**Risk to manage:** unverified code piles up (no browser or two-account checks yet). Mitigations: (1) I do the Chrome check of each merged feature on the live site myself, in light and dark, before it joins the owner's list; (2) no more than ~4 unreviewed features at once; (3) stop and fix anything that breaks a check before starting the next feature; (4) no production data changes except the planned backfill.

## The batch (in order)

1. **My Work & global search** (in progress, item 3306219645). Spec `docs/specs/P3-my-work-global-search.md`.
   - PR 1 item index: #51 open; then run the backfill on production once both indexes are READY (dry run first).
   - PR 2 `claude/my-work`: My Work page. PR 3 `claude/global-search`: search dialog (Ctrl/Cmd+B and K).
2. **Column settings & column permissions** sign-off (3306293031). Opus checks it against its spec and writes a short gap list. Expected: one small Sonnet PR (use `validateCell`; emptiness for vote and long_text), then In review.
3. **Activity & audit log** (3306251299, P4). `boards/{id}/activity` already exists and is Functions-only. Opus writes the spec first: what gets logged (create, edit cell, move, delete, restore, share change), the item "Activity" tab and a board-level log, retention, and the rules tests. Likely backend then web, two PRs.
4. **Chart view** (3306219644, P3). Web-only, no hot-spot files. Spec first (bar, line, pie; group-by and aggregate from existing column values; board-level settings saved like Kanban). Runs in parallel with 3 because it shares no files.
5. **Button column actions** (3306219470), but **only the recommended first slice**: "set another column to a value" and "notify people". This is waiting on the owner's choice. I will build it only if the owner has not answered by then, as a clearly reversible default, and note that in the check list. If the owner picks differently, I adapt.
6. **Small polish batch** from the handoff tech-debt list: the visual test with the corrupted `Loading…` ellipsis; submenus running past the viewport (Add column, Change column type); Timeline bar names clipped at the pane edge; the save-view error toast hiding the real code. One Sonnet PR, web only.

Not in this batch: workspace invites (postponed by the owner), Automations (needs owner input), Gantt, Workload, Map, Files gallery, integrations.

## Mechanics (unchanged project rules)

- **Model policy:** Opus writes each spec and reviews each diff; Sonnet (medium effort) codes in its own worktree and branch (`claude/<task>`, own `ATRIUM_PORT_OFFSET` from 65 upward, free ones listed in the handoff note).
- **Hot spots** (rules, `tests/rules`, `packages/shared`, lock file, `tokens.css`, `firebase.json`, visual baselines): one open PR at a time. Order: item-index (shared, rules tests) → activity backend (shared, rules tests) → Button (shared). Web-only PRs (My Work, search, Chart, polish) run in between.
- **PR flow:** rebase on `origin/main`, push, open the PR, run the baselines workflow if the UI changed, wait for CI, merge with rebase, then set the Roadmap item and re-run the showcase when a visible feature lands (`scripts/showcase`).
- **Roadmap:** claim each item (Agent, Branch, Status) when its spec starts; Actionable stays No while building; one update per item when live.

## Critical files / reuse

- Existing patterns to copy: `functions/src/triggers/onItemPeopleAssigned.ts` (item triggers, shared board read), `packages/shared/src/columns/registry` (column types, `validateCell`), `apps/web/src/components/boards/ShareBoardDialog.tsx` (new dialog pattern), the Kanban/Calendar view settings code (view settings saved to `views/{id}`), `scripts/showcase/data.mjs`.
- Hot-spot files per feature are listed in each spec's PR split.

## Verification

- Per branch: `pnpm lint`, `typecheck`, `test`, `test:rules` (run on its own), `build`; CI green including `visual` (after the baselines workflow).
- After each merge and deploy: I open the live site with Claude in Chrome (if the extension responds; otherwise it goes on the owner's list), look at the feature in light and dark, and record what I saw in the check list.
- `docs/plans/owner-check-list.md` collects the live checks only the owner can do (two accounts, drag and drop, uploads, the Button decision), one section per feature.
- A handoff note at the end of each session.
