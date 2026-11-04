# Plan: autonomous work batch while the owner is away (from 2026-11-03)

> **Superseded (2026-11-04):** the open-PR limits in this plan were removed by the owner. See `AGENTS.md`.

## Context

The owner will be unavailable for a while and wants Ophelia to keep building without guidance. The setup follows the 2026-10-31 build-ahead batch (`docs/plans/2026-10-31-build-ahead-batch.md`). That batch is finished: My Work, search, Chart, the activity backend and polish batch 2 are all live.

Today's review also found these:

- The Roadmap has two items with Actionable = Agents. My earlier filter missed them.
  - **Description editor pass 2** (3311533622): the owner wrote "everything is fine", so it can be signed off.
  - **Button column** (3306219470): the owner answered the open question. They want buttons that run a configured sequence of actions, like a Trello button that renames a card, moves it and closes it.
- Several Roadmap statuses are stale. Chart view and Activity still show Not started, and My Work shows Planning.
- Two new feature requests came in through the bug inbox (3327934712 and 3327933132).

The goal is to ship a useful queue of features safely, with no decisions that only the owner can make. Everything the owner needs to check is collected in one list for their return.

## Ground rules for this period (on top of AGENTS.md / CLAUDE.md)

- **Work loop for each feature:**
  - Opus writes or checks the spec.
  - A Sonnet subagent (medium effort) codes it in its own worktree, `claude/<task>`, with an `ATRIUM_PORT_OFFSET` of 10–60, avoiding 30.
  - Opus reviews the diff against the spec and runs all five checks.
  - Opus opens the PR, runs the baselines workflow if the UI changed, merges with rebase on green CI, and lets it deploy.
  - Opus does a Chrome check on the live site in light and dark, adds a section to `docs/plans/owner-check-list.md`, and updates the Roadmap item. It goes to In review with Actionable = No; Yes is set only on the final batch summary.
- **Limits:**
  - At most 2 open PRs.
  - At most one open PR touching any hot-spot file.
  - At most ~4 merged features waiting for the owner's look before I pause new features and only polish or fix.
- **Never, while the owner is away:**
  - run production migrations or backfills, including `2026-11-delete-legacy-activity.mjs`;
  - change IAM, OAuth or security settings;
  - loosen rules;
  - delete remote branches;
  - touch the owner's monday account beyond the Roadmap and Decisions boards;
  - start P5 automations code, or anything else that needs a product decision the owner hasn't made.
- **When I'm stuck or an architecture choice comes up:**
  - log it on the item with Actionable = Yes and an exact question;
  - pick the reversible default if one exists, otherwise skip to the next queue item;
  - never block the whole queue on one question.
- **Stop at a clean point:** if usage runs low, CI fails twice for the same unexplained reason, or something on production breaks, stop and write a handoff note.
- **Start of every session:** follow the AGENTS.md routine: sync, PRs, bug inbox, Actionable = Agents. The Agents filter must use the label id, `compareValue: [4]`, not the index (that mistake caused today's miss). Fix any new bug before continuing the queue.

## Step 0: Housekeeping (first session)

1. Merge #61 (HANDOFF refresh) once CI is green. Finish the worktree cleanup. The `atrium-cl-mcp` folder is locked by a process, so delete it by hand later.
2. Roadmap:
   - Sign off Description editor pass 2 (Done, No) with a short reply.
   - Correct the stale items, with Spec / PR links:
     - Chart view: In review.
     - My Work & global search: In review.
     - Activity & audit log: Building, claimed.
   - Reply on the Button item with the plan from item 4 below, Actionable = No.
3. Commit this plan as `docs/plans/2026-11-03-autonomous-batch.md`, together with a corrected `HANDOFF.md` line. Replace "no Actionable = Agents items", which was wrong.

## The queue (in order; web-only items can run alongside a hot-spot item)

1. **Activity web UI** (3306251299, PR 2 of `docs/specs/P4-activity-audit-log.md`; web only, plus visual baselines).
   - The spec is ready. It covers the item card's Activity Log tab, which replaces the fake list, and the board Activity log panel opened from the board menu, with Person, Column and Date filters.
   - Reuse `apps/web/src/components/item-card/ItemCardDrawer.tsx`, the read-only cell renderers, `describeCallableError`, and the VF3 empty-state pattern.
   - Use the spec's defaults for its open questions: 90-day TTL, viewers can read, and description edits are not logged. Note them in the check list.
2. **Column settings & permissions sign-off** (3306293031, spec `P2-column-settings-permissions.md`).
   - Opus writes a gap list against the spec.
   - Expected: one small Sonnet PR, using `validateCell` and the emptiness rules for vote and long_text. Then In review.
3. **Reorder favourite boards** (3327933132; hot spot: rules if the storage is new).
   - Short spec first: where favourites live today (grep `favorite` in `apps/web/src/data`), and a per-user ordered list with fractional positions (`fractional-indexing`, already a dependency).
   - The UI is drag and drop in the sidebar Favorites, using the existing DnD library, plus "Move up / down" in the menu for keyboard users.
   - It also needs rules tests.
4. **Button column: multi-step actions** (3306219470; hot spot: `packages/shared`).
   - Base it on the owner's answer.
   - Spec (`P2-button-actions.md`): button settings hold an ordered `actions[]` list (max 5). The first action types are:
     - set a column value (through `validateCell`)
     - rename the item, with a `{name}` template
     - move to a group
     - archive the item
     - notify people (reusing the P4 notifications)
   - The existing button callable runs them server-side in one transaction, each action logged to activity.
   - Settings UI: an action list editor in the column settings.
   - The action schema is deliberately named and shaped to become P5's "actions library". Log that as a Decisions-board entry, so automations can reuse it later.
   - Reversible: no data migration, and old buttons keep "record click only".
5. **Update composer rich text** (3327934712; web, maybe a shared schema).
   - Spec first: reuse the description editor (TipTap setup from VF8 / passes 1–3: marks, Ctrl+B / I / U, lists, @mentions) in a compact composer.
   - Store the same rich document format as descriptions. Existing plain-text updates keep rendering through a fallback.
   - Notification and mention extraction must read the new format. Check `onUpdateCreated.ts` and the activity text helpers.
6. **Description toolbar polish** (VF follow-ups from pass 2): the toolbar wraps onto two rows, and the emoji search label duplicates its placeholder (check whether `VF-emoji-search-label.md` already fixed it). One small web PR.
7. **Gantt view** (3306219696, P3, High). Spec, then build. It extends the Timeline view (`share the date-view model` refactor, b761352) with dependencies between items and a baseline. Only if items 1–6 are merged and the owner's waiting list is under 4.
8. **Automation engine design** (3306251672, P5, Critical): a **design doc only**, `docs/specs/P5-automations-design.md`.
   - It covers triggers, conditions, the actions library from item 4, the run history, and loop protection.
   - It ends with explicit owner questions and Actionable = Yes. No code.

Explicitly not in this batch: PWA and web push (needs owner devices), integrations, P6+ features, Members dialog fidelity (Low), production data changes.

## Critical files / reuse

- Activity: `apps/web/src/data/` (live query hooks pattern), `components/item-card/ItemCardDrawer.tsx`, `components/boards/BoardHeader.tsx`, `AppShell/ui-store.ts`, `tests/visual/src/seed.ts` / `screens.spec.ts`.
- Button: `functions/src/lib/column-actions.ts` (existing button callable, already logs activity), `packages/shared/src/columns/registry`, `functions/src/lib/admin-activity.ts` (`appendActivityTx`).
- Composer: the description editor components from VF8 and pass 3 (@mentions), `functions/src/triggers/onUpdateCreated.ts`.
- Showcase: extend `scripts/showcase/data.mjs` whenever a visible board feature lands (Button actions), then re-run against production. The project rules allow this.

## Verification

- Every branch passes `pnpm lint`, `typecheck`, `test`, `test:rules` and `build` locally, and CI is green, including `visual` after the baselines workflow.
- After each deploy, a Chrome check on https://atrium-workboards.web.app in light and dark, using a test board in the showcase workspace. The result goes in the check list. Two-account, drag-and-drop and upload checks are left for the owner.
- At the end of each session:
  - a handoff note in `docs/handoff/` and an updated `HANDOFF.md` "Open work";
  - one Roadmap summary update with Actionable = Yes, listing what's waiting for the owner, linked to `docs/plans/owner-check-list.md`.
