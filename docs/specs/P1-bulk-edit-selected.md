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

---

# v2 (2026-11-07): range selection and a seamless bulk edit

Owner feedback on #141 (bug inbox, 2026-11-07): "The user ought to be able to select one item and then, using shift + click, select a second item, and have the app select all items in between" and "the implementation of a single bulk edit should be significantly more seamless and good looking". Reference: two screen recordings (monday and Atrium) in the owner's local reference folder, which is not committed. The lead extracted frames and measured both; the findings below replace the "Apply to N" popup design of v1. Branch `claude/bulk-edit-v2`.

## What monday does (observed in the recording)

1. **Range select:** click the first row's checkbox, then **shift+click** another row's checkbox. Every row between the two, inclusive, is selected. The control is the checkbox. (The recording shows a range inside one group; across groups follows the same display order, see below.)
2. **Bulk edit:** with two or more rows selected, edit a cell on **any selected row**. The change is applied to **all selected rows immediately**. There is **no confirmation popup** and no "only this item" choice.
3. **Feedback:** a green toast, top centre: first "Updating 7 selected items" with a small spinner and an X (about half a second), then "We successfully updated 7 items" with a bordered **Undo** button and an X (a couple of seconds, then it dismisses on its own). Cells change at once (optimistic). The selection and the bar stay.
4. **Look:** selected rows tinted light blue, row checkboxes filled blue; the batch bar is a floating white pill at the bottom centre (blue count circle, "Item selected" / "Items selected", Duplicate, Export, Archive, Delete, Convert (disabled), Move to, Apps, X).

## What Atrium does today and the gaps

- No shift or range handling anywhere in the table (`shiftKey` is not used). Each checkbox click toggles one row.
- After editing a cell on a selected row, a popover "Apply to N selected items" / "Only this item" appears and the other rows wait for the choice. This is the main thing the owner finds clunky.
- The result toast says "Updated 6 items." with Undo; there is no in-progress toast.
- The batch bar is smaller and has fewer actions (no Export, Convert, Apps). Those are out of scope except where listed below.

## Decisions (lead's; the owner can change them)

1. **Immediate apply.** Editing a cell in a selected row, with two or more rows selected, applies to all selected rows of the same level straight away, as monday does. **Remove the popup** (`BulkEditPopup.tsx`, `bulkOffer` in `table-store.ts`, the offer flow in `TableCell.tsx`). The edited row is written as part of the same batch (no separate first write). To edit only one row, the user deselects the others first (same as monday). Single-row selection and no selection behave exactly as before.
2. **Optimistic and fast.** All affected cells update on screen at once through the existing optimistic patches; the writes go out as one chunked batch (`itemWrites.setValueMany`, at most 400 per commit). Rows the user may not edit, locked columns and writes that would break a required column are skipped and counted (unchanged from v1; reuse `planBulkApply`).
3. **Toast sequence.** Show an "Updating N selected items" toast with a spinner while the write is in flight, only if it takes longer than about 300 ms (so a fast write goes straight to the result); then "Updated N items" plus **Undo** (and "; M skipped (locked or required)" when needed). Wording: use plain "Updated N items" (not monday's "We successfully..."); the app's toast style and tokens, not new colours. A failure shows the existing error toast and restores the previous values on screen. One Undo restores every row's previous value as a single batch (as v1).
4. **Range select (new).**
   - `table-store.ts`: add `anchorId: string | null` (the last row toggled by a plain click) and an action `selectRange(orderedIds, toId)`. `reset` and `clearSelection` clear the anchor.
   - Plain click on a row's checkbox: toggle it and set it as the anchor. **Shift+click**: select every row from the anchor to the clicked row, inclusive, **adding** to the current selection (never deselecting); the anchor stays. If there is no anchor (or it is no longer visible), shift+click behaves like a plain click and sets the anchor. Ctrl/Cmd+click is a plain toggle (no special range behaviour).
   - `TableCheckbox.tsx` must pass the click's modifier state to `onChange` (today it swallows the event: `event.stopPropagation()` then `onChange(!checked)`). Prevent the browser's text selection on shift+click (`userSelect: none` via a token-free CSS rule is fine, or `preventDefault` on `mousedown` when shift is held).
   - **Display order:** a range follows the order of the rows on screen: groups in order, rows after search, filter and sort, **skipping rows in collapsed groups**; subitems are only ranged with their siblings under the same parent (level-bound, like `bulkPeers`). Extract the visible-order logic that the keyboard navigation already has (`BoardTable.tsx`, the arrows block around lines 491-498: non-collapsed groups, `m.items` per group; subitems by `comparePositions`) into a pure helper in `table-model.ts` and use it for both. A range never crosses levels: if the anchor is a top-level row and the clicked row is a subitem (or the reverse), treat it as a plain click.
   - Group header "select all" keeps working and does not move the anchor.
5. **Selected-row look.** Match monday's tint if it differs from the current `rowSelected` style, using existing tokens (no new literals). Do not redesign the BatchBar in this PR; list in the PR description which monday bar actions we don't have (Export, Convert, Apps) as follow-ups.
6. **Keyboard.** Shift+Space or other keyboard range selection is out of scope.

## Code pointers (from the 2026-11-07 survey)

- Selection: `apps/web/src/components/board-table/table-store.ts` (`selected` at line ~22; `setSelected`, `toggleSelected`, `setGroupSelected`, `clearSelection`, `reset`), `TableCheckbox.tsx`, `ItemRow.tsx` (`ItemRowBody` around lines 278-283, used by top-level rows and `SubitemRow`), `HeaderRow.tsx` (group select-all), `GroupBlock.tsx`, `SubitemBlock.tsx`.
- Order: `table-model.ts` (`buildGroupModels`, `GroupModel.items`, `subitemsByParent`), `BoardTable.tsx` (`getModels()` through the table env, keyboard order block). Virtualized groups (over 50 rows) still hold the full `items` array, so range selection works on the data, not the rendered rows.
- Bulk edit: `bulk-edit.ts` (`planBulkApply`, `bulkPeers`, `bulkSummary`, `isBulkEditableType`), `TableCell.tsx` (the commit hook around lines 87-108), `table-actions.ts` (`setCell`, `applyToSelected`), `apps/web/src/data/item-writes.ts` (`setValueMany`), `components/toast-store.ts` (`showToast`; check whether it supports a spinner or updating an existing toast; extend it minimally if not).
- Tokens and styles: `table.module.css` (`.rowSelected`, `.batch*`), `theme/table-tokens.css`.

## Tests

- Pure helper: visible-order list (several groups, a collapsed group skipped, filtered and sorted rows, subitems per parent) and range computation (forward, backward, anchor missing or not visible, cross-level treated as plain, additive, anchor kept).
- Store: `selectRange` adds, never removes; anchor set by plain toggle; cleared by `reset` and `clearSelection`.
- Component: shift+click selects the rows between; plain click moves the anchor; collapsed groups are skipped; with 3 rows selected, changing a status on one writes all 3 in one batch with no popup, shows "Updated 3 items" with Undo, and Undo restores; locked, required-breaking and non-editable rows are skipped and counted; with a single selected row or none, no bulk behaviour (single write); a derived column never bulk applies.
- Update `bulk-edit.test.tsx` (the popup tests go away or become "applies immediately" tests), `BoardTable.test.tsx` lines ~137-187.
- Visual: the `board-batch-bar` screenshots may change slightly (selected-row tint); if so run the baselines workflow, never hand-edit PNGs.

## Known limit

Writes go out in chunks of 400 rows (Firestore's batch limit), so a bulk edit over more than 400 rows is not atomic. If a later chunk fails after an earlier one was committed, the toast says "Updated N items; M could not be saved" and its Undo restores only the rows already written.

## Owner check (add to `docs/plans/owner-check-list.md` in the PR)

On a scratch board (not your real boards): tick one row, shift+click another several rows below it: everything in between is selected, including across a group boundary and skipping a collapsed group. With 3+ selected, change a Status on one of them: all selected rows change at once, with no popup, a toast with Undo, and Undo puts every value back. Deselect down to one row: editing it changes only that row. Try it in light and dark and compare with the monday recording.
