# REQ: Required columns as a hard rule

Author: Ophelia · Implementers: Sonnet 5.5 (medium effort) · Status: **approved. The owner chose "hard rule" on 2026-11-05 and confirmed the defaults below on 2026-11-06. REQ-1 in progress.**

## Today

`required: true` on a column (`packages/shared/src/schemas/board.ts`) is a UI hint: the table shows a "Required" marker and the item card counts empty required fields. `validateRequiredColumns` exists in `packages/shared/src/columns/column-validation.ts` and the form submission path (`packages/shared/src/forms.ts`) already refuses empty required answers. Nothing stops a normal cell write from leaving a required cell empty.

## Goal

The server refuses writes that break the required rule, so no client (web, MCP connector, a future API) can bypass it. Never loosen the rules to make this work.

## Proposed rule (defaults; the owner can change them)

1. **Clearing:** a write that sets a required column's cell to empty (field deleted, `null`, `''`, an empty list, or the column type's own empty value) is refused.
2. **Reaching a done state:** a write that sets a Status column to a label marked done is refused while any other required cell on that item is empty. This is the monday-style "required before Done" behaviour.
3. **Creating an item is exempt.** An item is created with only a name, then filled in. Blocking creation would make every quick add fail.
4. **Existing data is never rewritten.** Turning Required on for a column does not touch items that are already empty; they just can't be saved into a worse state, and the table and item card keep showing the hint for them.
5. **Server-side writers follow the rule too** (button actions, automations, forms, the MCP connector): a refused write fails that action with a clear message and changes nothing, as button actions already do for bad values.

## Design

- **Which columns are required:** a server-maintained `boards.requiredColumnIds` array, written only by the `onBoardColumnsWritten` Function (same pattern as `derivedColumnIds` and `serverManagedColumnIds`). Clients create boards with `[]`, and the rules refuse client writes to it. Rules can then check `affectedKeys` against it without reading the columns array.
- **Rule 1 in `firestore.rules`:** for an item update whose `affectedKeys` include `values.<id>` with `<id>` in `requiredColumnIds`, the new value must not be empty. "Empty" is checked in rules only for the generic cases (missing, `null`, `''`, empty list or map); a column type with its own idea of empty (for example a status with no label) is checked in the Functions path instead. **Open technical point:** Firestore rules can't iterate, so a multi-column write is checked with a bounded helper (the cell-write path writes one or a few `values.<id>` keys at once). **Decided in REQ-1:** the cap is 10 required columns (`REQUIRED_COLUMN_RULE_CAP` in `@atrium/shared`). A first try with 20 exceeded the 1000-expression limit when all 20 cells were written at once, so 10 is what a rules test proves with all 10 cells in one write. A client write touching an 11th or later required column is refused (fail closed), so a board should keep its required columns to 10 or fewer; REQ-3 should warn when someone turns on an 11th.
- **Rule 2 cannot live in rules** (it needs to read the item's other cells and the column's labels). Enforce it in the cell-write path in `apps/web/src/data/` (preventing it before the write) **and** in a Function that reverts an item write which reaches a done status with empty required cells and logs an activity entry explaining it. Name the limit honestly in the UI: the revert is eventual, not atomic. If the owner wants atomic, the cell write must move to a callable (bigger change, say so).
- **Shared helper:** extend `validateRequiredColumns` with the "reaching Done" check, and use it from the web write path, the Functions revert and the form path.
- **UI:** the table cell and item card show why a write was refused (a toast naming the column). The column menu's Required switch warns how many items are currently empty (a count, no rewrite).

## Decisions (owner, 2026-11-06: all three defaults confirmed)

1. Should rule 2 (blocked from Done while required cells are empty) apply, or only rule 1 (can't clear a required cell)? **Both.** Decided: both.
2. Is an eventual revert acceptable for rule 2, or must it be atomic (callable writes, a larger change)? **Eventual.** Decided: eventual.
3. Should board owners be able to bypass the rule? **No bypass.** Decided: no bypass.

## Tests

- Rules tests for `requiredColumnIds` (client write refused, Functions-only), and for clearing a required cell as owner, editor and viewer.
- Unit tests for the shared helper (each emptiness case; Done reached with and without empty required cells).
- Functions test for the revert and its activity entry.
- Web test for the refused-write toast.

## PR split

1. **REQ-1 shared and rules:** `requiredColumnIds` field, the trigger maintenance, the rules and tests (hot spots; small).
2. **REQ-2 functions:** the Done-with-empty-required revert and activity entry.
3. **REQ-3 web:** write-path check, toasts, the column menu warning, showcase update (`scripts/showcase/`), owner check-list entry.

## Definition of done

The five checks pass, CI is green including `visual`, and a refused write is shown live on the showcase board; the Roadmap item is In review with Actionable = Yes and an entry in `docs/plans/owner-check-list.md`.
