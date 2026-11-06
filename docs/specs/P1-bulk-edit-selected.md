# P1 Bulk edit: apply a cell change to all selected rows

Roadmap item: "Feature: bulk edit a cell across all selected rows (monday-style)". Branch `claude/bulk-edit`. Requested by the owner in the bug inbox (2026-11-06). Decisions below are the lead's; the owner can change them.

## Behaviour

- The table already has multi-select and a floating `BatchBar` (duplicate, move, archive, delete). Missing: changing a value for all selected rows at once.
- **Apply to selected:** when two or more rows are selected and the user edits a cell **in one of the selected rows**, a small popup docked under the cell offers **"Apply to N selected items"** (primary) and "Only this item" (the default if dismissed). Accepting writes the same value to the same column on every selected top-level item (and subitems only if the selected rows are subitems of the same subitem column set; do not mix levels: apply only to selected rows of the same level as the edited row).
- The edited row is written first (as today); the popup appears after that write, so a dismissed popup leaves a normal single edit. Accepting then writes the remaining rows.
- **Which columns:** every editable, non-derived, non-server-managed column type whose value shape is the same across rows (status, dropdown, people, date, timeline, numbers, text, long text, checkbox, rating, tags, link, email, phone, country, location, hour, color picker). A status/dropdown value is carried by label **index/id**; it is the same column so the label set is identical. Not offered for `files`, `button`, `time_tracking`, `auto_number`, `item_id`, formula, mirror, dependency, connect boards (the popup does not show).
- **Skips, with a summary toast:** rows where the column is locked for the user (column locks), rows that would break the **required-column** rule (emptying a required cell), rows the user can't edit. The toast says "Updated 7 of 9 items; 2 skipped (locked or required)". Never silently drop rows.
- **Undo:** one undo entry for the whole batch (reuse the existing undo stack and how `tableActions` batches multi-item actions), restoring each row's previous value.
- **Keyboard:** Enter on the popup's primary button applies; Escape dismisses.
- Selection stays after applying (monday keeps it); the BatchBar is unchanged.

## Code pointers

- `apps/web/src/components/board-table/BatchBar.tsx`, `table-actions.ts` (batch actions, undo), `table-store.ts` (`selected`), `TableCell.tsx` / `ItemRow.tsx` (where a cell write is committed), `required-write.ts` (required rule), `column-locks` helpers in `@atrium/shared`.
- Writes use field paths (`values.<colId>`) per AGENTS.md, in a **single Firestore batch** of at most 400 items per commit (chunk beyond that), through the existing item-write helper in `apps/web/src/data/item-writes.ts`. No rules change: each write is an ordinary cell edit that rules already check per item.
- Style with tokens only; use a Vibe popup/dialog consistent with the other table popups (`AnchoredPopup`).

## Tests

- Unit: the apply planner (pure): given selected rows, the edited row and column, returns writes and skips (locked, required-empty, wrong level, derived column); status index carried; undo payload.
- Component: select 3 rows, edit status on one, popup shows "Apply to 3 selected items", accept → 3 writes and one undo entry; "Only this item" and Escape → no extra writes; popup absent with a single selected row and for a derived column.
- Checks: `pnpm lint`, `pnpm -r --workspace-concurrency=1 typecheck`, `LC_ALL=en_US.UTF-8 pnpm test`, `pnpm build` (+ `pnpm test:rules` only if rules are touched; they should not be).
- Showcase: no data change needed.

## Out of scope

Bulk edit from the BatchBar for several columns at once, and a "Convert/Update selected" dialog. Log as a follow-up if the owner wants it.
