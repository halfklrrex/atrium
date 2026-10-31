# P2: Change a column's type

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: P2 "Change a column's type" (3309194280) · Branch `claude/change-column-type`

## Why

Owner request (2026-10-26). monday lets you change a column's type from the column header menu ("Change column type ›") and converts the existing values where it can. We have no way to do it.

## Behaviour

- **Menu:** the column header menu gets **"Change column type ›"**, a submenu listing the types from `ADD_COLUMN_ORDER` with their icons and tones.
  - Types the column can't sensibly become are still listed, with a warning ("Values will be cleared").
  - Only board owners and editors see it, as with other column edits. Locked columns: owners only.
- **Confirmation dialog:** "Change _Budget_ from Numbers to Text? 42 values will be converted and 3 can't be converted and will be cleared." Below it, a preview of 3 sample conversions, then Cancel / Change.
- **After the change:**
  - The header shows the new type immediately, and the cells show the converted values once the migration finishes, with a progress toast for large boards.
  - The toast has an **Undo**, available for 30 minutes and in the column menu while the snapshot exists.

## Conversion (pure functions in `packages/shared/src/columns/convert.ts`)

- **Main function:** `convertValue(from: ColumnDef, toType, toSettings, value) => {ok: true, value} | {ok: false}`.
  - Default path: `columnRegistry.toText(from.type, value, from.settings)`, then parse the text with the target type's text parser where one exists.
  - Specific pairs:
    - **status ↔ dropdown ↔ text:** map by label text. For status and dropdown targets, **create missing labels** in `toSettings`; the label colours come from the palette in order.
    - **numbers ↔ text:** parse with the numbers parser (handles a unit or currency suffix).
    - **date ↔ text:** an ISO date or a parseable date. **date → timeline:** `{from: d, to: d}`. **timeline → date:** `from`.
    - **checkbox ↔ text:** "true", "yes", "✓" and "1" are checked.
    - **people ↔ anything else:** not convertible (cleared), except people → text, which uses names where they're known; otherwise cleared.
    - **email, phone, link ↔ text:** use the text.
    - **tags → dropdown, and dropdown → tags:** map by label.
- **Targets that store nothing or are written only by the server:**
  - a **derived** target (progress, formula, etc.) stores nothing, so every value is dropped;
  - a **server-managed** target (files, button, time_tracking) is refused as a target for now (it isn't listed), because those values can only come from Functions;
  - a server-managed or derived **source** can be converted to text only, as a snapshot of the display text, and only for owners.
- Unit-test every pair in the table above, plus the "can't convert" cases.

## Migration (server-side, so it's consistent and can be undone)

- **Callable `changeColumnType {boardId, columnId, scope: 'columns'|'subitemColumns', toType, toSettings}`**, for owners and editors (owners only when the column is locked). It runs in this order:
  1. **Validate** the target type's settings with the registry.
  2. **Snapshot:** write the old column def and every item's old value to `boards/{id}/columnSnapshots/{snapshotId}/chunks/{n}`, at most 400 values per chunk. The snapshot has an `expiresAt` 30 days out and is cleaned up by the existing scheduled purge (extend it).
  3. **Mark the column busy:** in a transaction, set `migrating: {snapshotId, startedAt}` on the column def in the board doc. The web shows those cells as read-only with a spinner.
  4. **Convert:** batch-update the items in chunks of 400 with field-path writes: `values.<id>` becomes the converted value or `deleteField()`.
  5. **Finish:** in a transaction, set the column's `type` and `settings` and clear `migrating`. `onBoardColumnsWritten` then re-syncs the derived and server-managed id lists.
  6. Return `{converted, cleared, snapshotId}`.
- **Callable `revertColumnType {boardId, snapshotId}`** does the same in reverse, from the snapshot.
- **Idempotency:** a retried call with the same `snapshotId` resumes rather than duplicating.
- **Rules:**
  - `columnSnapshots` is read and written by Functions only.
  - The board's `columns[].migrating` is server-only. Rules can't inspect list entries, so the web must not write it: strip it in `updateBoardStructure`, and the callable is the only writer.
  - Document that client edits made during a migration could race. The migration takes seconds for normal boards; acceptable for v1.

## Web

- The header menu submenu and the confirmation dialog: Vibe `Menu`, `MenuItem` with a submenu, and `Modal`.
- **Preview counts** are computed client-side with the same shared `convertValue` over the loaded items.
- **Cells:** a column with `migrating` shows its cells as read-only with a small spinner.
- **Undo:**
  - the toast's Undo calls `revertColumnType`;
  - "Undo type change" shows in the column menu while the snapshot exists.

## Tests and QA

- **Shared:** unit tests for `convertValue`.
- **Functions:** emulator tests for both callables: permissions, chunking (more than 400 items), resume, revert, and the derived and server-managed refusals.
- **Rules:** tests for `columnSnapshots`.
- **Web:** unit tests for the dialog counts and the read-only state.
- **Visual QA** of the submenu and dialog, in light and dark.

## Implementation notes and clarifications (owner decisions and what the build settled)

- **Stuck migrations.** If a run dies after step 3, the column stays `migrating`.
  - A `changeColumnType` call with the same `snapshotId` (a retry) resumes straight away.
  - Any other call on a column whose `migrating.startedAt` is **10 minutes or older** may take it over: it resumes from the same snapshot (the snapshot's recorded target wins over the request) and never creates a second one. `revertColumnType` can take over the same way and restores everything from the snapshot.
  - A fresh `migrating` (under 10 minutes) from a different snapshot is refused with `failed-precondition`.
  - A `changeColumnType` call on a column whose undo is interrupted is refused: run the undo again to finish it.
  - The web shows **Resume type change** and **Undo type change** in the column menu only for a stale mark.
- **Locks.** A locked column can be changed (and its change undone) only by board owners, through the same `canEditColumn` check the other column callables use. The item-name column has no column menu entry for this. No dependency check exists for "delete column" either, so a dependent column is **warned about, not refused**: the confirm dialog lists formulas, progress, mirror and dependency columns and views (kanban, calendar, timeline, group-by) that read the column (`findColumnDependents` in `packages/shared/src/columns/convert.ts`).
- **No data loss without a snapshot.** Nothing is deleted or overwritten before the snapshot is complete and verified: the chunks are read back and counted against the count on the snapshot document (`valueCount`, `chunkCount`) before the snapshot becomes `ready`, and a mismatch aborts with `data-loss` and changes nothing. Resume and revert re-verify the same counts. A chunk also stays under 600,000 serialised characters (a Firestore document is 1 MiB), so a snapshot can use more chunks than `values / 400`.
- **Snapshot document** `boards/{id}/columnSnapshots/{snapshotId}`: `columnId`, `scope`, `fromColumn` (the old def), `toType`, `toSettings` (requested), `status` (`writing`, `ready`, `applied`, `reverted`), `valueCount`, `chunkCount`, `createdBy`, `createdAt`, `expiresAt` (epoch milliseconds, 30 days), plus `appliedAt` / `revertedAt`. Chunks are `chunks/{000000...}` with `{index, entries: [{itemId, value}]}`. Only items that have a value are in it.
- **Column def fields (shared schema, both server-only).**
  - `migrating: {snapshotId, startedAt, kind: 'change' | 'revert'}` while a run is in progress.
  - `lastTypeChange: {snapshotId, fromType, expiresAt}` after a finished change, so the column menu can offer "Undo type change" without reading the snapshot (clients cannot read it). Revert clears it. Only the latest change of a column can be undone.
- **Rules.** `columnSnapshots` and its chunks: `allow read, write: if false`, with rules tests and an emulator end-to-end test. Rules cannot look inside `columns[]` entries, so `migrating` and `lastTypeChange` **cannot be protected by rules**: the web strips them from every structure write (`keepServerColumnFields` in `updateBoardStructure`, and `duplicateBoard`), and the callables are the only writers. A client that forged them could only block or mislead its own board: revert verifies the snapshot, and a stale mark can be taken over after 10 minutes. `onBoardColumnsWritten` is unchanged: it recomputes from the column types alone, so a `migrating` or `lastTypeChange`-only write never rewrites the derived lists (tested); the finish step changes the type, which re-syncs them.
- **Request shape.** `changeColumnType` also accepts an optional client-chosen `snapshotId`; the web sends one per confirmation, so a retry after a lost response resumes instead of duplicating. The result has `{converted, cleared, snapshotId, toType}`. `revertColumnType` returns `{restored, removed, snapshotId, columnId}`: `removed` counts values typed after the change that have no old value to restore.
- **Sources and targets.** Derived sources store nothing, so their snapshot holds the definition only (zero values) and the display text is computed from the live items; a derived or server-managed source can become `text` only, and only for owners. Server-managed targets are not offered and the server refuses them. A derived target drops every value. People convert to text only through the display names of workspace members (never ids); id-only types (dependency, connect boards) convert to nothing. The column's `defaultValue` is converted with the values, or dropped when it cannot be converted.
- **Counts.** The server converts every item in the column's scope in any state (active, archived, deleted); the dialog preview counts the items the table has loaded, so a board with archived items can show a slightly smaller number.
- **Timing.** The callables run up to 9 minutes (`timeoutSeconds: 540`) and the web waits as long. Client edits made during a migration can race with it: a value written after the snapshot is not part of it and is left as it is (the web shows an invalid value as empty). Acceptable for v1.
- **Purge.** The daily `purgeTrash` job also deletes snapshots whose `expiresAt` has passed (`purgeExpiredColumnSnapshots`); `firestore.indexes.json` has a collection-group field override for `columnSnapshots.expiresAt`.
