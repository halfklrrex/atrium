# P5b: automations UI (recipe builder and Automation center)

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: P5 · Automations (the Automation center and recipe builder items) · Design: `P5-automations-design.md` (sections 3, 4, 7, 9, 11), engine: `P5a-automations-backend.md` and PR #90 · Branches `claude/p5b-center`, `claude/p5b-builder`

## What the owner gets

The board header's **Automate** button (a "Coming soon" stub today, `components/boards/BoardHeader.tsx`) opens the **Automation center**. Board owners create, edit, switch on and off and delete recipes of the form "When _trigger_ [and _conditions_], then _actions_". Owners also read the run history. Editors and viewers see the list read-only.

## Ground truth (already merged, checked at `ee869a2`)

- Schemas, limits and `validateAutomation(automation, board, role)` are in `packages/shared/src/schemas/automation.ts`. Triggers today: `item_created` (optional `groupId`), `status_changed` (`columnId`, optional `toLabelId`), `button_clicked` (`columnId`). `AUTOMATION_TRIGGER_LABELS` has the names. Conditions use `is`, `is_not`, `is_empty`, `is_not_empty` (max 3). Actions are the button-action schema (max 5). Limits: 20 per board, depth 3, 100 runs/hour.
- Rules (`firestore.rules`): `automations/{id}`: board readers read, **board owners** create/update/delete; create must set `runAs`, `createdBy` and `updatedBy` to the writer and both timestamps to `request.time`; update may change only `name, enabled, trigger, conditions, actions, runAs, disabledReason, updatedBy, updatedAt`, and `runAs` stays or becomes the writer. `automationRuns/{id}`: **owners** read, nobody writes. `consecutiveFailures` is server-written and clients never send it.
- There is **no web data layer** for automations yet, and **no rules change is needed** for P5b.
- The engine (PR #90) is held for the owner's ultrareview. P5b can be built and tested without it: the run history is simply empty until it ships.

## Data layer (`apps/web/src/data/automations.ts`, new)

Follow `data/firestore.ts` and `data/views.ts` patterns.

- `useBoardAutomations(boardId)`: live list ordered by `createdAt`.
- `createAutomation`, `updateAutomation`, `deleteAutomation`, `setAutomationEnabled`: writes use `serverTimestamp()` and set `runAs`, `createdBy`, `updatedBy` exactly as the rules require. Re-enabling clears `disabledReason` (`null`). Before any write, `validateAutomation` runs and the 20-per-board cap is checked against the loaded list (rules can't count).
- `useAutomationRuns(boardId)`: owners only; one listener, `orderBy('startedAt','desc')`, `limit(200)`. **No composite index:** filtering by automation or status is done client-side on those 200 rows (say so in the UI: "Showing the latest 200 runs"). Non-owners do not subscribe.
- Unit tests with the existing Firestore test doubles; write-shape tests mirror the rules (a create with the wrong `runAs` must not be producible by the helpers).

## Automation center (`apps/web/src/components/automations/`)

A large Vibe `Modal` (or side panel, whichever the existing dialogs use) with two tabs.

- **Recipes:** each row shows the recipe as a sentence ("When Status changes to Done, then move to Done"), an on/off switch, the last run time and result (from the loaded runs; "Never" if none), and a menu (Edit, Duplicate, Delete). A disabled recipe shows its `disabledReason` in a warning style with a **Turn on** action. "Create automation" and the starter recipes (below) sit above the list. Switch, Edit, Delete and Create are owner-only; others see the list with the controls hidden.
- **Run history** (owners only): rows of time, recipe name, item, status chip (ok, skipped, failed) and the `reason` / `error`; filters for recipe and status (client-side). Clicking a row opens the item card if the item still exists.
- **States** as VF3: empty ("No automations yet" with the starters), loading, error, and "you don't have access" for the history tab when not an owner.
- **Sentence rendering** is one pure function (`describeAutomation(automation, board)`), unit tested with every trigger, condition and action type, and a recipe whose column was deleted ("a deleted column" instead of crashing).

## Recipe builder (`RecipeBuilder.tsx`)

A dialog opened from Create or Edit, built as a sentence of pickers:
`When [trigger ▾] [params]` · `[+ Add condition]` (up to 3) · `then [actions]`.

- **Trigger picker** lists the three types; params: group (optional) for item created, status column and optional "to" label for status changed, button column for button clicked. Only columns that fit are offered (`validateAutomation` is the authority).
- **Conditions:** column, operator, value. v1 offers status (label picker), dropdown (option picker), text and long text (text field), numbers (number field) and checkbox. Button and derived columns are never offered. Other column types are not offered in v1.
- **Actions:** reuse `components/board-table/ButtonActionsEditor.tsx` unchanged where possible (one editor to maintain, as the design says). If it needs props to run outside the Button column settings, add them without changing its current callers.
- **Save** is disabled until `validateAutomation` returns ok; the first failure shows inline next to the offending part (an action failure carries its index). Saving a recipe someone else created shows a note: "Saving makes you the person this runs as."
- **Starter recipes** (empty state, three one-click presets that open the builder prefilled): "When Status changes to Done, move the item to a group"; "When an item is created, notify the board owner"; "When a button is clicked, set Status". Presets are plain data in `starter-recipes.ts`, built against the board's own columns and skipped when the board has no fitting column.

## Showcase

Per AGENTS.md rule 10, extend `scripts/showcase/seed-showcase.mjs` / `data.mjs` with two recipes on the showcase board: one enabled and harmless (item created → notify, owner as `runAs`), one disabled with a `disabledReason`. `isOwnedPath` must allow `boards/*/automations/*`. Do not seed `automationRuns`.

## Visual and accessibility

Tokens only (new `theme/automation-tokens.css` if needed), Vibe components, `prefers-reduced-motion`. Compare with monday's automation center from the screenshots in `docs/reference/monday/` if one is there; otherwise build to the Vibe defaults and log the gap in the Roadmap's VF group. Keyboard: the switch, menu and every picker are reachable and labelled; focus returns to the Automate button on close. Add the `automation-center-{light,dark}` visual screens (run the baselines workflow once).

## PR split

- **B1 (`claude/p5b-center`):** data layer, `describeAutomation`, Automation center with Recipes and Run history, enable/disable, delete, Automate button wiring, tests.
- **B2 (`claude/p5b-builder`, after B1):** recipe builder, starters, showcase, visual screens and baselines.
- Both may be built before #90 merges but **merge only after it**, so the history is never live against a missing engine. Neither touches a hot-spot file other than `scripts/showcase/**` and `tests/visual/__screenshots__/**` (B2).

## Out of scope

More triggers and actions (P5c), time-based triggers (P5d), recipe import/export and failure notifications (P5e), editing `consecutiveFailures`, anything that writes `automationRuns`.

## Check before building

The circuit breaker counts consecutive failures server-side. Confirm in `functions/src/lib/automations/` that a successful run resets `consecutiveFailures`, so a recipe the owner turned back on does not trip again after one failure. If it doesn't, report it; the fix is a small Functions change in its own PR, not part of the UI.
