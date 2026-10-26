# 2026-10-24 · Claude (Sonnet 5.5) · P1b: the board table

Spec: `docs/specs/P1b-board-table.md`. Branch `claude/p1b-board-table`.

## What was built

- **The table** (`apps/web/src/components/board-table/`): groups with title row, sticky column header, item rows, "+ Add item", footer summaries, collapsed rows, the floating batch bar, search with yellow highlights, drag and drop (rows within and across groups, groups by their title, columns by their header), column resize, keyboard navigation (arrows, Enter, Escape, Delete).
- **Nine column types** with a cell and an editor each (`apps/web/src/columns/`): status (full-bleed, picker, "Edit Labels"), text, long text, numbers, date (Vibe DatePicker), people, dropdown, checkbox, link. How to add one: `docs/architecture.md` section 6.1.
- **Shared** (`packages/shared`): `aggregate` per column type plus `columnRegistry.aggregate`, with unit tests.
- **Data**: `useItems` keeps unchanged items referentially stable (what makes 1,000 rows cheap); `itemWrites` (field-path cell writes, batches of 400), `updateBoardStructure` (transactions for `columns` and `groups`). New boards get the five sample items.
- **Tests**: unit (table model, move maths, search, naming, keyboard, formats, palettes, seed items), component (`BoardTable.test.tsx`), rules (`tests/rules/src/p1b.test.ts`), visual (the seeded "Product roadmap" is now a real table; new screens: scrolled, status picker, date picker, collapsed group, batch bar, search; light, dark and black).

## Decisions worth knowing

- **Sample items are a second write.** The item rules read the board with `get()`, which sees the state _before_ a batch, so a board and its items cannot be created in one batch. `writes.createBoard` creates the board, then the five items. A rules test pins this down. (Doing it in one batch would need `getAfter()` in the rules; not done, to avoid touching them.)
- **Name click opens the item** (`openItem(boardId, itemId)` in `board-table/open-item.ts`, a toast placeholder until the item card from PR #6 lands). Rename: double-click, Enter or F2 on the name cell, or "Rename" in the row menu.
- **The Item column width** is a per-user preference (localStorage), because it is not a `ColumnDef`. Other widths are saved to `ColumnDef.width` on mouse-up.
- **Collapsed groups** are per user (localStorage), never shared.
- Sorting is view-only and, like search, turns row dragging off while it is active.
- Dev tools: open a board with `?dev` on the dev server for a toolbar menu that seeds 1,000 items or a Roadmap-shaped sample.

## Gotchas

- `dnd-kit`'s `attributes` carry `role="button"` and `aria-disabled`; they are left out on purpose (`drag-props.ts`) so row and cell semantics survive.
- A `MenuButton` per row is only mounted after the row is first hovered.
- Vibe menu items need a hover before a click lands (also true in Playwright: hover, then click with a small delay).
- Visual tests: `shoot(page, name, PARK_IN_HEADER)` parks the mouse in the board header so no row or sidebar hover state ends up in a baseline.
- The `unique "key"` console warning on board pages comes from the P1a header (`TabList`), not the table.

## Next

- Wire the item card: change `openItem` once `item-card-store` is on `main`.
- P1c: Person, Filter, Sort, Hide and Group by in the toolbar (placeholders now); the trash and archive views; subitems.
- People editor lists only the signed-in user until P4 makes member profiles readable.
