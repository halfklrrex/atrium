# P2: short numeric item IDs and server-assigned auto numbers

Roadmap item: "Short numeric item IDs (server-assigned, monday-style)" (P2 group). The owner approved it on 2026-10-27.

## Why

- **Item ID is unreadable.** The column shows the Firestore document id, a random 20-character string, in a grey pill. monday shows a short number as plain text.
- **Auto number never gets a value.** It stores `values.<col> = { auto_number: n }`, but nothing assigns `n`: new items stay empty, and only seeded data shows numbers. Clients could also write any number into it.

Both are "a number the server hands out when an item is created", so one trigger does both.

## Design

### Data

New item fields. Only Cloud Functions write them, and they're absent until assigned:

```
seq: int        // account-wide item number, 1, 2, 3, ... never reused; drives the Item ID column
boardSeq: int   // per-board creation number for top-level items, or per board for subitems (own counter); drives Auto number
```

Counters live in Functions-only documents:

- `counters/items`: `{ next: int }`. One counter for the whole Atrium project, so ids stay unique when a board moves between workspaces, as monday's do.
- `boards/{boardId}/counters/items`: `{ nextItem: int, nextSubitem: int }`.

Both are absent at first, which reads as 0. Rules: an explicit `allow read, write: if false` for `counters/{id}` and `boards/{boardId}/counters/{id}`, in the same style as `activity`.

### Assignment: the `onItemCreated` trigger

- Path: `functions/src/triggers/onItemCreated.ts`.
- Signature: `onDocumentCreated({ document: 'boards/{boardId}/items/{itemId}', database: FIRESTORE_DATABASE_ID, region: 'europe-west1', retry: true })`.
- Logic: put a pure allocate function in `functions/src/lib/item-seq.ts`, unit-tested with a fake transaction like `bootstrap.test.ts`, and call it from the trigger. In one transaction:
  1. read the item, and stop if it no longer exists or already has both `seq` and `boardSeq` (this makes it idempotent under retries);
  2. read both counters;
  3. set `seq = global.next + 1` and `boardSeq = board.(nextItem|nextSubitem) + 1`, choosing by `parentItemId == null`;
  4. write the item fields and both counters. Don't touch `updatedAt` or `updatedBy`: this is metadata, not an edit.
- Contention: one global counter doc handles roughly one write per second sustained. That's fine at family scale. A bulk create (duplicating a group, a future import) just queues transaction retries. Note this as a known limit.
- Register it in `functions/src/index.ts`, and add it to `scripts/database-id.test.mjs` coverage if that test lists triggers explicitly.

### Rules

- `validItemCreate` already uses `hasOnly` and `validItemUpdate` uses `changed.hasOnly`, so `seq` and `boardSeq` are refused from clients without any rule change.
- Add a comment there saying so.
- Add the two counter matches above.
- Rules tests in `tests/rules/`:
  - a client can't create an item with `seq` or `boardSeq`;
  - a client can't change or remove either field on update, including through `updatesCount` bumps;
  - a client can't read or write either counter doc;
  - normal edits to an item that already has `seq` still pass.

### Shared registry (`packages/shared`)

- `ColumnContext.item` gains `seq?: number` and `boardSeq?: number`.
- **`item_id`:**
  - `compute` returns `String(item.seq)`, with the customKey prefix applied by `formatItemId`, or `null` while `seq` is missing.
  - The value stays a string, and `compare` already handles numeric strings.
  - Update the `TODO(derived)` comment.
- **`auto_number` becomes `derived: true`:**
  - `compute` returns `{ auto_number: item.boardSeq }`, or `null` while it's missing. The value shape and `toText` (prefix) stay as they are.
  - Stored `values.<col>` for auto number are ignored from now on.
  - Remove it from any "client-writable" lists (e.g. `column-validation.ts`, if that list means editable), and check the formula visitor (`formula/visitors.ts`), which reads `auto_number` from raw values. It must use the computed value.
- Tests: update `computed-columns.test.ts` for both types, with seq present and missing.

### Web

- Wherever Firestore item docs map to the item model and `ColumnContext`, carry `seq` and `boardSeq` through.
- Never copy them on duplicate: check `item-writes` / duplicate paths, because a duplicate gets new numbers from the trigger.
- **Cells, matching monday:**
  - Item ID and Auto number render as **plain text**: `--primary-text-color`, the table body font, centred like other number-ish cells.
  - Remove the `.idBadge` pill. Delete the class if nothing else uses it.
  - Empty while pending. The trigger lands in about a second, and the listener updates the cell.
- Search, sort and footer: derived columns go through `computeValue`. Make sure sort uses it for both types; this is the known limit 3 in architecture section 6.2. If sort for derived columns is still unimplemented in general, implement it for these two at least and note it.
- Kanban card fields (`KanbanCard.tsx` lists both types) must show the computed values.

### Backfill

`scripts/migrations/2026-10-backfill-item-seq.mjs`, modelled on `2026-10-backfill-derived-column-ids.mjs`: same auth, same `--project` and `--apply` flags, dry run by default, emulator when no project is given, and a test file alongside it.

- Collect every item in every board (including archived and deleted) that lacks `seq`, sorted by `createdAt` and then by id.
- Assign `seq` from the global counter in that order. Assign `boardSeq` per board, with separate sequences for items and subitems, continuing from each board counter.
- Write the item fields and the final counters. Re-running it assigns nothing new.
- **Race:** run it right after the trigger deploys. Items created during the run get their numbers from the trigger, which uses the same counters. The script must read and advance the counters in transactions (or commit preconditions), never blind-set them, so the two never hand out the same number.
- Document the run command in the PR. Ophelia runs it against production after the merge, dry run first.

### Seeds

- **Showcase** (`scripts/showcase/`): stop writing `values.<autoNumberCol>`. Production assigns the numbers through the trigger. Just make sure the script doesn't write `seq` or `boardSeq` itself in production mode.
- **Visual seed** (`tests/visual/src/seed.ts`): the visual run probably has no Functions emulator, so write `seq` and `boardSeq` directly with the admin client to get deterministic numbers.
- **Visual baselines:** screens that show Item ID or Auto number change. The lead refreshes them with the baseline workflow.

### Docs

- `docs/architecture.md`:
  - 5.5: the new fields, plus a sentence on the counters;
  - 6.2: `item_id` and `auto_number` are derived from server-assigned fields;
  - 8: the new trigger.
- The lead logs the decision on the Decisions board.

## Out of scope

- monday's "custom key" UI beyond the existing prefix setting.
- Renumbering, and per-group numbering.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build`, all green. Showcase coverage test unchanged.
