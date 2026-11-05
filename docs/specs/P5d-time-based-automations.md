# P5d: Time-based automations (date arrives, recurring items)

Author: Ophelia · Implementers: Sonnet 5.5 (medium effort) · Roadmap: P5 · "Time-based triggers & recurring items" (item 3306248685) · Builds on: `P5-automations-design.md` section 8, `P5a-automations-backend.md`, `P5c-automations-more.md` · Status: **draft; the open questions below have defaults I will use unless the owner says otherwise.**

## Goal

Two new automation triggers, run by a scheduler instead of by an item event:

1. **Date arrives:** "When a date column's date arrives (or N days before or after it), then …". Example: "3 days before Due date, notify the owner".
2. **Recurring:** "Every day, week or month at HH:MM, then …". Example: "Every Monday at 09:00, create an item 'Weekly review {date}'".

Both reuse the P5a engine: matcher, `runActions`, run history, rate limit, depth and circuit breaker. No new action types.

## Facts this design rests on

- A date cell is `{ date: 'YYYY-MM-DD', time?: 'HH:MM:SS' }` with **no timezone** (`packages/shared/src/columns/date.ts`). Users have `users/{uid}.timezone` (an IANA name).
- Automations run as `runAs` (the creator, `P5a` section 11). The recipe's time zone is therefore the **creator's `users/{uid}.timezone` at the moment the recipe is saved**, stored on the recipe (`timezone`), so a later profile change does not silently move every schedule.
- `functions/src/scheduled/` holds the existing scheduled functions (`purgeTrash.ts` and others); Cloud Scheduler plus Eventarc are already set up.
- Server-maintained item index fields (`assigneeUids`, `nameTokens`) are written by Functions only and are in neither item key list of the rules (`packages/shared/src/item-index.ts`).

## Design

### Triggers (shared schemas, `packages/shared/src/schemas/automation.ts`)

```
{ type: 'date_arrives', columnId, offsetDays: -30..30 (0 = on the day), at?: 'HH:MM' }
{ type: 'recurring', every: 'day' | 'week' | 'month', weekday?: 0..6, dayOfMonth?: 1..28, at: 'HH:MM' }
```

- `date_arrives` needs a `date` column (validated like other column triggers). `at` defaults to the cell's own time, else `09:00`.
- `recurring` has no item: its actions are limited to `create_item`, `notify` and `post_update` is **not** allowed (no item to post on). Day of month is capped at 28 so every month has it (no "31st" surprises).
- A recipe has `timezone` (IANA, from the creator at save time) in addition to the trigger fields. Validation refuses an unknown zone (`CANONICAL_TIMEZONES` exists in `packages/shared/src/columns/canonical-timezones.ts`).

### Scheduler (`functions/src/scheduled/runTimeAutomations.ts`)

- Runs **every 5 minutes** (Cloud Scheduler), with the named database `atrium-1`.
- It processes the window `(lastTickAt, now]`, where `lastTickAt` is stored in `system/automationScheduler`. A missed tick (outage) is caught up on the next run, but never more than **24 hours** back, so a long outage cannot create a flood.
- **Recurring:** find enabled `recurring` recipes with a collection-group query on a new `nextRunAt` field kept on the automation doc (computed server-side from `every`, `at` and `timezone`, daylight saving aware, advanced after each claim). Claim the recipe in a transaction (`nextRunAt` moves forward in the same transaction as the run record), so two overlapping ticks cannot double-run. Deterministic run id: `recurring:<automationId>:<scheduledForISO>`.
- **Date arrives:** find due items with a collection-group query on a new server-maintained item field `dueAt` (an array of `{columnId, atMs}`-style entries flattened to one sortable number list per board column is too heavy; use a single index field `dateDueAtMs: number[]`, UTC milliseconds of each date cell's `date`+`time` in the **recipe's** timezone is not known at index time). **Decision:** index `dateKeys: string[]` of `"<columnId>:<YYYY-MM-DD>"` per item (maintained by the same trigger that maintains `assigneeUids`); the scheduler queries `array-contains` for each enabled `date_arrives` recipe for the target date computed in the recipe's timezone (`today - offsetDays`). Deterministic run id: `date:<automationId>:<itemId>:<YYYY-MM-DD>` so a date only ever fires once per item and recipe, even if the date is edited back and forth.
- Each match goes through the same matcher and runner as event triggers, with `depth 0`, the same rate limits (`maxRunsPerHour`) and the circuit breaker. Excess runs are recorded `skipped`, never dropped silently.
- Items that are archived or in the trash are skipped (as for other triggers).

### Data and rules

- New server-only fields: `automations.nextRunAt`, `items.dateKeys` (not in any client key list; rules refuse client writes, like `assigneeUids`), `system/automationScheduler` (no client access).
- `firestore.indexes.json`: a collection-group index on `automations` (`enabled`, `nextRunAt`) and the `items` `dateKeys` `array-contains` query. Check the CPU-quota note (`docs/specs/BUG-deploy-cpu-quota.md`) before adding the scheduled function.
- Backfill: a dry-run-by-default migration under `scripts/migrations/` to fill `dateKeys` for existing items (patterned on `2026-11-backfill-item-index.mjs`). Not run without the owner's agreement.

### Web (Automation center and builder)

- The builder offers "Date arrives" (column, days before/on/after, time) and "Every day/week/month" (weekday or day of month, time). The sentence shows the zone ("Europe/Madrid"); `describeAutomation` covers both.
- The Create catalog badges for "Dates" and recurring templates move from `p5d` to `ready` as each one lands.
- Run history shows the scheduled time for scheduler-driven runs.

## Open questions for the owner (defaults in bold)

1. **Time zone:** the creator's profile zone at save time, stored on the recipe. **Yes.** (Alternative: always UTC; simpler, but "Monday 09:00" would be wrong for everyone.)
2. **Catch-up:** missed ticks are replayed up to 24 hours back. **Yes** (alternative: skip anything missed).
3. **Date arrives fires once per item and date** even if the date is edited and comes round again. **Yes.**
4. **Recurring "create item" target:** the recipe names a group (else the board's first group), as for `create_item` in P5c. **Yes.**
5. **Limits:** at most 5 scheduled recipes per board (inside the 20 per board), minimum recurrence one day. **Yes** (no hourly or minute recurrence).

## PR split

1. **P5d-1 shared:** trigger schemas, validation, timezone, labels, helpers for next-run computation (pure, DST-tested), `dateKeys` computation. Hot spot, small.
2. **P5d-2 rules, indexes and backfill:** rules refusing client writes to the new fields, `firestore.indexes.json`, the migration script and its test.
3. **P5d-3 functions:** `dateKeys` maintenance next to the item index, the scheduled function, claim transactions, e2e tests (overlapping ticks, catch-up cap, DST changes, once-only dates, rate limit).
4. **P5d-4 web and showcase:** builder rows, describe sentences, catalog relabels, run-history scheduled time, a showcase recipe of each type, owner check-list entry.

## Tests that must exist

- Pure next-run tests across DST changes (Europe/Madrid, America/New_York, a zone without DST), month ends and the weekday rule.
- E2E: two overlapping ticks run a recipe once; a 3-hour outage replays once; a 30-hour outage replays only the last 24 hours; editing a date back and forth fires once; an archived item does not fire; the rate limit and circuit breaker still apply.
- Rules: clients cannot write `nextRunAt`, `dateKeys`, or `system/automationScheduler`.

## Definition of done

The five checks pass, CI is green including `visual`, a scheduled recipe of each type fires on the showcase board in production, the Roadmap item is In review with Actionable = Yes and an entry in `docs/plans/owner-check-list.md`.
