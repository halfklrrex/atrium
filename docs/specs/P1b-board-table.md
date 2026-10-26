# P1b: The board table (groups, items, core columns)

Author: Opus 5.5 · Implementer: Sonnet 5.5 (high effort) · Status: ready to build
Roadmap epics: P1 "Groups", "Items & subitems" (items only; subitems come in P1c), "Table view (main board grid)", "Core column types", and "Board filter, sort, search & group-by" (search only). Also VF "Board header & table parity".

This is the heart of the product. It must look and feel like monday's main table. The target is `docs/reference/monday/01-board-table.jpg` and `07-status-cells-zoom.png` (open them with Read), plus `docs/reference/monday-ui-reference.md` §Board page and §Shell layout. Treat pixel details as requirements.

## 1. Layout and anatomy (light theme; dark and black via tokens)

The board page lives inside the white content panel. The P1a header (title, view tabs, toolbar) stays, with the fixes in §6. Below it, the board body scrolls both ways inside the panel. Groups stack vertically, about 40px apart.

**Group block, from top to bottom:**

1. **Group title row** (about 40px, no background):
   - A 20px chevron in the group colour (collapse toggle).
   - The title in **Poppins 18px/24px weight 500, in the group colour**. Inline-editable on click.
   - An item count in secondary 14px ("6 items"), shown on hover only, as in monday.
   - A `⋯` group menu on hover, to the left of the chevron in the gutter.
2. **Column header row** (36px, white):
   - Cells have 1px `#D0D4E4` borders on the top, the bottom and between cells.
   - A **6px group-colour bar** on the far left, with a top-left radius of 4px.
   - Then a checkbox cell (about 36px), then the **Item** header cell (the name column, ≈400px total including the bar and checkbox, left-aligned title).
   - Then the other column headers: Figtree 14px `#323338`, **centred**, inline-editable on double-click. On hover a `⋯` column menu appears at the right of the cell.
   - A final **"+" add-column** cell, 36px wide.
3. **Item rows** (36px each):
   - The same 6px colour bar on the left.
   - A checkbox cell.
   - The name cell: the item name in 14px, single line with ellipsis. An "open item" ↗ affordance appears on hover (opens the item card in P1c; a placeholder toast for now). An **updates bubble** icon sits at the right edge of the name cell, separated by a 1px divider.
   - Then the value cells.
   - Every cell has a 1px `#D0D4E4` bottom border and a right border.
   - **Row hover:** a light grey background (Vibe hover token), with a `⋯` row menu in the left gutter outside the bar.
   - **Selected rows** (checkbox): a light-blue background.
4. **"+ Add item" row** (36px):
   - The colour bar is faded to 50% opacity.
   - Placeholder text "+ Add item" in secondary colour, aligned with the item names.
   - Clicking turns it into an input: Enter creates the item at the bottom of the group and keeps the input open for the next one; Esc cancels.
5. **Summary footer row** (36px):
   - No colour bar, and no cells under the name column (that area is blank and borderless, as in monday).
   - Under each value column, a summary per §4.

**Sticky behaviour:**

- The name column (bar, checkbox and name) is sticky on horizontal scroll, with a soft right shadow while scrolled.
- Each group's header row is sticky at the top of the board scroll area while its group is in view.

**Collapsed group:** a single 36px row containing the colour bar, chevron, title, "N items", and the summaries for each column. This matches monday's collapsed look.

**Below the last group:** an outlined button "+ Add new group". It creates a group at the bottom with the next colour from the palette and the title "New Group".

**Column widths:**

- Defaults: Item 400. Status, people, date and numbers 140. Text, long_text and link 200. Dropdown 160. Checkbox 80.
- Widths are resizable by dragging the header cell's right edge (minimum 80). They persist in `ColumnDef.width`, saved on mouseup.

## 2. Column types: cells, editors and monday behaviour

Each type registers a **Cell** (display) and an **Editor** (popover or inline) in `apps/web/src/columns/`. Values use the monday value JSON from `packages/shared` (already defined in P1a).

| Type        | Cell display                                                                                                                                                                                                       | Editor                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`    | **Full-bleed** fill in the label colour, white 14px centred label, no padding or radius. The empty value is light grey `#C4C4C4` with no text. A folded-corner triangle appears on hover in the top-right.         | A popover under the cell: a grid of label "chips" (each a full colour block, about 32px tall, radius 4px), then a divider, then "✎ Edit Labels" (opens an inline editor: rename, recolour from the status palette, add, delete. Saves to column settings). Clicking a chip sets the value and closes the popover. |
| `text`      | Centred 14px text, ellipsis.                                                                                                                                                                                       | Inline input in the cell. Enter or blur saves, Esc cancels.                                                                                                                                                                                                                                                       |
| `long_text` | Single line, ellipsis.                                                                                                                                                                                             | Popover textarea (about 300×160). Save on blur or Ctrl+Enter.                                                                                                                                                                                                                                                     |
| `numbers`   | Centred number, formatted with thousands separators, with the unit symbol if set (e.g. "$1,200").                                                                                                                  | Inline numeric input.                                                                                                                                                                                                                                                                                             |
| `date`      | Centred "Oct 23" (with the year only if it isn't this year). Hovering an empty cell shows a calendar icon. A past date on a row whose first status column isn't "done" shows a red exclamation icon, as in monday. | Popover calendar (Vibe DatePicker), with "Today" and "Clear".                                                                                                                                                                                                                                                     |
| `people`    | Centred stack of 26px avatars (initials or photo). An empty cell shows a faint person-plus icon on hover.                                                                                                          | Popover: a search box, then the list of workspace members (for now only users whose profiles the caller can read; at least the caller themself), then a "Remove all" link.                                                                                                                                        |
| `dropdown`  | Small pill tags (light-blue background, 13px text, radius 4px), up to what fits, then "+N".                                                                                                                        | Popover: a search or create input, then the existing labels as selectable pills. Typing a new label and pressing Enter creates it in the column settings.                                                                                                                                                         |
| `checkbox`  | A centred 18px checkbox. Checked shows a green check (`--positive-color`). One click toggles it; no editor.                                                                                                        |                                                                                                                                                                                                                                                                                                                   |
| `link`      | Blue link text (the display text, or the URL), opening in a new tab.                                                                                                                                               | Popover with "Web address" and "Text to display" fields.                                                                                                                                                                                                                                                          |

General rules:

- Opening an editor selects the cell with a 1px `--primary-color` outline.
- Only one editor is open at a time.
- Clicking outside saves (text-like editors) or closes the popover.
- **Viewers** see cells but can't open editors (check `boardRole` client-side; rules already enforce it).

## 3. Items: actions and multi-select

- **New item** (primary toolbar button): adds "New item" at the **top of the first group**, with the name cell immediately in edit mode.
- The split-arrow menu offers "New group of items", which adds a group at the top.
- **Row `⋯` menu:** Open item (P1c placeholder), Duplicate, Move to group ›, Archive, Delete.
  - Archive sets `state: 'archived'`; Delete sets `state: 'deleted'` with `deletedAt`.
  - Both show an Undo toast that restores `state: 'active'`.
- **Drag and drop:** drag rows by a handle that appears in the gutter on hover, or by the whole row.
  - Reorder within a group, and move across groups (updating `groupId` and `position`).
  - Use `@dnd-kit` (already installed) with a drag overlay that looks like a lifted row (shadow, slight tilt is fine).
- **Multi-select:** the header checkbox selects or deselects all items in that group.
  - With 1+ selected, show monday's **floating batch bar** at the bottom centre: a white card with a shadow and radius 8px.
  - Left side: a blue count block ("2"), then "Items selected", then coloured dots for the selected items' groups.
  - Actions: Duplicate, Archive, Delete, Move to ›, and ✕ to clear.
  - Batched writes go in chunks of 400 or fewer per Firestore batch.
- **New boards are seeded** in the same batch as the board: "Item 1", "Item 2" and "Item 3" in the first group, and "Item 4" and "Item 5" in the second. Values stay empty except the status column, which gets "Working on it", "Done" and "Stuck" on items 1–3, as monday does.
- **Keyboard:**
  - Arrow keys move the selected cell.
  - Enter opens that cell's editor, or starts renaming the name cell.
  - Esc closes the editor or clears the selection.
  - Delete or Backspace on a selected value cell clears it, except status (sets it to empty) and checkbox (unchecks).

## 4. Group summaries (footer row)

- **status:** a battery: a stacked horizontal bar 24px tall, inset 4px, with segments proportional to each label (empty counts as grey). Hovering a segment shows a tooltip like "Done 3/6 · 50%".
- **numbers:** the sum (formatted with the unit), plus a small "sum" caption under it.
- **date:** the earliest to latest date shown as a range pill ("Oct 3 - Nov 12"), in the group colour with white text.
- **people, checkbox, dropdown, text, long_text, link:** blank. For checkbox, show "3/5" instead.
- The registry's `summaries` field drives this. Add an `aggregate(values, settings)` helper per type in shared, with unit tests.

## 5. Groups: menu and behaviour

- **Group `⋯` menu:**
  - Collapse this group, Collapse all groups
  - Add group above / below
  - Rename group
  - Change group colour (a palette popover with the 20 monday group colours from Vibe tokens)
  - Duplicate group (items included, in chunks)
  - Move to top / bottom
  - Delete group (confirm dialog "Delete this group and its N items?"; soft-deletes the items, removes the group from `board.groups`, shows an Undo toast)
- **Reordering:** drag groups by their title row (when all groups are collapsed this is easiest, as in monday). Changes `GroupDef.position`.
- **Collapse state:** per user, in `localStorage`, keyed by board and group. It's not shared.

## 6. Column header menu and adding columns

- **Column `⋯` menu:**
  - Settings › for status and dropdown opens the label editor; for numbers, a unit and decimals editor.
  - Sort ascending / descending: a view-only sort of the current session, with a sort indicator in the header.
  - Duplicate column (with values: writes every item in chunks, with a progress toast)
  - Rename
  - Add column to the right ›
  - Delete (confirm dialog; removes the `ColumnDef` and, through a chunked batch, deletes `values.{colId}` from items)
- **Reordering:** drag column headers to reorder (updating `ColumnDef.position`). The Item column is fixed.
- **"+" add column:** a popover titled "Essentials", listing the 9 types with a coloured icon tile each, as in monday's column picker. Creating a column gives it a default title ("Status", "Text", "Date"...) with a numeric suffix if one is taken, and puts the header into rename mode.

## 7. Toolbar (P1b scope)

- **Search** works: a click expands it into an input (about 200px) that filters rows by item name and any value's `toText()`, case-insensitive. Matches are highlighted in yellow. Groups with no matches hide. Esc clears it.
- Person, Filter, Sort, Hide and Group by stay as placeholders for P1c, with the tooltip "Coming soon".

## 8. Data, performance and correctness

- **Items listener:** use `boards/{id}/items where state == 'active'` with client-side ordering by `groupId`, then `position`. Exclude subitems (`parentItemId == null`) from the table.
- **Optimistic UI:** cell edits apply locally at once and write `values.{colId}` with `updateDoc` (field path), `updatedAt` and `updatedBy`. On failure, roll back and show an error toast.
- **Concurrency:** two users editing different cells must not clobber each other. Always write field paths, never the whole `values` map.
- **Board structure:** writes to `columns` and `groups` replace the array. Read-modify-write it inside a **transaction** to avoid lost updates.
- **Performance:**
  - Virtualise rows with `@tanstack/react-virtual` (install it) once a group has more than about 50 rows. Group blocks stay in normal flow.
  - The board must stay smooth at **1,000 items × 10 columns**. Add a dev-only "Seed 1000 items" action, or a script against the emulator, to test it.
- **Code structure:** keep the table code in `apps/web/src/components/board-table/`, with one component per concern (`BoardTable`, `GroupBlock`, `HeaderRow`, `ItemRow`, `Cell`, `SummaryRow`, `BatchBar`, editors). Put table-specific tokens in `apps/web/src/theme/table-tokens.css`.

## 9. Rules and tests

- Existing item rules should cover this. Verify:
  - an editor can create, update and soft-delete items
  - a viewer can't
  - field-path updates pass the `updatedBy` and `updatedAt` checks
  - board `columns` and `groups` updates by an editor pass
- Add rules tests for any gaps. Don't loosen the rules.
- Unit tests: aggregates, search matching, the position maths for moves, and the column default naming.
- Component tests: a status picker sets a value; "+ Add item" creates an item; selecting rows shows the batch bar; collapsing a group shows the summary row.

## 10. Visual QA gate (required)

1. Sign in to the emulator with email and password through the SDK (the emulator's Google popup can't return to the app in the preview pane).
2. Seed a board shaped like the owner's Roadmap: 3 groups, about 6 items each, columns Area (dropdown), Scope (text), Status, Priority (status), Date, Person and Budget (numbers).
3. Screenshot it next to `01-board-table.jpg` and iterate until it convincingly matches. Check:
   - row height and gridlines
   - header typography
   - status fills
   - group title style and the colour bars
   - the footer battery
   - the add-item row
4. Also capture:
   - an open status picker
   - the date picker
   - the batch bar
   - a collapsed group
   - the dark theme
5. Report remaining gaps.

## Out of scope (P1c)

- the item card and updates feed
- subitems
- Person, Filter, Sort and Hide toolbar features
- group-by
- the trash and archive views
- real undo history beyond the toasts

## Done

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` all pass, and the visual QA gate has been reported. No deploy, commit or push. Don't edit CLAUDE.md, HANDOFF.md or docs; the exception is a new section in `docs/architecture.md` §6 for the cell/editor registration API.
