# P5 Design: the automations engine (design only, no code yet)

**Roadmap items:** Automation engine design (`3306251672`), Event triggers, Actions library, Recipe builder UI, Automation center & run history, Time-based triggers (all P5). **Status:** design for the owner to review. Nothing here is built. It ends with questions only the owner can answer.

## 1. What an automation is

A monday-style **recipe**: "When _trigger_, (and _conditions_), then _actions_." A board owner creates recipes on a board; they run on their own, on the server, whether or not anyone has the board open.

Example recipes this must support: "When Status changes to Done, move the item to the Done group." "When an item is created, notify Avery." "When Date arrives, set Status to Overdue." "When a button is clicked, do these steps" (that last one already exists as button actions; the recipe version lets a trigger other than a click start the same steps).

## 2. Building blocks we already have

- **The event stream.** `boards/{id}/activity` (live since #58, Functions-only) already records every board and item change with its actor: `item_created`, `value_changed` (column, from, to), `item_renamed`, `item_moved`, `item_archived`, `button_clicked`, and the board-level kinds. It has a 90-day TTL, and its docs carry `actorId`. The activity spec already reserves `actorId: 'automation:<id>'` for automation writes.
- **The actions library.** Button actions (`buttonActionSchema` in `packages/shared/src/columns/button.ts`; executor in `functions/src/lib/column-actions.ts`): `set_value`, `rename_item`, `move_to_group`, `archive_item`, `notify`, validated by `validateButtonActions` and applied as one field-path patch in a transaction. This is deliberately the actions vocabulary of automations (Decisions board, 2026-11-03).
- **Notifications** (`deliverButtonNotifications`, the `button` kind), the **column registry** (`validateCell`, emptiness, derived and server-managed rules), column locks, board roles.

## 3. Data model

`boards/{boardId}/automations/{automationId}` (client writes by board owners only; rules validate the shape, like board columns):

| Field                                              | Meaning                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                             | Short label; if empty the UI shows the sentence.                                                                                                                                                                    |
| `enabled`                                          | Bool. Disabled by the circuit breaker on repeated failure (section 7).                                                                                                                                              |
| `trigger`                                          | `{ type, ...params }`, section 4.                                                                                                                                                                                   |
| `conditions`                                       | 0 to 3 filters on the item at run time, e.g. `{ columnId, op: 'is' / 'is_not' / 'is_empty' / 'is_not_empty', value }`. All must hold (AND).                                                                         |
| `actions`                                          | 1 to 5 button-action objects (the same schema), plus automation-only types added later (section 5).                                                                                                                 |
| `createdBy`, `createdAt`, `updatedAt`, `updatedBy` | Standard.                                                                                                                                                                                                           |
| `runAs`                                            | The uid whose permissions the run uses: always the creator. If that person is no longer an owner or editor of the board when a run starts, the run is skipped and the automation is disabled with a visible reason. |

`boards/{boardId}/automationRuns/{runId}` (Functions-only writes; owners read): `automationId`, `eventId`, `itemId`, `status` (`ok`, `skipped`, `failed`), `reason`/`error` (short, no stack traces), `actions` applied, `startedAt`, `durationMs`, `depth`, `expiresAt` (30-day TTL). `runId` = `${automationId}-${eventId}`, which makes a retried trigger idempotent.

## 4. Triggers (what starts a recipe)

An event is one activity document. A single Firestore trigger on `boards/{b}/activity/{e}` (`onActivityCreated`, `database: FIRESTORE_DATABASE_ID`, `retry: true`) loads the board's enabled automations (cached per invocation, at most 20 per board) and matches them.

First wave (all come straight from existing activity kinds):

1. **Item created** (optionally in a group).
2. **Column changed** (any value) and **status changed to** a label (the two most used).
3. **Item moved to** a group.
4. **Item assigned** to a person (a People column gained a person).
5. **Button clicked** (a given button column): lets a click start a recipe's steps.

Second wave: **date arrives** and recurring items (time-based, section 8), **subitem created**, **update posted**.

Matching is pure and unit-testable: `matchAutomation(automation, activityEvent, itemSnapshot) -> boolean`. The item is read fresh when the run starts (so conditions see the current values).

## 5. Actions

Reuse the button executor as a shared function, `runActions(actions, ctx)`, extracted from `clickButtonInTransaction` (so a button click and an automation run the same code and the same validation). Automations add, over time and each as its own small PR: **create item** (in a group, with values), **set date to today / in N days**, **assign** (add a person), **create a subitem**, **post an update** ("Automations" as the author). Every new type goes into the one shared action schema and gets a web editor row; the button editor and the recipe builder then both offer it (some types, like "create item", can be marked automation-only).

Writes made by an automation record `automation:<id>` as the **activity actor**, while the item patch carries the `runAs` uid in `updatedBy`. Automations write through the admin SDK, which bypasses security rules, so the same permission checks a button click gets are done in code: the board role of `runAs` and column locks.

## 6. Where the code lives

`functions/src/lib/automations/`: `match.ts` (triggers and conditions, pure), `run.ts` (loads the item, checks `runAs`, calls `runActions`, writes the run doc and the activity entries in one transaction), `limits.ts`; `functions/src/triggers/onActivityCreated.ts`. Shared schemas in `packages/shared/src/schemas/automation.ts`. Rules for `automations` (owners write, editors and viewers read) and `automationRuns` (owners read; nobody writes).

## 7. Safety: loops, floods and cost

- **Loop protection.** Every activity entry written by an automation carries `actorId: 'automation:<id>'` and `data.depth` (the depth of the chain that caused it; user actions have depth 0). The matcher ignores events whose `depth >= 3`, and never lets an automation react to an event it caused itself (same `automation:<id>` actor). A recipe that moves an item into a group that triggers another recipe works, but a cycle stops after 3 hops and the run is recorded as `skipped` with reason "loop limit".
- **Flood limits.** At most 20 automations per board, 5 actions each; at most 100 automation runs per board per hour (excess runs are `skipped` with reason "rate limit", visible in the history); at most 10 notifications per run (the existing limit).
- **Circuit breaker.** After 10 consecutive failed runs an automation disables itself and shows why in the center.
- **Idempotency.** The deterministic run id makes at-least-once delivery safe.
- **Cost.** The trigger reads only the board's automation docs and the one item; no per-event scans. Blaze usage stays small for a personal tool; the rate limits cap the worst case.
- **Security.** Automations never exceed the permissions of `runAs`; they cannot write derived or server-managed columns; every value goes through `columnRegistry.validateCell`.

## 8. Time-based triggers (later wave)

"Date arrives", "every Monday create an item": a Cloud Scheduler job every 5 minutes calls a function that finds due items via a collection-group query on a derived `dueAt` index maintained next to the item index (`assigneeUids`, `nameTokens` exist already), claims them with a transaction (so two overlapping ticks cannot double-run), and emits the same kind of event into the same matcher. Needs its own spec (indexes, timezones with the user's `timezone`, daylight saving).

## 9. UI

- The board header's existing **Automate** button opens the **Automation center**: a side panel or full dialog listing recipes as sentences ("When Status changes to Done, move item to Done") with an on/off switch, last run time and result; a "Create automation" button; a run history tab with filters (status, automation) reading `automationRuns`.
- **Recipe builder:** a sentence with dropdown pickers ("When [trigger] [params], [+ condition], then [action] [params]"); the action rows reuse the button actions editor (`ButtonActionsEditor`) so there is one editor to maintain.
- Empty, loading and error states as in VF3; tokens and Vibe components only; measured against monday's automation center in light and dark.

## 10. Phases (each a spec-first PR)

- **P5a Backend core:** schemas, rules and tests, `runActions` extraction, `onActivityCreated`, the first three triggers, run history and loop and rate limits. Hot spots (shared, rules): one PR.
- **P5b Recipe builder and Automation center UI.**
- **P5c More triggers and actions** (assigned, button clicked, create item, post update, set date).
- **P5d Time-based triggers.**
- **P5e Polish:** templates gallery entries, import/export of recipes, per-recipe notifications on failure.

## 11. Decisions (2026-11-04)

**Status: Accepted.** The owner delegated these product decisions to the lead ("you can make the most informed decisions"). They answer the six questions this section used to ask.

1. **Runs as:** the person who created the recipe, with their permissions. If they lose access to the board, the run is skipped and the automation is disabled with a visible reason.
2. **First recipes (P5a):** status changed to, item created, button clicked. Moved to group and assigned follow in P5b.
3. **Limits:** 20 automations per board, 100 runs per hour per board, loop depth 3. They are constants in `functions/src/lib/automations/limits.ts` so they are easy to raise.
4. **Create items and post updates:** yes, in P5c, behind the same limits.
5. **Failures:** always in the run history. The creator gets one notification when the circuit breaker disables an automation, not one per failed run.
6. **Notification label:** "Automations" plus the recipe name, with the creator named in the notification detail.

P5a can start once the work in `docs/plans/2026-11-04-owner-feedback.md` (sections A and B) has merged.
