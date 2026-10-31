# P4: Activity & audit log

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: "Activity & audit log" (3306251299) · Branches `claude/p4-activity-backend`, `claude/p4-activity-web`

## Goal

Every meaningful change on a board leaves an entry in `boards/{boardId}/activity`, written only by Cloud Functions. Board members read it in two places, as in monday: the item card's **Activity Log** tab (one item's history) and a board-level **Activity log** side panel with filters by person, column and date.

## Facts (main on 2026-10-31)

- `boards/{id}/activity/{eventId}` exists but **only `clickButton` writes it** (`functions/src/lib/column-actions.ts`, `ActivityAppendData`: `kind: 'button_clicked', itemId, columnId, userId, createdAt, data {itemName, columnLabel, columnColor?}`, auto id, in the callable's transaction via `admin.ts appendActivity`). No shared zod schema; the type is local to functions.
- Rules (`firestore.rules` ~359): `match /activity/{eventId} { allow read, write: if false; }`. Nobody can read it, so no client depends on the current shape.
- The item card's "Activity Log" tab (`components/item-card/ItemCardDrawer.tsx` ~177) is a **client-side fake**: "Item created by you / a team member" from `createdBy` plus the updates list. No real history.
- Item docs carry `updatedBy` (rules force `== uid()` on every client create and update, ~554/581), so an item trigger knows the actor. **Board docs have no `updatedBy`**, so a board trigger can't attribute column or group changes today.
- Server writes on items that are not user edits: `onItemCreated` (`seq`, `boardSeq`, no `updatedBy` change), `finalizeDescriptionImage` (`descriptionImages`), `updatesCount` (client-maintained counter). Time tracking and files callables write `values.<id>` and set `updatedBy` to the caller.
- Existing item triggers: `onItemCreated` (create) and `onItemPeopleAssigned` (`onDocumentWritten`, notifications). Patterns to copy: deterministic ids per `event.id` (`notificationId`), pure logic behind an injected store with fake-based tests (`lib/notifications.ts`, `lib/board-sharing.ts`), member profile lookup (`getMemberProfile`), TTL via `fieldOverrides ... "ttl": true` (presence).
- `columnRegistry.toText(type, value, settings)` exists in shared. `people.toText` returns uids, so people need names resolved server-side.
- `purgeTrash` purges deleted boards with `recursiveDelete`, which already removes their activity.

## Design decisions (log on the Decisions board when approved)

1. **Events (v1).** `item_created`, `item_renamed`, `item_moved` (group change), `item_archived`, `item_deleted`, `item_restored` (archived/deleted back to active), `value_changed` (one entry per changed stored column, with old and new value), `column_added`, `column_renamed`, `column_deleted`, `column_type_changed`, `column_type_reverted`, `group_added`, `group_renamed`, `group_deleted`, `board_renamed`, `board_kind_changed`, `board_access_changed` (one entry per affected person, with old and new role), `board_left`, `update_posted` (top-level updates only, with a 120-char snippet), `button_clicked`. **Not logged:** description edits (autosave would flood the log), replies, reactions, positions/reordering, `seq`/`boardSeq`/`descriptionImages`/`updatesCount`, derived columns (store nothing), view changes, presence.
2. **Where to log.** A change made by a **callable** is logged **inside that callable's transaction** (it knows the actor, the old state and the reason): `setBoardAccess`, `setBoardKind`, `leaveBoard`, `changeColumnType`, `revertColumnType`, `clickButton`. A change made by a **client write** is logged by a **Firestore trigger** diffing before and after: new `onItemWrittenActivity` (items) and `onBoardWrittenActivity` (board doc: name, `columns` id set and titles, `groups` id set and titles, `state`), and the existing `onUpdateCreated` adds `update_posted`. The board trigger ignores column `type`, `settings`, `migrating` and `lastTypeChange` marks, `kind`, `access`, `accessUids`, `derivedColumnIds` and `serverManagedColumnIds`, so nothing is logged twice.
3. **Board `updatedBy`.** Add `updatedBy` to the board doc: rules require `request.resource.data.updatedBy == uid()` on every client board update and allow it (optional, `== uid()`) on create. Every web board write sets it (`data/firestore.ts`, `data/structure-writes.ts`). Callables that write boards set it to the caller. The board trigger uses `after.updatedBy ?? after.createdBy`.
4. **No loops, bounded amplification.** Activity docs live in a subcollection no trigger listens to; triggers on `boards/{id}` and `items/{id}` never fire for subcollection writes; the activity triggers never write the item or board. `onBoardColumnsWritten`'s own write re-fires `onBoardWrittenActivity` with no tracked diff, so it writes nothing. One item write produces at most one doc per changed column, capped at **20 per event** (the rest summarised in one `value_changed` with `data.more = n`). All docs of one event go in one batch with deterministic ids `${event.id}-${n}` written with `create()` (ALREADY_EXISTS ignored), so retries are idempotent. Triggers set `retry: true`.
5. **Doc shape** (`packages/shared/src/schemas/activity.ts`, `activityEventSchema`, `ACTIVITY_KINDS`, `ACTIVITY_LIMITS`):
   ```
   kind, createdAt (server ts), expiresAt (createdAt + 90 days, TTL),
   actorId, actorName, actorPhotoUrl|null          // from workspaces/{ws}/members/{uid}; "Someone" if missing
   itemId|null, itemName|null, parentItemId|null   // name as it was at the time
   columnId|null, columnTitle|null, columnType|null
   groupId|null, groupTitle|null
   data: { fromText?, toText?   // display text, capped 200 chars (people: member names, "+n")
           fromValue?, toValue? // raw stored value, only when its JSON is <= 2 KB, else omitted
           fromRole?, toRole?, targetUid?, targetName?, fromKind?, toKind?, snippet?, more?,
           fromGroupId?, fromGroupTitle?, columnColor? }
   ```
   Display fields are denormalised so the log reads correctly after renames and deletions and costs no extra reads. `clickButton` moves to this shape (`actorId`, `itemName`, `columnTitle` = button label).
6. **Retention: 90 days via Firestore TTL** on `expiresAt` (as presence), not a scheduled sweep: no function cost, and the policy ships through `firestore.indexes.json`. TTL deletes within about a day of expiry; the web hides entries past `expiresAt`. Legacy `button_clicked` docs (no `expiresAt`) are deleted by a one-off script, dry run unless `--apply`.
7. **Reads:** board readers (owner, editor, viewer by the effective role) read the whole board's activity, so private boards stay private through `canReadBoard`. Clients never write.

## Functions (PR 1)

- `functions/src/lib/activity.ts` (pure): `diffItemActivity(change, board, profiles)`, `diffBoardActivity(before, after)`, `activityDoc(base, kind, fields)`, `expiresAt(nowMs)`, text helpers (`toText` through the registry, people names, 200-char cap, 2 KB raw cap). Store interface `ActivityStore { getBoard, getMemberProfiles(ws, uids), createMany(boardId, docs) }`.
- `functions/src/lib/admin-activity.ts`: the admin adapter; a tx variant `appendActivityTx(tx, boardId, id, doc)` for callables.
- Triggers `triggers/onItemWrittenActivity.ts`, `triggers/onBoardWrittenActivity.ts` (both `database: FIRESTORE_DATABASE_ID`, `europe-west1`, `retry: true`); extend `triggers/onUpdateCreated.ts`; export in `index.ts`.
- Item trigger: ignore deletes of the doc (hard purge) and writes where `updatedBy` is unchanged and only ignored fields changed (`onItemCreated`). On create: one `item_created`.
- Callables: log in `board-sharing.ts`, `column-type-change.ts`, `column-actions.ts` (replace `ActivityAppendData`), and set `updatedBy` on their board writes.

## Web (PR 2)

1. **Data:** `apps/web/src/data/activity.ts`: `useItemActivity(boardId, itemId)` (live, `where itemId ==`, `orderBy createdAt desc`, limit 50, "Load more" via `startAfter`) and `useBoardActivity(boardId, filters)` (same, with `actorId in [...]` (max 10), `columnId ==`, `createdAt >=` from the date filter). Parse with the shared schema; drop docs that fail or are past `expiresAt`.
2. **Item card Activity Log tab:** replace the fake list. Row as in monday: relative time, actor avatar, column title (or event label: "Created", "Moved", "Archived"...), then old value, an arrow, new value. When the column still exists with the same `columnType` and the raw value is present, render the value with the column's read-only cell renderer (status pill, people avatars, date); otherwise the stored text. Updates stay in the Updates tab only.
3. **Board Activity log panel:** `components/activity/BoardActivityPanel.tsx`, a right-side panel opened from the board options menu ("Activity log", placed as in monday's menu: after the first divider, see the reference's "Board options menu") and closed with Escape or the close button. Header with title and close; filter bar: **Person** (member multi-select with avatars), **Column** (board columns), **Date** (Today, Last 7 days, Last 30 days, All, the default); rows like the item tab plus the item name (click opens the item card; nothing for deleted items). Board-level events read as sentences ("Avery Quinn renamed the group Done to Shipped").
4. **States:** loading (`Loader`/skeleton rows), empty ("No activity yet" or "No activity matches these filters" with a "Clear filters" button, `VF3` empty-state pattern), error (`describeCallableError`-style message with Retry). Shared components between tab and panel: `ActivityRow.tsx`, `activity-format.ts` (kind to label and sentence).
5. **Style:** Vibe components (`Avatar`, `Dropdown`, `Chips`, `Loader`, `IconButton`) and existing tokens only; no new tokens (if one is missing, stop and ask Ophelia rather than touching `tokens.css`). Measure against the monday activity log in `docs/reference/monday-ui-reference.md` (Claude's home copy has the screenshots).

## Rules and indexes (PR 1)

- `match /activity/{eventId} { allow read: if signedIn() && canReadBoard(boardId); allow write: if false; }`.
- Board update rule: `updatedBy` in the editable keys and required `== uid()`; create allows it optionally.
- Rules tests (`tests/rules/src/activity.test.ts`): owner, editor and viewer of a main board read and list; a workspace member not on a private board can't; a removed workspace member can't; nobody (owner included) creates, updates or deletes; board update without `updatedBy` or with another uid is refused; existing board tests updated to send `updatedBy`.
- `firestore.indexes.json`: composites on `activity` (COLLECTION) `itemId asc, createdAt desc`; `actorId asc, createdAt desc`; `columnId asc, createdAt desc`; and a `fieldOverrides` entry `expiresAt` with `"ttl": true, "indexes": []`. Person plus column together relies on Firestore index merging (the emulator doesn't enforce indexes); if production reports a missing index, add the composite it names in a follow-up PR.

## Tests

- **Shared:** schema round-trips for every kind; limits.
- **Functions (fakes):** each item event from a before/after pair; nothing for `seq`/`boardSeq`/`descriptionImages`/`updatesCount`/description-only writes; derived columns ignored; the 20-per-event cap; people names resolved; text and raw caps; board diff (add, rename, delete of columns and groups; type changes ignored); idempotent ids on retry; each callable writes its entry in the same transaction and none on refusal.
- **Emulator e2e** (`tests/rules/src/activity.e2e.test.ts`, like `board-sharing.e2e`): a client cell edit produces one `value_changed` readable by a viewer and not by an outsider; the `onBoardColumnsWritten` write adds no entry.
- **Web:** tab and panel render rows, each state, the filters build the right query, item click opens the card, legacy and expired docs hidden.
- **Visual:** item card Activity tab and board Activity log panel, light and dark, seeded with fixed activity docs.
- **Showcase:** not needed (no column type); optionally seed a few edits.

## Out of scope

Undo from the log, export, workspace- or account-level audit log, description diffs, activity for replies and reactions, notifications from activity, search inside the log, automations as actors (P5 adds `actorId: 'automation:<id>'` later), retention settings per board.

## Verify

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build`, then `pnpm test:visual` (PR 2). After PR 1 deploys: edit a cell, rename an item, move it, add and delete a column, change a board kind; confirm the docs in the console with correct actor and texts, and `gcloud firestore fields ttls list --database=atrium-1` shows the `expiresAt` policy. After PR 2: the owner checks both screens live (Actionable = Yes).

## PR split (sequenced; hot spots in PR 1 only)

**PR 1 `claude/p4-activity-backend`** (hot spots: `firestore.rules`, `tests/rules/**`, `packages/shared/**`; open only when no other open PR touches them):
`packages/shared/src/schemas/activity.ts` (+ `.test.ts`), `packages/shared/src/schemas/board.ts` (`updatedBy` optional), `packages/shared/src/index.ts`; `functions/src/lib/activity.ts` (+ `.test.ts`), `functions/src/lib/admin-activity.ts`, `functions/src/lib/admin.ts`, `functions/src/lib/column-actions.ts` (+ test), `functions/src/lib/board-sharing.ts` (+ test), `functions/src/lib/column-type-change.ts` (+ test), `functions/src/triggers/onItemWrittenActivity.ts`, `functions/src/triggers/onBoardWrittenActivity.ts`, `functions/src/triggers/onUpdateCreated.ts`, `functions/src/index.ts`; `firestore.rules`, `firestore.indexes.json`; `tests/rules/src/activity.test.ts`, `tests/rules/src/activity.e2e.test.ts`, every existing rules test that updates a board doc from a client (grep `tests/rules/src` for board updates; at least `rules.test.ts`, `p1a.test.ts`, `p1b.test.ts`, `column-locks.test.ts`, `derived.test.ts`) sends `updatedBy`; `apps/web/src/data/firestore.ts`, `apps/web/src/data/structure-writes.ts` (send `updatedBy`); `scripts/migrations/2026-11-delete-legacy-activity.mjs`; `docs/architecture.md` §5.6 and §8. No new dependency (no `pnpm-lock.yaml`).

**PR 2 `claude/p4-activity-web`** (after PR 1 merges and deploys; hot spot: `tests/visual/__screenshots__/**` via the baselines workflow only):
`apps/web/src/data/activity.ts` (+ test), `apps/web/src/components/activity/ActivityRow.tsx`, `activity-format.ts` (+ test), `BoardActivityPanel.tsx` (+ `.module.css`, test), `apps/web/src/components/item-card/ItemCardDrawer.tsx` (+ `.module.css`, test), `apps/web/src/components/boards/BoardHeader.tsx` (menu entry and panel mount), `apps/web/src/components/AppShell/ui-store.ts` (panel open state), `tests/visual/src/seed.ts`, `tests/visual/src/screens.spec.ts`.

## Owner questions

1. Retention of **90 days** (TTL) acceptable, or longer?
2. Should board **viewers** see the board activity log (proposed: yes, like monday)?
3. Leave **description edits** out of v1 (proposed), or log "Description updated" without the text?
