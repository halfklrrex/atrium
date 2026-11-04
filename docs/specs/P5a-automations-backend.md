# P5a: automations backend (build spec)

**Roadmap:** Automation engine design (`3306251672`), Event triggers (`3306259043`), Actions library (`3306251674`). **Author:** Ophelia (Opus 5.5). **Implementers:** Sonnet 5.5 subagents, one PR each (A1 to A4 below). **Design:** `P5-automations-design.md` (decisions in its section 11, Accepted 2026-11-04). This spec turns that design into buildable pieces and **closes the gaps found in the code review of 2026-11-04**. Where this spec and the design differ, this spec wins.

## Fixed decisions (owner delegated)

Recipes run as their creator (`runAs`). First recipes: **item created**, **status changed to**, **button clicked**. Limits: 20 automations per board, 100 runs per hour per board, loop depth 3, as constants in `functions/src/lib/automations/limits.ts`. Failures always show in the run history; one notification to the creator when the circuit breaker disables an automation. Notifications read "Automations" plus the recipe name, with the creator in the detail.

## Gaps closed here

1. **Loop marker on item writes.** `onItemWrittenActivity` logs every item patch with the actor from `itemActorId` (`updatedBy`, or `createdBy` on create), so an automation's write would look like a user action at depth 0 and the depth limit would never fire. Fix: an automation's item write sets two item fields, `updatedVia: 'automation:<automationId>'` and `automationDepth: <n>`. `itemActorId` / `diffItemActivity` (`functions/src/lib/activity.ts`) then use `updatedVia` as the activity actor id (the actor name comes from the automation name) and copy `automationDepth` into every entry's `data.depth`. A normal user write must clear both fields (set `updatedVia: null` in the same patch) so a later human edit isn't credited to the automation. Rules: clients may never write `updatedVia` or `automationDepth` (add them to the item rules' write-denylist, with tests).
2. **Activity schema.** `activityDataSchema` (`packages/shared/src/schemas/activity.ts`) gains optional `depth` (int 0 to 3) and `automationId`. New kind `automation_ran` (one per run, written by the runner; informational). `actorId` already accepts `automation:<id>`.
3. **Notifications.** `notificationKindSchema` gains `automation` and `automation_disabled`. The notification doc gains optional `recipeName` (max 80). `actorId` stays a uid: an automation notification uses the **creator's uid as `actorId`** (decision 6, "creator named in the detail") and the delivery function takes an explicit `includeActor: true` so the creator isn't skipped as "the actor". `automation_disabled` goes to the creator with the reason in `message`. Add an `automation` switch (default on) to the notification prefs schema, as `button` was added in #72, with a settings toggle "Automations".
4. **`runActions` has its own port.** The button path keeps its column checks, the 2-second repeat guard and the `button_clicked` entry. The shared part takes `memberUids` (so `notify` targets are validated against board members, which the click path skips today) and turns "item not active" into a `skipped` result instead of an `HttpsError`.
5. **Rate limit storage.** Counter doc `boards/{b}/counters/automations` with `{ hourBucket: <ISO hour>, runs: n }`, incremented inside the run transaction; a new hour resets it. Over the limit: the run is recorded `skipped`, reason `rate limit`.
6. **Indexes and TTL.** `automationRuns.expiresAt` TTL override and composite indexes (`automationId` + `startedAt` desc, `status` + `startedAt` desc) in `firestore.indexes.json`.
7. **Deploy cost.** The new trigger must set `cpu`/`concurrency`/`maxInstances` like the other triggers (`functions/src/lib/global-options.ts`) and be reviewed against `docs/specs/BUG-deploy-cpu-quota.md`. The trigger loads one board's automation docs once per event.

## A1: shared schemas, rules and tests (hot spots: `packages/shared`, `firestore.rules`, `tests/rules`)

- `packages/shared/src/schemas/automation.ts` (export from the package index):
  - `AUTOMATION_LIMITS` (`maxPerBoard 20`, `maxConditions 3`, `maxActions` = `BUTTON_LIMITS.maxActions`, `maxRunsPerHour 100`, `maxDepth 3`, `runTtlDays 30`, name max 80).
  - `automationTriggerSchema`: discriminated union on `type`, `.strict()` each: `item_created {groupId?}`, `status_changed {columnId, toLabelId?}` (label optional = any change), `button_clicked {columnId}`. (Further types arrive in P5b/c; keep the union open for them.)
  - `automationConditionSchema`: `{ columnId, op: 'is'|'is_not'|'is_empty'|'is_not_empty', value? }`, with a `value` required for `is`/`is_not`.
  - `automationSchema`: name, enabled, trigger, conditions (0 to 3), `actions` (1 to 5, **`buttonActionSchema` reused**), runAs, disabledReason (nullable, max 200), createdBy/At, updatedBy/At.
  - `automationRunSchema`: automationId, eventId, itemId, status `ok|skipped|failed`, reason/error (max 200), actions (applied action types), startedAt, durationMs, depth, expiresAt.
  - `validateAutomation(automation, board, role)` reusing `validateButtonActions` for the actions and checking that trigger and condition column ids exist and have a compatible type (status for `status_changed`, button for `button_clicked`).
- Activity and notification schema changes from gaps 2 and 3. Item index/schema: `updatedVia` (string|null) and `automationDepth` (int|null) on the item type.
- `firestore.rules`:
  - `boards/{b}/automations/{id}`: read for `canReadBoard`; create/update/delete for board owners only, with a shape check like board `columns` (`hasOnly`), `runAs == request.auth.uid` on create, `createdBy` immutable. Rules can't count documents, so the 20-per-board limit is enforced by `validateAutomation` in the UI and again in the runner (extra automations are ignored); say so in the rules test file header.
  - `boards/{b}/automationRuns/{id}`: read for board owners; write `false`.
  - `boards/{b}/counters/automations`: no client access (follow the existing `counters` rule).
  - Item rules: deny client writes touching `updatedVia` or `automationDepth`.
- `tests/rules/src/automations.test.ts`: allow/deny per role (owner, editor, viewer, non-member, signed out) for each path, plus the item-field denylist. Pattern: `tests/rules/src/activity.test.ts`.
- `firestore.indexes.json`: gap 6.

## A2: `runActions` extraction (functions only; no behaviour change for buttons)

- In `functions/src/lib/column-actions.ts` extract `runActionsInTransaction(tx, ctx)` from `clickButtonInTransaction`: it validates (`validateButtonActions` with `memberUids`), builds the patch (`buildActionsPatch`), applies it (`tx.updateItem`) and returns `{ applied: ButtonAction['type'][], notify?: ButtonNotifyPlan }`. `ctx` carries `{ boardId, item, actions, board, role, actorUid, extraItemFields }`; `extraItemFields` is merged into the patch (the automation uses it for `updatedVia`/`automationDepth`; buttons pass nothing).
- `clickButtonInTransaction` calls it; all existing button unit and e2e tests (`tests/rules/src/button-actions.e2e.test.ts` and the functions tests) must pass **unchanged**.
- The "item not active" case returns `{ skipped: 'item not active' }` from the shared function; the button path maps it back to the same `HttpsError` as today.
- Update `diffItemActivity`/`itemActorId` for the loop marker (gap 1) with unit tests: an item change with `updatedVia: 'automation:abc'` yields entries with `actorId 'automation:abc'` and `data.depth`; a later change with `updatedVia: null` yields a normal actor.

## A3: the engine (needs A1 and A2 merged)

- `functions/src/lib/automations/limits.ts`, `match.ts` (pure: `matchAutomation(automation, activityEntry, item) -> boolean`, `conditionsHold(conditions, item)`), `run.ts`, and `functions/src/triggers/onActivityCreated.ts` (`database: FIRESTORE_DATABASE_ID`, `region: 'europe-west1'`, `retry: true`, exported from `functions/src/index.ts`).
- Event flow: an activity entry arrives, then:
  - skip entries with no `itemId`, board-level kinds, or `data.depth >= 3`;
  - skip an entry whose `actorId` is `automation:<id>` when evaluating that same automation (no self-trigger);
  - load the board's enabled automations (max 20), match, and for each match run `run.ts`.
- `run.ts`, one transaction per run: read the item fresh; check `runAs` is still a board owner or editor (otherwise write a `skipped` run and disable the automation with `disabledReason`); check conditions; check and increment the hourly counter (gap 5); call `runActionsInTransaction` with `extraItemFields { updatedVia: 'automation:<id>', automationDepth: depth + 1 }`; write the run doc `${automationId}-${eventId}` (deterministic, so retries are idempotent; if it already exists, stop); append an `automation_ran` activity entry (`appendActivityTx`). After the commit, deliver the notify plan with the `automation` kind (best effort; a delivery failure is logged on the run as a note but doesn't fail it).
- Circuit breaker: track `consecutiveFailures` on the automation doc (server-written field, allowed in rules only for Functions since clients write via the admin-free path: add it to the client denylist). At 10, set `enabled: false`, `disabledReason`, and send the `automation_disabled` notification once.
- Triggers supported: `item_created` (activity kind `item_created`), `status_changed` (kind `value_changed` on the given status column, `toLabelId` compared with the new value), `button_clicked` (kind `button_clicked`, same column).
- Tests: unit tests for `match.ts` and conditions; e2e tests in `tests/rules/src/automations.e2e.test.ts` (pattern `button-actions.e2e.test.ts`) covering: each trigger fires its recipe; conditions block a run; a status-changed recipe that moves an item doesn't loop (depth stops at 3 with a `skipped` "loop limit" run); the rate limit skips the 101st run; a creator who lost access is skipped and the automation disabled; retry of the same event doesn't run twice; the circuit breaker after 10 failures.

## Out of scope for P5a

The recipe builder and Automation center UI (P5b, spec after A3), more triggers and actions (P5c), time-based triggers (P5d). A `showcase` recipe is added with P5b, when it is visible.

## Owner-visible result

None until P5b, except through the Firebase console (no UI). The owner check list gets a note: "P5a is backend only".
