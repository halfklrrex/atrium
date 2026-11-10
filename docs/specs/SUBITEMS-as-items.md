# SUBITEMS-as-items: subitems share the board's columns, get their own full page, and push the next row down

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: two 🐞 Bugs items from the bug inbox (3346811825 "subitems don't follow the item columns", 3346809308 "subitem table overlaps the next row"); Opus links both to this spec · Builds on: `docs/specs/P1-subitems.md` (merged), `docs/specs/P1-full-item-view.md`, `docs/specs/SIDEBAR-overview-tab.md` (PR 1 merged, PR 2 in flight), `docs/specs/OPS3-atrium-mcp-connector.md` · Status: spec, nothing built

## Owner questions (answer on the Roadmap item; each has a recommendation)

1. **One column set, no per-board switch?** Subitems always use the board's item columns, and `board.subitemColumns` is retired. Should a board still be able to choose "subitems have their own columns" (monday's older default)?
   **Recommendation: no switch.** One column set is what you asked for, it removes a whole class of bugs (see "Facts": files, buttons and time tracking already fail on subitem columns today), and a switch would keep every code path doubled. We can add a switch later if you miss it.
2. **What happens to the subitem columns that boards already have?** Today every board that has subitems has its own Owner / Status / Date (or more) subitem columns, with values in them.
   **Recommendation: merge, then move, then drop**, per column:
   - **merge** into a board column with the same type and the same title (for example the subitems' "Status" into the board's "Status"; labels matched by their text);
   - otherwise **move** it into the board's columns, at the end, if at least one subitem has a value in it (so no data is lost; the column then also shows on parent rows, empty, and you can delete it);
   - otherwise **drop** it (nobody filled it in).
     The dry run prints exactly what it would do for each board before anything is written, and Ophelia posts that list on the Roadmap item for you to approve before `--apply`.
3. **Do automations run on subitems?** Today an automation never fires for a subitem change (`matchAutomation` skips entries with a `parentItemId`). With shared columns, "When Status changes to Done" could also fire for subitems.
   **Recommendation: not in this epic.** Keep subitems out of automations, as today; monday has separate subitem triggers, and that is a later epic ("Automations: subitem triggers", logged in the VF/P5 group).
4. **Filters, sort and group-by on subitems?** With shared columns they become possible (monday filters "items and subitems").
   **Recommendation: not in this epic.** Filters and sort still act on parent rows only, as today; a parent whose subitem matches the search still opens. Logged as a follow-up.
5. **Subitem URL.** Recommendation: `/boards/<slug>-<boardId>/items/<subitemId>`, the same route as an item (a subitem is an item document). The alternative, `/items/<parentId>/subitems/<subitemId>`, would be a second route that says the same thing and breaks whenever the parent changes. See "URL design".

Ophelia's decisions that you can overrule: required columns and column locks of the board apply to subitems too (they are the same columns); the subitem block's header can rename columns and add a column (it is the board's column, so it also shows on items); a subitem's full page has no Subitems section (one level only).

## Goal

In monday, a subitem is an item with a parent: it shows the same columns as its parent (Status, Actionable, Task Type and so on), each with its own value, and it has its own description, updates and files. In Atrium a subitem has its own small column set (Owner, Status, Date), no updates bubble, no side panel and no full page, and the open subitem block is drawn over the next item row.

After this epic:

1. Subitems use the board's item columns (`board.columns`), with their own values. `board.subitemColumns` is empty on every board and nothing reads it.
2. A subitem is a full item: description, updates and replies, files, every column type (including the server-managed ones), the side panel, activity, notifications and My Work.
3. In an item's full page, clicking a subitem opens that subitem's own full page, with a breadcrumb back to the parent.
4. The open subitem block pushes the next item row down, in small and in virtualised (more than 50 rows) groups.

## Facts this design rests on (checked against `origin/main` at `487d85a`)

**Data model**

- Subitems live in `boards/{boardId}/items` with `parentItemId` set (`packages/shared/src/schemas/item.ts:24-29`). `useItems` streams parents and subitems together.
- `board.subitemColumns: ColumnDef[]` (`schemas/board.ts:95`) is `[]` until the first subitem; `tableActions.addSubitem` then writes `defaultSubitemColumns()` (`table-actions.ts:221-247`), and the MCP's `ensureSubitemColumns` does the same (`scripts/mcp/lib/service.mjs:211-224`, owner role only).
- **Column ids are already unique across both lists:** `newColumnId` checks `columns` and `subitemColumns` together (`table-actions.ts:96-101`) and `defaultSubitemColumns(avoidIds)` avoids the board's ids. So a subitem column can move into `columns` with its id unchanged, and its values stay valid.
- `derivedColumnIds`, `serverManagedColumnIds`, `requiredColumnIds` and `columnLocks` are **flat** lists over both column lists (`derived-ids.ts:51`, `nextColumnIdLists`), maintained by `onBoardColumnsWritten`.

**Security rules** (`firestore.rules`)

- Item create and update never check that `values` keys belong to a column list; they only refuse the blocked lists (derived + server-managed), locked columns for non-owners, and emptying a required column (`:913-959`).
- A subitem's parent must exist in the same board, be top-level, active and in the same group; `parentItemId` is immutable (`validSubitemParent`, `:889-898`, `:943`).
- Board create requires the `subitemColumns` key (`hasAll`, `:541-545`) and that it is a list; board update may change it (`:584-586`, `:604`). Templates require `structure.subitemColumns` as a list of at most 60 (`:403-411`).
- Updates, replies and `updatesCount` bumps live at `items/{itemId}/updates/...` and already work for any item id, subitems included (`:963-1092`).
- So the column change itself needs **no new item rules**; the rules change is only "boards and templates stop carrying subitem columns" (below).

**Server code that picks a column list by `parentItemId`** (all change to one shared helper)

- `functions/src/lib/activity.ts:270`, `notifications.ts:347-356`, `required-revert.ts:85`, `packages/shared/src/item-index.ts:95-97` (`assigneeUids`), `column-type-change.ts:155-162` (`inScope`, `columnsOf`: a type change on a board column skips subitems), `admin.ts:462` (`updateColumn` by scope).
- **Server code that only looks in `board.columns`**, so it already fails for a subitem column: `file-storage.ts:170,274,428` (Files upload/delete/rename), `column-actions.ts:180,250,339,471,491,542` (time tracking and buttons), `automations/run.ts:308`. With shared columns these start working for subitems with no change.
- `item-index.ts:113-114` gives subitems `dateKeys: []` (date recipes never address subitems); `admin-scheduler.ts:63` filters subitems out. Both stay (owner question 3).

**Web**

- Board table: `SubitemBlock.tsx` (`SubitemScope` swaps the env to `env.subitemColumns`, `scope: 'subitems'`, its own grid via `subitemGridTemplate`, `table-model.ts:207-225`), `ItemEntry.tsx`, `ItemRow.tsx` (`SubitemRow`; a subitem row has no updates bubble, no "Open item" icon and no side panel: `ItemRow.tsx:215,389,410-445,518`), `BoardTable.tsx:128-140,223,279,298,493`, `BatchBar.tsx:66`, `table-env.ts`, `table-model.ts`.
- Other views that read `subitemColumns`: `KanbanBoard.tsx:90,146`, `CalendarView.tsx:136,194`, `TimelineView.tsx`, `WorkloadView.tsx`, `BoardActivityPanel.tsx`, `ItemCardDrawer.tsx:72`, `boards/board-export.ts`, `BoardMenu.tsx`, `data/my-work.ts:18`, `pages/my-work/my-work-model.ts`, `data/firestore.ts`, `data/structure-writes.ts:14-49`, `components/templates/SaveAsTemplateDialog.tsx`.
- Full item view: `ItemView.tsx` at `boards/:boardId[/views/:viewId]/items/:itemId` (`App.tsx:43-45`). It finds the item in `useItems`, so a subitem id **already renders**, but with the board columns in Fields (wrong today, right after this epic), a Subitems section (wrong for a subitem), the parent-level prev/next, and no parent crumb. `ItemSubitems.tsx` lists subitem names as inline edits; nothing opens a subitem. `useItemTableCtx` (`use-item-ctx.ts`) builds `ctx` and `subCtx`.
- Description, its images (`description-image-upload.ts`, the `finalizeDescriptionImage` callable) and `UpdatesFeed` take `(boardId, itemId)` and have no subitem checks, so they work for a subitem id once a page shows them.
- URLs: `boardPath` / `itemViewPath` (`lib/paths.ts`, `item-view/item-view-store.ts:60-73`). Board params are `<slug>-<id>` and `idFromSlugParam` takes the text after the last dash, so **every id in a path must be dash-free**. Item ids are Firestore auto ids (`[A-Za-z0-9]{20}`), and the showcase seeder's ids were made dash-free in `02222bc`. The item segment is a bare id (no slug).
- **The overlap (bug 2):** both render paths put the subitem block in normal flow inside the item's sortable wrapper (`ItemRow.tsx:107-148`): the plain path (≤ 50 rows, `GroupBlock.tsx:207-226`) and `VirtualRows` (> 50 rows, `GroupBlock.tsx:293-360`: absolutely positioned `.virtualRow`s placed by `translateY(virtual.start)`, sized by `measureElement`, estimated at `36 × (3 + subitems)` with a non-reactive store read). Reading the code alone does not show the cause, so **PR 4 starts by reproducing it** (see "Table layout fix").

**MCP connector** (`docs/mcp-connector.md`, `scripts/mcp/lib/{tools,service}.mjs`, merged in `039f9c3`)

- `atrium_get_board` returns `subitemColumns` next to `columns`, and nests subitems with values keyed by subitem column title. `atrium_list_subitems` returns the subitem columns. `atrium_create_subitems` writes the defaults when a board has none (owner role). `atrium_update_item` picks the column list by `parentItemId` (`service.mjs:521`).

**Templates, showcase, visual tests**

- Saved templates never carry subitems: `templateFromBoard` keeps only top-level items (`schemas/template.ts:140`), but it copies `subitemColumns` (`:127`). Built-ins have `subitemColumns: []`.
- Showcase (`scripts/showcase/data.mjs:1172-1455`): the board's `subitemColumns` are `defaultSubitemColumns()`, and SUBITEMS carry Owner / Status / Date values.
- Visual seed (`tests/visual/src/seed.ts:326,382`): the roadmap board has default subitem columns; `FULL_VIEW_ITEM` has three subitems.

**In flight**

- SIDEBAR PR 2 adds `subitemSummary(items, parentId, subitemColumns)` and the Overview subitems row. If it merges first, PR 3 below switches its argument to the board columns; if not, SIDEBAR PR 2 passes `board.columns` (Ophelia tells whichever lands second).

## Data model decision

### Options

| Option                                                          | What it means                                                                                                            | For                                                                                                                                                                                                                                                                                     | Against                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Inherit `columns`** (recommended)                          | A subitem's columns are `board.columns`. `subitemColumns` stays in the schema as a deprecated field that is always `[]`. | One list: every column type, lock, required flag, type change, width and hidden-column setting applies to subitems with no extra code. Server code that only reads `columns` (Files, buttons, time tracking, automations' conditions) starts working for subitems. Rules barely change. | A migration for boards that have subitem columns. Columns that make sense only for parents (for example a mirror of a subitem rollup) also show on subitems; monday behaves the same with shared columns. |
| **B. Synced `subitemColumns`**                                  | Keep two lists and copy every `columns` change into `subitemColumns` (a Function, or every structure write).             | No change to readers that already use `subitemColumns`.                                                                                                                                                                                                                                 | Two lists that must stay equal: every structure write, type change, lock and the Function must keep them in step, and a drift shows wrong cells. The id-uniqueness rule breaks (same ids in both lists).  |
| **C. Per-board mode** (`subitemColumnsMode: 'shared' \| 'own'`) | A or the current behaviour, chosen per board.                                                                            | Keeps monday's older "own columns" option.                                                                                                                                                                                                                                              | Every code path stays doubled and gains a branch; more rules and tests. Nobody asked for it (owner question 1).                                                                                           |

**Recommendation: A.** It matches what the owner asked for, deletes code instead of adding it, and fixes the server-managed column gap for free.

### The helper (all readers use it)

`packages/shared/src/subitems.ts` gains:

```ts
/**
 * The columns an item's cells use. Subitems share the board's columns (SUBITEMS-as-items).
 * Transition only: a board that still has legacy `subitemColumns` (not migrated yet) keeps them
 * for its subitems. PR 6 removes the fallback.
 */
export function columnsForItem<C>(
  board: { columns: readonly C[]; subitemColumns?: readonly C[] | null },
  item: { parentItemId?: string | null },
): readonly C[];
```

The legacy fallback (`isSubitem(item) && (board.subitemColumns?.length ?? 0) > 0` returns `subitemColumns`) makes every PR safe to deploy in any order relative to the migration: an unmigrated board keeps working exactly as today, a migrated or new board uses the shared columns. A repo test (`scripts/subitem-columns.test.mjs`, like `scripts/database-id.test.mjs`) fails on any read of `subitemColumns` outside an allow list (the schema, `columnsForItem`, `derived-ids.ts`, the migration, the template legacy path, tests).

### Writes after the change

- `addSubitem` (web) and `atrium_create_subitems` (MCP) **stop writing default subitem columns**. A subitem is created with the same column defaults as an item (`newItemValues(columnsForItem(...), lockCtxOf(ctx))`, which `addSubitem` already calls with the subitem columns), so a Status column with a default label starts with it on subitems too.
- New boards, saved templates and template apply write `subitemColumns: []`.
- Cell writes, duplicates (`subitemCopy` → `withoutUnwritableValues(values, columnsForItem(...))`) and bulk edits validate against `columnsForItem`.
- `scope: 'subitems'` disappears from `TableCtx` (after the fallback is removed): the subitem block's header edits `board.columns`. During the transition a legacy board keeps `scope: 'subitems'`.

### Derived and server-managed columns, `onBoardColumnsWritten`

- No change to `nextColumnIdLists`: it already unions both lists, and once `subitemColumns` is `[]` it is just `columns`. The trigger recomputes the four lists after the migration's board write (merged and dropped subitem column ids leave them; moved ones stay).
- Derived columns (formula, progress, mirror, auto number and so on) compute for subitems with the same `compute()`; auto number keeps the separate subitem sequence (`boardSeq` from `nextSubitem`).
- Server-managed columns (time tracking, files, button) work on subitems through the existing callables, which look in `board.columns`. Add a unit test per callable for a subitem item id.
- **Column type change** (`column-type-change.ts`): `inScope('columns')` must include subitems (`true` for every item) once a board has no legacy subitem columns; for a legacy board it keeps today's split. Test: changing a Status column to Dropdown converts the subitems' values too, and Undo restores them.

### Migration (`scripts/migrations/2026-11-merge-subitem-columns.mjs` + test)

Same shape as the other migrations (Admin SDK, `FIRESTORE_DATABASE_ID`, dry run by default, `--apply`, `--board <id>` to run one board, idempotent, a summary per board). For each board with `subitemColumns.length > 0`:

1. Skip (and report) a board with a column whose `migrating` is set; rerun later.
2. Read all its subitems in **every state** (active, archived, deleted: Undo and restore must find their values).
3. Plan each subitem column `S` (owner question 2), as a pure function `planSubitemColumnMerge(columns, subitemColumns, subitems)` in `packages/shared/src/subitems.ts` (unit-tested):
   - **merge** when a board column `C` has `C.type === S.type` and the same title (trimmed, case-insensitive), and the type is in the merge list: `status`, `dropdown`, `people`, `date`, `text`, `long_text`, `numbers`, `checkbox`, `link`, `email`, `phone`, `rating`, `timeline`. Status and dropdown labels map by label text (case-insensitive); a label `C` lacks is appended to `C`'s labels (next free index, the same colour). Other types copy the value unchanged.
   - **move** otherwise, when any subitem has a non-empty value in `S` (`isEmptyCell` semantics from REQ: missing, null, `''`, `[]`, `{}`): append `S` to `columns` after the last position, keeping id, title, settings and width. A title that already exists on the board gets " (subitems)" appended.
   - **drop** otherwise.
4. Write, in one transaction for the board plus batches of up to 400 item updates (each a field-path write `values.<C>` and a delete of `values.<S>` for merges; no write for moves; a delete of `values.<S>` for drops):
   - `columns` (merged label additions and moved columns), `subitemColumns: []`, `columnLocks` (a merged `S` becomes `C`, a dropped one is removed, a moved one stays), `updatedAt` and `updatedBy` (the uid of the board's first owner in `access`, so the activity trigger can attribute it; the existing backfills never touch these fields, but this one changes structure and the rules-equivalent shape expects both).
   - If the target `C` already has a value on that subitem (should not happen), keep it and report the conflict.
5. Activity: the migration's writes go through the normal triggers, so the board gets "column added" entries for moved columns and item entries for merged values, attributed to that owner. Acceptable; the summary is posted on the Roadmap item.
6. Item index: the item writes re-run `onItemPeopleAssigned` (`syncItemIndexFields`), which recomputes `assigneeUids` from the shared columns (merged People values move to `C`). Moved columns keep their ids, so subitems with only moved columns need no write and their index is already right.
7. Views: nothing to change. Moved columns appear in every view; the owner can hide or delete them.

Run order: PR 1 lands (helper with fallback, functions); Ophelia runs the dry run against production, posts it for the owner (Actionable = Yes), then runs `--apply`, then re-runs the showcase seeder.

### Rules and rules tests

The item rules don't change (they never tied `values` to a list). What changes, in **PR 6** (after the migration, when nothing writes subitem columns any more):

- **Board create:** `d.subitemColumns == []`.
- **Board update:** `subitemColumns` leaves the `changed.hasOnly` list, so no client can set it again (the migration uses the Admin SDK).
- **Template create:** `s.subitemColumns == []`. Existing template documents keep whatever they have; template apply ignores it (PR 2).
- Tests in `tests/rules/src/subitems.test.ts` (and `templates.test.ts`):
  - a board create with non-empty `subitemColumns` is refused; with `[]` it passes;
  - an editor's update that changes `subitemColumns` is refused, an update that leaves it alone passes;
  - a subitem create and update writing a **board** column value passes; a derived, server-managed or locked board column on a subitem is refused for a non-owner; emptying a required board column on a subitem is refused;
  - an update and a reply on a subitem's feed, and its `updatesCount` bump, pass (they already do; the test pins it);
  - a template create with non-empty `structure.subitemColumns` is refused.
- `tests/rules/src/helpers.ts`: the board fixture already has `subitemColumns: []`; keep it.
- Storage rules: none. Files paths are per item id and authorised through callables.

### MCP connector

In PR 2:

- `atrium_get_board`: subitems nested with values keyed by the **board** column titles (`columnsForItem`). The `subitemColumns` key is **removed** from the output (on a legacy board it is returned only while it is non-empty, so a dry-run comparison still makes sense; PR 6 drops that).
- `atrium_list_subitems`: returns `columns` (the board columns, as `atrium_get_board` lists them) instead of the subitem columns.
- `atrium_create_subitems`: no defaults write and no owner-role requirement; values keyed by board column title or id; the description and `docs/mcp-connector.md` say so.
- `atrium_update_item`, `atrium_duplicate_item`: use `columnsForItem`.
- `docs/mcp-connector.md`: the subitems paragraph (line 66) and the "not supported" line about subitem columns (line 91) are rewritten. `scripts/mcp/atrium-mcp.test.mjs`: subitem tests switch to board columns; one test keeps a legacy board.

### Activity log, notifications, My Work, export

- `activity.ts`, `notifications.ts`, `required-revert.ts`, `item-index.ts`, `data/my-work.ts`, `my-work-model.ts`, `board-export.ts` and the workbook: `columnsForItem`. Export's "Subitems" sheet uses the board column headers.
- Activity entries already carry `parentItemId`; `BoardActivityPanel` and the side panel's Activity tab filter by `itemId`, so a subitem's own panel shows its own entries.

### Templates

- `templateFromBoard`: `subitemColumns: []`. Template apply: writes `[]` whatever the template holds (templates never carry subitems). Built-ins unchanged.

### Showcase

- `scripts/showcase/data.mjs`: the showcase board's `subitemColumns: []`; SUBITEMS give values in the board's own Status, Person and Date columns (plus one subitem with a description, one update and a file cell placeholder that the seeder can write: no Storage object, so a Files column cell stays empty). `showcase.test.mjs`: no subitem column checks; a subitem has a value in a board column.
- `tests/visual/src/seed.ts`: the roadmap board's `subitemColumns: []`, subitem values in board columns.

## URL design: a subitem's full page

- **Path:** `itemViewPath(board, subitemId)`, the same as an item: `/boards/<slug>-<boardId>[/views/<viewId>]/items/<subitemId>`. No new route. The subitem id is a Firestore auto id (dash-free), and the item segment carries no slug, so `idFromSlugParam` is not involved. Keep it so: if a readable item slug is ever added, it uses `<slug>-<id>` with `idFromSlugParam`, and test ids stay dash-free.
- **Copy link** on a subitem's page copies that path; the link opens the subitem directly (a deep link with no router state).
- **Router state** gains `fromItem?: string` (the parent id) next to `fromBoard`, so the page knows how it was opened.
- A subitem id whose parent is archived or deleted: the subitem is shown (it is still in `useItems` only if active; if it isn't active the page says "This item no longer exists." as today).

## Full item view changes (`ItemView.tsx`, `ItemSubitems.tsx`)

For a subitem (`isSubitem(item)`):

- **Breadcrumb:** workspace › board › group › **parent name**, the parent crumb a link (`<a href>` via `itemViewPath(board, parent.id)`, router `navigate` on click, `replace: false`) with the accessible name "Back to <parent name>". The title above shows the subitem's name; a small muted line "Subitem of <parent name>" is not needed (the crumb says it).
- **Back:** browser Back returns to the parent when the page was opened from it (`fromItem`). The parent crumb always opens the parent. Close (×) and Escape behave as today (back to the board, or `navigate(-1)` when `fromBoard`). A subitem opened from its parent with `fromBoard` set keeps `fromBoard` in the state, so closing from the parent later still goes back to the board.
- **Prev / next:** among the parent's active subitems in position order ("Previous subitem" / "Next subitem", "2 / 5"); `replace: true` like items. Pure helper `subitemNeighbours(items, subitem)` next to `neighbours` (unit-tested).
- **Sections:** Description, Updates and Fields as for an item, with `columnsForItem` (the board columns after migration). **No Subitems section** (one level). Required summary counts `columnsForItem`.
- **Menu:** "Copy link", "Duplicate subitem" (`duplicateItems` already copies a subitem after its siblings), "Archive subitem", "Delete subitem". Archive and Delete close to the parent's page.
- **From the parent's page (`ItemSubitems`):** each subitem row becomes a row the user can open: the name is a button (single click opens the subitem's page: `navigate(itemViewPath(board, sub.id), { state: { ...currentState, fromItem: parent.id } })`), with an "Open" icon button as in the table and a rename action (double click or the row's "Rename" menu item, as in the table) instead of the always-on inline edit. Cells stay editable in place. Show the board columns that the table's view shows (hidden columns respected through `useItemViewStore`'s view id; if that is not available, all columns, capped like the Fields grid). Each row also shows the updates count badge.
- `windowRef` focus moves to the new page on navigation (already keyed by `itemId`).

## Board table changes

- **Columns:** `SubitemScope` uses the same `ColumnView`s as the parent table (`env.columns`, hidden and collapsed per view) when the board has no legacy subitem columns, and the ctx without `scope: 'subitems'`. The subitem grid keeps `calc(nameTrack - indent)` for the name, so each subitem cell sits exactly under its parent's column. Resizing in the subitem header resizes the board column (the same column).
- **Header:** the subitem block's `HeaderRow` shows the board columns. Rename, settings and "+ add column" act on `board.columns` (owner decision above). Group-only controls (select all of the group) stay as today in the block.
- **Subitem rows** gain what item rows have: the updates bubble (opens the side panel on Updates), the "Open" icon (`openItemFull`), "Open item" in the row menu and a single click on the name opening the side panel. Remove the `TODO(subitems)` at `ItemRow.tsx:388`. The grid gets the bubble track like item rows (`subitemGridTemplate` adds it after the name).
- **Side panel (`ItemCardDrawer`):** opens for a subitem. Its crumb adds the parent (a button that opens the parent in the panel). The Overview's subitems row is hidden for a subitem. `allColumns` at `:72` becomes `columnsForItem`. This lifts SIDEBAR's non-goal "Opening the panel for a subitem".
- **Kanban, calendar, timeline, workload, batch bar, required hints:** `columnsForItem`.

## Table layout fix (bug 2)

1. **Reproduce first, as a test.** Add a Playwright check in `tests/visual/src/screens.spec.ts` (not a screenshot; geometry): on the seeded roadmap board, expand the parent with subitems and assert, for the expanded entry and the next item row, `next.top >= block.bottom - 1` (CSS px). Do it twice: in a small group, and in a group of more than 50 rows (extend the seed with a 60-item group, or use the dev `seed-1000` data in a local run) with the expanded parent scrolled to the middle, after expanding, after adding a subitem, and after collapsing again.
2. **Prime suspect: `VirtualRows`.** Rows are absolutely positioned at `virtual.start` and only move when the virtualizer re-measures. Check that expanding, adding a subitem and the subitem block's own lazy cells all reach `measureElement` (the ResizeObserver on `.virtualRow`); if any change is missed, call `virtualizer.measure()` (or re-key the measured element) when `expanded` or the subitem count of a row changes: subscribe `VirtualRows` to `useTableStore((s) => s.expanded)` and pass it to `estimateSize` so the estimate is right before the first measure. Use the measured subitem row height (`--atrium-subitem-row-height`, 32 px) instead of 36 in the estimate.
3. **If the small-group path also overlaps:** look for something that takes the block out of flow or gives it a fixed height (`.row` heights are fixed per row, the block must not be inside a fixed-height element; `SortableWrap` must not get a dnd-kit transform at rest; `.subBlock` must not be `position: absolute`). Fix in CSS with tokens only; no layout animation.
4. **Paint order:** the block's sticky name cells and header (`--atrium-table-z-sticky`, `--atrium-table-z-header`) must not paint over the next row even when geometry is right; the subitem header is `position: relative` with the same z-index as a normal row, not the group header's.
5. The geometry test fails before the fix and passes after it. Baselines change only if the fix moves pixels in an existing screen; update them through the workflow.

## Files to touch (by PR)

| File                                                                                                                                                                                                                                  | PR  | Change                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/subitems.ts` (+ test)                                                                                                                                                                                            | 1   | `columnsForItem`, `planSubitemColumnMerge`; `defaultSubitemColumns` marked deprecated (used by tests only) |
| `packages/shared/src/item-index.ts`, `schemas/template.ts`, `schemas/board.ts` (doc comment), `index.ts`                                                                                                                              | 1   | helper; `templateFromBoard` writes `[]`; deprecate the field in comments                                   |
| `functions/src/lib/{activity,notifications,required-revert,column-type-change,admin}.ts` (+ tests), `file-storage.test.ts`, `column-actions` tests                                                                                    | 1   | `columnsForItem`; type change covers subitems; subitem tests for Files, buttons, time tracking             |
| `scripts/migrations/2026-11-merge-subitem-columns.mjs` (+ test), `scripts/subitem-columns.test.mjs`                                                                                                                                   | 1   | the migration; the "no stray reads" test                                                                   |
| `docs/architecture.md` (§5.4, §5.5, §6.2), Decisions board                                                                                                                                                                            | 1   | Opus: subitems share `columns`; `subitemColumns` deprecated                                                |
| `scripts/mcp/lib/{service,tools}.mjs`, `scripts/mcp/atrium-mcp.test.mjs`, `docs/mcp-connector.md`                                                                                                                                     | 2   | MCP as above                                                                                               |
| `apps/web/src/components/board-table/{table-actions,table-model,table-env,BoardTable,SubitemBlock,ItemRow,BatchBar,AddItemRow}.ts(x)`, `data/{structure-writes,firestore,my-work}.ts`, templates apply and `SaveAsTemplateDialog.tsx` | 2   | stop writing subitem columns; `columnsForItem` everywhere; block uses board columns                        |
| `apps/web/src/components/{board-kanban,board-calendar,board-timeline,board-workload,activity,boards}/…`, `pages/my-work/my-work-model.ts`                                                                                             | 2   | `columnsForItem`                                                                                           |
| `scripts/showcase/{data,seed-showcase}.mjs`, `showcase.test.mjs`, `tests/visual/src/seed.ts`                                                                                                                                          | 2   | shared columns                                                                                             |
| `apps/web/src/components/item-view/{ItemView,ItemSubitems,item-view-store,use-item-ctx}.ts(x)` (+ tests), `ItemView.module.css`, `theme/item-panel-tokens.css` if a token is needed                                                   | 3   | subitem full page, breadcrumb, prev/next, open from parent                                                 |
| `apps/web/src/components/board-table/{ItemRow,table-model}.ts(x)`, `item-card/ItemCardDrawer.tsx` (+ tests)                                                                                                                           | 4   | subitem rows: bubble, open icon, side panel                                                                |
| `apps/web/src/components/board-table/{GroupBlock.tsx,table.module.css}`, `tests/visual/src/{screens.spec,seed}.ts`                                                                                                                    | 5   | overlap fix and geometry test                                                                              |
| `firestore.rules`, `tests/rules/src/{subitems,templates}.test.ts`, `packages/shared/src/subitems.ts`, `scripts/subitem-columns.test.mjs`                                                                                              | 6   | rules hardening; remove the legacy fallback and `scope: 'subitems'`                                        |

## Tests

### Unit (Vitest, next to the code)

- `columnsForItem`: item → `columns`; subitem on a migrated board → `columns`; subitem on a legacy board → `subitemColumns` (until PR 6, then only `columns`).
- `planSubitemColumnMerge`: merge by type and title (case and spaces ignored); status labels mapped by text and a missing label appended; move when values exist; drop when none; a moved title clash gets " (subitems)"; locks remapped; values in archived and deleted subitems count; idempotent on a board with `subitemColumns: []`.
- Migration test (`backfill-*.test.mjs` style, fake Firestore): the dry run writes nothing; `--apply` writes the planned board and item updates; a board with a migrating column is skipped; a rerun is a no-op.
- Functions: activity labels a subitem's change with the board column title; notifications fire when a person is added to a subitem's board People column; `assigneeUids` for a subitem come from board People columns; a column type change converts subitem values and Undo restores them; Files upload, button press and time tracking accept a subitem id.
- Web: `addSubitem` writes no board structure; a subitem cell write validates against board columns; a locked or required board column behaves the same on a subitem; `subitemNeighbours`; `ItemView` for a subitem shows the parent crumb, no Subitems section and sibling prev/next; clicking a subitem in `ItemSubitems` navigates to its path with `fromItem`; Back returns to the parent; the side panel opens for a subitem; a subitem row has the updates bubble.
- MCP: `atrium_get_board` nests subitems with board-column values and has no `subitemColumns`; `atrium_create_subitems` on a board without subitem columns works for an editor.
- Repo test: no `subitemColumns` read outside the allow list.

### Rules (`pnpm test:rules`)

As listed under "Rules and rules tests" (PR 6), plus in PR 1 a test that a subitem may already write a board column value (pins today's behaviour the design relies on).

### Visual (Playwright)

- The geometry checks of "Table layout fix" (PR 5).
- `board: subitems expanded` (light and dark): the expanded block shows the board columns aligned under the parent's (PR 2 updates the baseline through the workflow).
- `item view: subitem` (light and dark): the seeded subitem's full page with the parent crumb (PR 3, new baseline).

## Acceptance criteria

- [ ] A subitem block shows the same columns as the board (same titles, widths and hidden columns of the view), each with the subitem's own value; no Owner / Status / Date defaults are created any more.
- [ ] Every column type works on a subitem, including Files, Button and Time tracking; locks and required columns apply.
- [ ] After the migration every board has `subitemColumns: []`, no subitem value is lost (merged, moved or reported), and the owner approved the dry-run list first.
- [ ] A subitem has a description (with images), updates and replies (with the count bubble), files, an activity log, notifications and shows in My Work when assigned.
- [ ] From an item's full page, clicking a subitem opens its own full page at `/boards/<slug>-<id>/items/<subitemId>`; the parent crumb and browser Back return to the parent; prev/next step through the siblings; Copy link opens the subitem directly.
- [ ] Subitem rows in the table have the updates bubble and the "Open" icon; the side panel opens for a subitem.
- [ ] An open subitem block pushes the next item row down in small and virtualised groups, also after adding a subitem; the geometry test proves it.
- [ ] The MCP connector reads and writes subitem values by board column title; `docs/mcp-connector.md` says so.
- [ ] Rules refuse non-empty `subitemColumns` on board create and update and on template create; all rules tests pass.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` pass; visual baselines updated through the workflow; visual QA against monday in light and dark (subitem block, subitem page), with gaps logged in VF.

## Task breakdown (Sonnet-ready)

Each PR: own worktree and branch `claude/subitems-<n>-<slug>`, its own `ATRIUM_PORT_OFFSET`, fresh `origin/main`, checks green, Opus review against this spec. PRs 3, 4 and 5 can run in parallel after PR 2 (they touch different files; PR 4 and PR 5 both touch `ItemRow.tsx`/`GroupBlock.tsx` only if needed, so merge 4 before 5 and rebase).

### PR 1: shared helper, functions, migration script (no UI change)

1. `columnsForItem` with the legacy fallback, `planSubitemColumnMerge`, tests.
2. Functions and `item-index.ts` switch to the helper; column type change covers subitems on migrated boards; subitem tests for Files, buttons and time tracking.
3. The migration script and its test; `scripts/subitem-columns.test.mjs` with the current reads in the allow list (PR 2 shrinks it).
4. A rules test pinning that a subitem may write a board column value.
5. Opus updates `docs/architecture.md` and logs the decision. After merge: dry run, owner approval, `--apply`.

### PR 2: web and MCP use the board columns (after the migration ran)

1. Stop writing default subitem columns (web and MCP); templates save and apply `[]`.
2. Every reader on `columnsForItem`; `SubitemScope` uses the board `ColumnView`s; the header acts on `board.columns`.
3. MCP output and docs; showcase and visual seed; baselines through the workflow.

### PR 3: the subitem full page

1. `ItemView` for a subitem: parent crumb, sibling prev/next, no Subitems section, subitem wording in the menu, `fromItem` state.
2. `ItemSubitems`: open on click, Open icon, rename on double click, updates count; new visual screen.

### PR 4: subitem rows are full rows

1. Updates bubble, Open icon, side panel for subitems (`ItemCardDrawer` crumb with the parent, no subitems row on a subitem); remove the TODO.

### PR 5: the overlap

1. Geometry test that fails; then the fix (virtualizer measure and estimate, CSS if needed); baselines if pixels move.

### PR 6: lock it in (after PRs 2 to 5 are live for a few days)

1. Rules: board create `subitemColumns == []`, update can't change it, template create `[]`; rules tests.
2. Remove the legacy fallback from `columnsForItem` and `scope: 'subitems'` from `TableCtx`; the repo test's allow list shrinks to the schema and the migration.

## What Ophelia (Opus) reviews

- No path writes non-empty `subitemColumns` after PR 2; the repo test's allow list is minimal.
- The migration plan is printed and approved before `--apply`; it reads subitems in every state and writes field paths only.
- Type change and Undo cover subitems; no server code picks a column list by `parentItemId` without the helper.
- No rules loosened; PR 6 only tightens.
- The subitem page's Back, crumb and Close behave as specified with and without `fromBoard`.
- The overlap test fails on `main` and passes on the branch.
- Tokens only; no layout animation; fictional names in tests.

## Showcase, provenance, docs

- Showcase: PR 2 (above); Ophelia re-runs the seeder against production after PR 2 merges.
- Provenance: nothing copied.
- Docs: `docs/architecture.md` (PR 1), `docs/mcp-connector.md` (PR 2), a handoff note per session.

## Owner checks (production)

1. Open a board with subitems: the subitems show the board's columns (for example Status, Actionable, Task Type) with their own values; the old Owner / Status / Date values are where the approved list said.
2. Expand a parent in a long group: the next item row moves down; nothing is covered. Add a subitem: still nothing covered.
3. Open an item's full page and click a subitem: its own page opens; the parent crumb and Back return to the parent.
4. On a subitem: write a description with an image, post an update, upload a file in a Files column, press a Button column.
5. Ask Claude (connector) for a board with subitems: values are listed under the board's column titles.

## Risks

- **Data loss in the migration.** Mitigated by the dry run, the owner's approval, reading every state, field-path writes and keeping moved columns' ids. Firestore scheduled backups are on for `atrium-1`.
- **Columns crowd the subitem block.** A board with many columns now shows them all on subitems, as monday does; the view's hidden columns apply.
- **Required columns on subitems.** A required board column now also counts on subitems (the hint and the rules). That is consistent with shared columns, but the owner may see new "required" hints on old subitems.
- **Transition window.** Between PR 1 and the migration, nothing changes for users (fallback). Between the migration and PR 2's deploy (minutes), a cached web build may still create default subitem columns on a board's first subitem; the migration is rerunnable and PR 6's rules end it.
- **SIDEBAR PR 2 collision** on `subitemSummary`'s columns argument and the item card: whichever lands second adapts (noted above).
- **Virtualizer fix** may change scroll behaviour in big groups; test with the 1000-item seed.
