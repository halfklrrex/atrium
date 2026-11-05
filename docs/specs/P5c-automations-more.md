# P5c: more automation triggers and actions

Author: Ophelia · Implementers: Sonnet 5.5 (medium effort) · Roadmap: P5 · Automations (new item "More triggers and actions") · Design: `P5-automations-design.md` (sections 4, 5, 7, 11) · Builds on: `P5a-automations-backend.md` (PR #90, the engine) and `P5b-automations-ui.md` (#97, #100). The engine (#90), the Automation center (#97) and the recipe builder (#100) are merged (2026-11-05), so this can start.

## What the owner gets

Recipes can start on more events and do more things:

- **New triggers:** "Item moved to a group" and "Person assigned" (a People column gains someone).
- **New actions:** "Create item" (in a group, with a few values) and "Post an update" (author shown as "Automations").
- **New condition operators are not in scope.** Conditions stay as in P5a.

Decisions 2026-11-04 (design section 11) already cover these: create items and post updates are allowed, behind the same limits (20 recipes per board, 100 runs per hour, depth 3).

## Ground truth to verify first

Read these on `main` and fix this spec if they differ (written against the engine as merged in #90):

- `packages/shared/src/schemas/automation.ts`: `automationTriggerSchema` (discriminated union on `type`, each member strict), `AUTOMATION_TRIGGER_LABELS`, `validateAutomation`, `AUTOMATION_LIMITS`. Actions are `buttonActionSchema` (`packages/shared/src/columns/button.ts`).
- `functions/src/lib/automations/match.ts`: `matchAutomation(automation, entry, item)` is pure; `TRIGGER_KINDS` lists the activity kinds that can start a recipe (`item_created`, `value_changed`, `button_clicked`).
- `functions/src/lib/automations/run.ts` and `functions/src/lib/column-actions.ts` (`runActionsInTransaction`): the one executor that button clicks and recipes share. Writes carry `automationRunId` and `automationDepth`; the activity trigger credits `automation:<id>` (`functions/src/lib/activity.ts`).
- Activity kinds already exist for both new triggers: `item_moved` (`data.fromGroupId`, entry `groupId` is the destination) and `value_changed` on a `people` column (`data.fromValue` / `toValue` are kept when they fit `ACTIVITY_LIMITS.rawBytes`; `toText` names the people).

## 1. Shared schemas (hot spot: one small PR, first)

`packages/shared/src/schemas/automation.ts`:

- Trigger `item_moved`: `{ type: 'item_moved', groupId?: slugId }`. Absent `groupId` means any move.
- Trigger `person_assigned`: `{ type: 'person_assigned', columnId: id, uid?: uid }`. `columnId` must be a `people` column. Absent `uid` means anyone newly added.
- Labels in `AUTOMATION_TRIGGER_LABELS`: "Item moved", "Person assigned".
- `validateAutomation`: `item_moved` needs `groupId` to exist when given. `person_assigned` needs an existing `people` column; `uid`, when given, must be in `board.memberUids`.
- Actions (in `packages/shared/src/columns/button.ts`, kept in the **one** action schema and marked automation-only so the button editor does not offer them: add `AUTOMATION_ONLY_ACTION_TYPES = ['create_item', 'post_update']` and make `validateButtonActions` refuse them for a button column and accept them for an automation):
  - `{ type: 'create_item', name: string(1..500) (supports the `{name}` and `{date}` tokens of `renderRenameTemplate`), groupId?: slugId, values?: Record<columnId, unknown> (max 10 entries) }`. Every value goes through `columnRegistry.validateCell`; derived, server-managed and locked columns are refused, as for `set_value`.
  - `{ type: 'post_update', text: string(1..2000) }` (plain text; same `{name}` / `{date}` tokens).
- Add labels to `BUTTON_ACTION_LABELS`. Existing exhaustive `Record<ButtonAction['type'], …>` maps fail to compile until updated; that is the checklist.
- Tests: schema accept/reject per type, `validateAutomation` per rule above, and "a button column refuses `create_item` / `post_update`".

## 2. Matching (`functions/src/lib/automations/match.ts`)

- Add `item_moved` and `person_assigned` to the `matchAutomation` switch and `item_moved` to `TRIGGER_KINDS` (`value_changed` is already there).
- `item_moved`: `entry.kind === 'item_moved'` and, when `trigger.groupId` is set, `entry.groupId === trigger.groupId`.
- `person_assigned`: `entry.kind === 'value_changed'`, `entry.columnId === trigger.columnId`, and the set of uids in `data.toValue` minus the set in `data.fromValue` is non-empty (and contains `trigger.uid` when given). Read people uids with the helper behind `assigneeUidsOf` (`packages/shared/src/item-index.ts`). If `toValue` was not kept (too big), fall back to the item's current value for "to" and treat "from" as empty only when `fromValue` is also missing; never match when it can't be decided (prefer a missed run over a wrong one, and say so in a comment).
- Loop and self-trigger rules are unchanged: depth >= 3 records a `skipped` "loop limit" run, and a recipe never reacts to its own writes.
- Tests: table-driven, one row per accept/reject case, including a people change that only removes someone (no match) and `uid` filtering.

## 3. Executor (`functions/src/lib/column-actions.ts`, `automations/run.ts`)

Both new actions need a **new document**, which `runActionsInTransaction`'s field-path patch of one item cannot express. Extend the plan it returns:

- `create_item`: the runner builds a new item doc in the same transaction, the way `onItemCreated` expects (`createdBy: runAs`, the destination group's position at the end, `values` as validated, `automationRunId` and `automationDepth` set so the resulting `item_created` activity is credited to the automation and carries depth + 1). The item number still comes from the existing `onItemCreated` path; **do not** allocate it in the runner. Enforce the board's item cap if one exists (check `firestore.rules` / `onItemCreated`), else add `AUTOMATION_LIMITS.maxCreatedPerRun = 1` (one `create_item` action per recipe, enforced by `validateAutomation`) so a recipe cannot fan out.
- `post_update`: a new doc in the item's updates collection, authored as `automation:<id>` with the display name "Automations" and no photo; `createdBy` follows what the update rules/schema require. Check how `update_posted` activity is produced (the activity trigger, from the update doc) so it is not written twice. Plain text is stored in whatever shape the composer's plain updates use (look at `apps/web/src/data/updates.ts` and the updates schema), and the same length limits apply.
- Both stay inside the existing guards: `runAs` must still have edit access, the item must be active, the rate limit counts the run once, and a failure rolls everything back and counts toward the circuit breaker.
- Each action type is reported in `run.actions` (the run doc) and in the `automation_ran` activity entry.
- Loop safety is the main risk: a recipe "when an item is created in group A, create an item in group A" would loop. The depth marker (`automationDepth` on the created item → `data.depth` on its `item_created` entry) must stop it at depth 3. **Write that exact case as an emulator end-to-end test** (patterned on `tests/rules/src/automations.e2e.test.ts`): it produces 3 created items and then one `skipped` "loop limit" run.
- Tests: unit tests for the plan builder per action; e2e for `create_item` (item exists, numbered, credited to the automation), `post_update` (update exists, author is "Automations"), `item_moved` and `person_assigned` end to end, and the loop case above.

## 4. Rules (`firestore.rules`, `tests/rules/**`; hot spot: keep minimal)

- Expected: **no rule change**, because the runner writes with the Admin SDK and the `automations` rule validates the trigger/action only through the schema in Functions/web. Verify that the `automations` create/update rules do not enumerate trigger or action types; if they do, extend them and add allow/deny tests. Clients still cannot write the marker fields on items or updates (existing tests must stay green).

## 5. Web (`apps/web/src/components/automations/`)

- `describeAutomation` (sentences): "When an item is moved to Done", "When someone is assigned to Owner", "create an item "{name} follow-up" in Backlog", "post an update "…"". Unit tests for every new type, including a deleted group / column.
- Trigger picker: add the two triggers with their params (group picker; people column + optional person picker from `board.memberUids`).
- Action editor: the recipe builder reuses `ButtonActionsEditor`. Add rows for `create_item` (name field, group picker, up to 10 column values using the same value editors as `set_value`) and `post_update` (text area). The prop that says "this is a button" hides the two automation-only types in the button column settings.
- Run history needs no change (it lists `actions` as strings), but check the labels for the new types.
- Showcase (rule 10): `scripts/showcase/data.mjs` gets two more recipes ("When an item moves to Done, post an update" and "When someone is assigned, create a follow-up item"). The test that every trigger/action type appears must pass.
- Visual: the builder dialog changes, so run the baselines workflow on the branch and mention the diffs in the PR.

## PR split

1. **P5c-1 shared** (schemas, validation, labels, button-editor filtering): hot spot, small.
2. **P5c-2 functions** (matcher, executor, e2e tests). Depends on 1.
3. **P5c-3 web + showcase** (describe, pickers, editor rows). Depends on 1 and can run in parallel with 2.

## Out of scope

Time-based triggers and recurring items (P5d), "set date to today / in N days", "assign a person", "create subitem", conditions beyond P5a, and webhooks. Each is its own small PR later.

## Definition of done

`pnpm lint`, `typecheck`, `test`, `test:rules` and `build` pass; CI is green including `visual`; the loop e2e test exists; a recipe of each new type fires end to end on the showcase board in production; the Roadmap item is In review with Actionable = Yes and an entry in `docs/plans/owner-check-list.md`.
