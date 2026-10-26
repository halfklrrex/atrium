# P3: Kanban view

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: P3 "Kanban view" · Branch `claude/p3-kanban` · Depends on `P3-saved-views.md` (the view framework) being merged

## Goal

monday's Kanban: one **lane per label** of a status column, with the items as **cards**. Dragging a card to another lane changes its status. Clicking a card opens the **full item view**.

## Settings (`views/{id}.settings.kanban`)

```
kanban: {
  columnId: string | null      // status column whose labels make the lanes; null = first status column on the board
  cardColumnIds: string[]      // columns shown on cards (default: first 3 non-status, non-derived columns)
  collapsedLaneIds: string[]   // lane keys collapsed by the user (label ids, or '__empty')
  showEmptyLanes: boolean      // default true
}
```

- Add the zod schema to the view schema from `P3-saved-views.md`.
- The view's `settings.filter` and `hiddenColumnIds` apply as in table views (filters, person filter and search all work). Group-by doesn't apply to Kanban, so hide that toolbar control in Kanban views.

## Measured monday reference (2026-10-26, 1718px viewport, read-only)

These values **override** the layout section below wherever they differ. The private screenshot is `docs/reference/monday/12-kanban.jpg` (gitignored, home copy only).

- **Lanes:**
  - **260px** wide with a **16px** gap (lane x positions 305, 581, 857…), starting at the board's content gutter.
  - The lane is a column: header, then body.
- **Lane header:**
  - **40px** tall, filled with the **label colour**, radius **8px 8px 0 0**.
  - Title in white, Figtree **16px/24px weight 600**, with about 8px left padding. The count follows in white, **14px/21px weight 400**, 4px after the title.
  - The empty-lane header is the same; for example "Blocked 0" in red.
- **Lane body:** background **`#F6F7FB`** (the all-grey token), radius **0 0 8px 8px**. It's plain grey, not tinted per label, and runs the full height of the board area.
- **Cards:**
  - **236px** wide, so a **12px** inset each side in the lane, with about 12px from the top of the body and about 8px between cards.
  - White, **1px `#D0D4E4`** border (the ui-border token), **8px** radius, **8px** padding, **no shadow**.
  - **Title:** Figtree **14px/18px**, primary text, up to 2-3 lines.
  - **Field rows:** each row is the **column icon** (small, secondary colour) followed by the value. The column title is **not** shown.
    - Tags and dropdowns are light-blue chips; long text is 2 lines at 14px/21px with an ellipsis; links show the link icon and text.
    - **Status** on a card is a compact label with a **4px left bar in the label colour** and the label text at 14px, not a filled pill.
  - **Footer row,** right-aligned: the updates bubble (with the count when there are updates, for example "4 💬"), then the subitems icon.
- **The toolbar** above the lanes: Search, Person, Filter, Sort, a `⋯` menu, and on the right a small **status distribution bar** (battery) plus icons for export, settings (gear), board updates and collapse. Group by and Hide are absent in Kanban. Copy the battery bar and the settings gear; skip export and board updates for now.

## Layout (monday style, until Ophelia captures a measured reference)

- **The board area:** a horizontal scroller of lanes, each about **272px** wide, with an 8px gap, under the existing board header and toolbar. It uses the same 40px gutter as the table.
- **Lane:**
  - A rounded (8px) container on a light grey background (`--allgrey-background-color`).
  - **Header:** a 4px top bar, or a filled pill, in the **label colour**; the label name (bold 14px) and the card count in secondary text; a `⋯` menu (Collapse lane, Hide empty lanes).
  - An "Empty" lane for items with no label, in grey, shown last.
  - Lanes follow the **order of the labels in the column's settings**.
- **Collapsed lane:** a narrow vertical strip with the label name rotated and the count. Click it to expand.
- **Card:**
  - White, 8px radius, 1px border (`--layout-border-color`), padding 12px, hover elevation `--box-shadow-xs`.
  - The item name (14px, up to 3 lines).
  - Then one row per `cardColumnIds` column: the column icon plus its title in small secondary text, then the value rendered with that column's **table `Cell` component** (read-only on the card).
  - **Footer:** the updates bubble with its count (the same component as the table row) and, if the item has subitems, the subitem count.
  - Click opens `openItemFull(boardId, itemId)`. The bubble opens `openItem` (the side panel).
- **"+ Add item"** at the bottom of each lane: an inline name field. Enter creates the item in the board's **first group** (by position), with that lane's status value (`{index}`), positioned last, and keeps the field open for the next one.
- **Kanban settings:** a gear button in the toolbar on Kanban views opens a popover with:
  - "Group cards by" (a dropdown of the board's status columns);
  - "Card fields" (checkboxes, reorderable);
  - "Show empty lanes".
  - Saving follows the same unsaved and "Save to this view" flow as filters.

## Drag and drop (dnd-kit, as in `BoardTable`)

- A `DndContext` with a pointer sensor (`distance: 6`) plus a **keyboard sensor** (accessibility). There's one `SortableContext` per lane (vertical), and the lanes are droppables, so empty lanes accept drops.
- **Dropping in another lane:** write the status value for that lane (`{index: label.index}`, or `null` for Empty) through `tableActions.setCell`, which validates.
  - If the drop index changed, also write a new `position`, computed among that lane's visible cards with `positionBetween`.
  - Use **one batch**: extend `itemWrites` with a combined `setCellAndMove`, a field-path value write plus `position`.
- **Reordering within a lane:** write `position` only.
- **Optimistic:** keep the card in its new lane at once, using a local patch like the table's `patches`, and roll back with an error toast on failure.
- **Drag is disabled** while a sort is active in the view (order is then derived), with a tooltip on the drag attempt, as in the table.
- **Locked, derived or read-only status column**, or a viewer role: cards aren't draggable, and "+ Add item" is hidden.
- `DragOverlay` shows the card with a slight tilt (`transform: rotate(2deg)`, respecting `prefers-reduced-motion`).

## Performance

- Lanes with more than 100 cards virtualise vertically with `@tanstack/react-virtual` (measured heights).
- Cards are memoised by item identity: `useItems` keeps unchanged item objects stable.

## Code reuse

- dnd-kit and the table's `Cell` components cover most of it.
- Focalboard's `webapp/src/components/kanban/*` (AGPL-3.0) may be consulted for lane and card interaction details. If any code is **copied or adapted**, keep its header, add a `docs/PROVENANCE.md` row (upstream, SHA, paths, changes) and the "Modified for Atrium" line, per `AGENTS.md` → Licensing. Prefer writing it fresh on dnd-kit.

## Tests and QA

- **Unit tests:**
  - lane building (label order, the Empty lane, filters applied);
  - the card fields;
  - the drop writing status and position (one batch);
  - viewer read-only;
  - collapsed lanes;
  - "+ Add item" status and group;
  - the settings popover.
- **Showcase:** add a shared Kanban view "Status board" grouped by the showcase Status column, with 3 card fields.
- **Visual tests:** a `board-kanban` screen in light and dark, and `board-kanban-collapsed`. Regenerate the baselines through the workflow.
- **QA in the dev server, light and dark:**
  - drag a card across lanes and check the table shows the new status;
  - reorder within a lane;
  - add items from a lane;
  - collapse a lane;
  - change the card fields and save;
  - check a filtered Kanban;
  - check that a viewer can't drag.
- **Follow-up (Ophelia):** a measured VF pass against monday's real Kanban once a reference capture is available.

## Privacy

The repo is public: follow `AGENTS.md` → Privacy.
