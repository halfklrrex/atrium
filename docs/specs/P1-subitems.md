# P1: Subitems

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: P1 "Subitems" (3309015663) · Branch `claude/p1-subitems` · Worktree `ATRIUM_PORT_OFFSET=20`

## Goal

Like monday, an item can have **subitems**: a nested mini-table under the item's row, with its own column set (`board.subitemColumns`). This is the last P1 gap. Timeline, Kanban and Gantt build on it later.

## Data model (already reserved; facts at `689fb4a`)

- **Where subitems live:** in the same `boards/{boardId}/items` collection, with `parentItemId` set to the parent's id (`docs/architecture.md:107-115`, `packages/shared/src/schemas/item.ts:13-27`). `useItems` already streams them, because it listens to all active items.
- **Columns:** subitems use `board.subitemColumns` (`schemas/board.ts:63`). It's `[]` on every board today. `derivedColumnIds` and `serverManagedColumnIds` already include subitem columns (`derived-ids.ts`).
- **Table today:** `table-model.ts:192,210` skips any item with a parent.
- **Rules:** `parentItemId` may be `null` or a string on create (`firestore.rules:364`) and may change on update. Nothing checks the parent.
- **Rules for v1:**
  - One level only. A subitem can't have subitems.
  - A subitem's `groupId` always equals its parent's.
  - Its `position` orders it among its siblings.
  - Its `values` keys are `subitemColumns` ids.

## Rules (`firestore.rules`, hot-spot: keep it minimal)

- **Item create** with a non-null `parentItemId`:
  - the parent exists, using one `get` of `items/{parentItemId}` in the same board;
  - the parent's `parentItemId == null`;
  - the parent's `state == 'active'`;
  - `d.groupId == parent.groupId`.
- **Item update:** `parentItemId` becomes **immutable**. Remove it from the changed-keys allow list, or require it to be unchanged. Converting between item and subitem isn't in v1.
- **Tests:** add rules tests in `tests/rules/src/subitems.test.ts`:
  - create a valid subitem;
  - refuse a missing parent, a parent in another board, a grandchild, a mismatched groupId, and a change of `parentItemId`;
  - check that derived and server-managed subitem columns are still blocked.
- Ava's column-locks PR will touch the same rules block tomorrow. This PR lands first, and she rebases.

## Shared (`packages/shared`)

- **Default columns:** `defaultSubitemColumns()` returns monday's defaults: Owner (people), Status (with the default labels) and Date. Ids come from the existing slug-id generator.
- **Helpers:** `isSubitem(item)`, and `subitemsByParent(items)`, which returns a `Map<parentId, Item[]>` sorted by position.

## Web

- **Group models:** `buildGroupModels` keeps top-level rows as today, and exposes `subitemsByParent`. Only the parent rows are filtered, sorted and searched in v1. A parent whose subitem names match the search also counts as a match, and it auto-expands while the search is active.
- **Expand state:** `expanded: Set<itemId>` in `table-store.ts`, per board. Keep it in memory only; no persistence needed.
- **Parent row:**
  - Left of the name, an expand arrow that is visible on hover and always visible when the item has subitems.
  - After the name, a small subitem-count badge, like monday: a subitem icon plus a number.
  - The row menu gets "Add subitem".
- **Expanded block**, rendered under the parent row and indented to start at the name column:
  - a subitem header row for the `subitemColumns`, with its own "+" add-column, rename and delete (reuse `HeaderRow` with a `scope: 'subitems'` prop that writes `subitemColumns` through the same transaction path as `columns`);
  - one row per subitem, reusing `ItemRowBody` and `TableCell` with the subitem column defs and a thinner left bar in the group colour;
  - "+ Add subitem".
  - Style it from monday's look: a lighter header, a vertical connector line on the left, compact rows. Use tokens only, adding named tokens to `tokens.css` in their own `/* Subitems */` block.
  - There is no measured monday reference for subitems yet. List any guesses in the PR, and the owner will compare.
- **First subitem:**
  - When the board's `subitemColumns` is empty, write `defaultSubitemColumns()` in a board transaction before creating the subitem.
  - New subitems get `groupId` = the parent's, a `position` after the last sibling, and `parentItemId`. Extend `itemWrites.create` and `NewItemInput` with an optional `parentItemId`.
- **Cells:**
  - `setCell` and `validateCellWrite` must use the **subitem** column defs for subitems. Today they take `ctx.columns`, which are the board columns. Pass the right list per row.
  - The keyboard navigation in `BoardTable.tsx` must not jump between a parent row and subitem cells in a confusing way. Keep it simple: arrows move within the block they're in.
- **Virtualisation:** `VirtualRows` (`GroupBlock.tsx:252-316`) assumes fixed 36px rows. An expanded parent makes that row taller, so switch it to dynamic measurement with `measureElement`, keyed by item id, keeping `translateY`.
  - Non-virtualised groups (≤50 items) render normally.
  - Test a 1000-item board through the dev "seed-1000" action with a few rows expanded.
- **Drag and drop:**
  - Subitems reorder within their parent only. Use a nested `SortableContext` per expanded block; refuse drops outside it.
  - Dragging a parent moves its subitems along: their `groupId` follows in the same batch (`itemWrites.move` becomes a batch when the item has subitems).
- **Cascade** (all in the same batch as the parent, so undo restores everything):
  - archive or delete (`tableActions.retireItems`), and Undo;
  - `deleteGroup`;
  - `moveItemsToGroup`;
  - duplicate: subitems are duplicated with the new parent id, through `withoutUnwritableValues`.
  - Purge needs no change: subitems are deleted with the same `deletedAt`, so `purgeTrash` takes them in the same run.
- **Summary row and footers:** exclude subitems.
- **Item card:** no subitem section in v1. Add a TODO comment where it would go.
- **Showcase:** give 3 or 4 showcase items 2 or 3 subitems each, with Owner, Status and Date values, and set `subitemColumns` on the showcase board (`scripts/showcase/data.mjs`). Extend the seed's allow-list if needed.

## Out of scope

Filters and sort on subitem columns, subitems in the item card, converting items to subitems, multi-level subitems, and subitem columns in group-by.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` pass.
- **Unit tests:**
  - group model (subitems hidden at top level, search matching through subitems);
  - cascade actions;
  - default subitem columns;
  - `setCell` using the subitem defs.
- **Visual QA in the dev server (offset 20):**
  - a board with expanded and collapsed parents, in light and dark;
  - the 1000-item board scrolling smoothly with expanded rows;
  - archive and undo of a parent with subitems;
  - adding a subitem column.
  - Sign in with email and password through the SDK.
- **Visual baselines:** update them through the workflow if the board screens change. They should only change if the expand arrow shows on rows without subitems, which it must not when not hovered.

## Constraints

- Don't touch the item card or the updates components. The VF5 task (`claude/vf5-item-card`) owns them.
- `tokens.css`: add only your `/* Subitems */` block.
- Don't open the PR. Commit, push and report back.
