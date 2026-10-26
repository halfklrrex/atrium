# P2: Column locks (security-enforced column permissions)

Author: Ophelia (Opus 5.5) · Implementer: Ava (Antigravity) · Roadmap: P2 "Column locks (security-enforced column permissions)" (3307068576) · Branch `ag/column-locks`

## Goal

monday lets a board owner **restrict column editing**: the column stays visible to everyone, but only some people can change its values. We ship the first version: **a board owner can lock a column so only board owners can edit its values.** It is enforced by Firestore rules and by the Cloud Functions, not just hidden in the UI.

Out of scope (later, not in this PR):

- per-person allow lists ("only Anna and Ben can edit");
- "restrict column viewing";
- protecting the column's definition (title, settings, deletion). See "Known limitation".

## Background (facts from the code at `689fb4a`)

- **Item gates:** item create, update and delete need `canEditBoard`, which means a board owner or editor (`firestore.rules:387-390`).
- **Blocked columns:** the only per-column rule is `blockedColumnIds()` = `derivedColumnIds` + `serverManagedColumnIds` (`:351-354`).
  - `validItemUpdate` refuses a values map diff that touches them (`:380-381`).
  - Create refuses values keys that touch them (`:366`).
- **Board key lists:**
  - `validBoardCreate` (`:224-255`) has a fixed key list.
  - `validBoardUpdate` (`:262-288`) has an allowed-keys list (`:266-268`) and an owner-only subset (`:269-270`).
  - A new board field is rejected until it's added to both.
- **Client-side checks:**
  - `validateCellWrite` (`apps/web/src/components/board-table/derived.ts:61-75`) is the single client gate, called from `tableActions.setCell`.
  - `isClientReadOnlyType` (`:53`) makes cells read-only.
  - `withoutUnwritableValues` (`:82`) strips unwritable values when items are duplicated.
- **Server role checks:** `functions/src/lib/column-actions.ts` (`clickButton`, `startTimeTracking`, `stopTimeTracking`) and the file callables check `canEditBoard` before writing.
- **Shared helpers:** roles are in `packages/shared/src/roles.ts` (`resolveBoardRole`, `canManageBoard` = board owner). Column validation helpers are in `packages/shared/src/columns/column-validation.ts`.

## Data model

- **The field:** `boards.columnLocks: string[]`, the ids of locked columns. It's an array of `slugId`, max 200, unique.
  - Add it to `boardSchema` (`packages/shared/src/schemas/board.ts`) as `.default([])`.
  - It covers `columns` and `subitemColumns` alike.
- **Who can change it:** only board owners, enforced by the rules.
- **Older boards:** boards created before this have no field. Every reader treats a missing field as `[]`: rules use `board.get('columnLocks', [])`, and code uses the zod default.
- **Stale ids:** an id with no matching column is harmless and ignored.
  - When an **owner** deletes a column, the UI also removes it from `columnLocks` in the same transaction.
  - Don't add a Function for this.

## Rules (`firestore.rules`, a hot-spot file, so keep the diff small)

1. **Helper:** `lockedColumnIds(board) = board.get('columnLocks', [])`.
2. **Item create:** if `!canManageBoard(board)`, require `!d.values.keys().hasAny(lockedColumnIds(board))`.
3. **Item update:** if `!canManageBoard(board)`, require `!values.diff(...).affectedKeys().hasAny(lockedColumnIds(board))`.
   - Put it next to the existing `blockedColumnIds()` check and reuse the `boardData()` read. Don't add a second `get()`; the board doc is already read once.
4. **Item delete:** unchanged. An editor can still delete an item that has locked values (monday works the same way).
5. **Board create:** add `columnLocks` to the allowed keys and require `columnLocks == []` when present. It stays optional, so old clients still work.
6. **Board update:** add `columnLocks` to the allowed keys and to the **owner-only** subset. It must be a list.

## Functions

- **Shared helpers:** in `packages/shared` (for example `columns/column-locks.ts`), add `isColumnLocked(board, columnId)` and `canEditColumn(boardRole, board, columnId)`. The second returns true when the column isn't locked, or when the role is `owner`. Export them and unit-test them.
- **Callables:** `clickButton`, `startTimeTracking`, `stopTimeTracking`, `requestFileUpload`, `finalizeFileUpload` and `deleteFileAttachment` must refuse with `permission-denied` ("This column is locked. Only board owners can edit it.") when the column is locked and the caller isn't a board owner.
  - `getFileDownloadUrl` stays allowed: reading isn't editing.
  - Put the check in the shared role-check path these callables already use; don't copy it into each one.

## Web

- **Header menu:** in the column header menu (`components/board-table/HeaderRow.tsx`), board owners get **"Restrict column editing"**, a toggle. Locked columns show a small lock icon (Vibe `Locked`) after the title, for everyone, with the tooltip "Only board owners can edit this column".
  - The toggle writes `columnLocks` with `arrayUnion` or `arrayRemove` through a new `boardWrites` or `tableActions` helper. Follow how `updateColumn` writes the board.
- **Read-only cells:** for non-owners, a locked column's cells behave like `isClientReadOnlyType`. Touch every place that respects that today:
  - `TableCell.tsx` `canEdit` (`:53-55`);
  - the keyboard path in `BoardTable.tsx` (`:376-432`: Enter, F2, Delete);
  - batch actions;
  - the item card, if it edits cells.
  - Hovering shows the tooltip above. No editor opens.
- **`validateCellWrite`:** pass the caller's board role and the board. It refuses locked columns for non-owners with the same message, so a stray write path still gets a toast instead of a rules error.
  - The vote path from #45 must go through it too (see follow-up item 3308619604).
- **Duplicating items:** `withoutUnwritableValues` also strips locked columns when the caller isn't an owner. The duplicate keeps the rest; rules would refuse the whole write otherwise.
- **Defaults:** if column defaults get wired later, skip locked columns for non-owners. Note this in a comment where `applyDefaultColumnValues` would be called. Nothing calls it today.
- **Showcase:** lock one column on the showcase board (for example the budget Numbers column) in `scripts/showcase/data.mjs`, so the owner can see the lock icon.

## Tests

- **Rules emulator** (`tests/rules/src/column-locks.test.ts`):
  - An editor can't change a locked value, either with a field-path update or a whole `values` map write.
  - An editor can't create an item with a locked value.
  - An editor can still edit unlocked columns and delete items.
  - An owner can edit locked values.
  - An editor can't change `columnLocks`; an owner can.
  - A board with no `columnLocks` field behaves as unlocked.
  - Board create with a non-empty `columnLocks` is refused.
  - Locks on a `subitemColumns` id are enforced the same way.
- **Functions unit tests:** each listed callable refuses an editor on a locked column and allows an owner.
- **Web unit tests:**
  - the lock toggle is visible only to owners;
  - locked cells don't open an editor for an editor;
  - `validateCellWrite` refuses;
  - duplicating strips the locked values.

## Known limitation (log on the Decisions board when merged)

An editor can still rename, reconfigure or **delete** a locked column's definition, because `boards.columns` is a list and Firestore rules can't check individual list entries cheaply. Deleting it doesn't change stored values, and the board history and undo can restore it. A full fix means moving column definitions to a sub-collection or adding server-side column edits. That's a later decision, not this PR.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` pass.
- Visual QA: screenshots of the header lock icon, the owner's menu toggle and the read-only tooltip, in light and dark.
- Mention in the PR that `firestore.rules`, `tests/rules/**` and `packages/shared/**` are touched, so nothing else in flight should change them at the same time.
