# Reorder labels in the label editors

Owner request (bug inbox, 2026-11-14): labels (Status, Priority, Dropdown) can be moved around, e.g. a new label can be set to be the third of seven.

## Behaviour

- In `StatusLabelEditor` and `DropdownLabelEditor` (`apps/web/src/columns/LabelEditors.tsx`) every label row gets a drag handle (pointer drag, with a keyboard alternative: focus the handle, ArrowUp/ArrowDown moves the row; announce the move via aria-live). Move-up/move-down buttons are acceptable as the keyboard path if drag is heavy.
- A newly added label can be moved straight away, before Apply.
- On Apply, the order shown is the saved order: renumber `index` 0..n-1 in list order. Status's blank grey "no status" label stays fixed (kept out of the list, as today) and keeps sorting first in pickers via `orderStatusLabels`; give it an index after the named ones as today so ids and values are untouched. Cell values reference label ids, so reordering must never change a label id.
- Every place that lists labels (picker, column settings, filters, group-by, kanban columns) must follow `index` order. Audit for any that sort differently or by label text and fix.

## Rules

- Tokens only for styling (no hex or px), no layout animation, respect reduced motion.
- No schema or rules change expected (`index` already exists). If one is needed, stop and say so.
- Tests: unit test for the reorder/renumber helper, component test for keyboard move and for Apply saving the new order, for both editors.
- Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
