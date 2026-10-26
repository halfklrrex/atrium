# P3: Saved board views (view tabs, per-view filters, Hide columns)

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: P3 "Saved & personal views" · Branch `claude/p3-saved-views` · Worktree `ATRIUM_PORT_OFFSET=20`

## Goal

As in monday, a board has **view tabs**: "Main table" plus any number of saved views. Each view remembers its own filters, sort, group-by and hidden columns. This PR builds the view framework with the **table** view type only. Kanban follows in `P3-kanban.md`, plugging into the same framework.

## Facts (code at `323b770`)

- **Tabs today:** `BoardHeader.tsx:136-153` renders a single "Main table" `Tab`, and its "+" only shows "coming soon". `BoardPage.tsx:61-71` always renders `BoardTable`.
- **Routes:** `App.tsx:24-25` has `boards/:boardId` and `boards/:boardId/items/:itemId`. `docs/architecture.md:55` reserves `/boards/:boardId/views/:viewId`.
- **Data model:** `docs/architecture.md:119` reserves `boards/{boardId}/views/{viewId}`: `type, name, settings, ownerId|null` (null means a shared view).
- **Filter state:** in `filter-store.ts` (`useFilterStore`, zustand, memory only, keyed by board). The `BoardFilterState` type is in `packages/shared/src/filters/types.ts` (plain TS, no zod).
- **Search:** in `useTableStore.search`.
- **Hide:** a disabled placeholder (`BoardToolbar.tsx:114-121`). `ColumnDef.hidden` exists but is unused.
- **Rules:** there's no `views` match block, so everything under it is denied today.

## Data

- **`boards/{boardId}/views/{viewId}`:**
  ```
  name: string (1-60)
  type: 'table' | 'kanban'
  position: string            // fractional index, same helper as items
  ownerId: string | null      // null = shared view; uid = personal view (only its owner sees it)
  settings: {
    filter: { personIds: string[], filterGroup: FilterGroup, sortConditions: SortCondition[], groupByColumnId: string|null }
    hiddenColumnIds: string[]  // board column ids hidden in this view
    kanban?: { ... }           // defined by P3-kanban.md; absent for tables
  }
  createdAt, createdBy, updatedAt, updatedBy
  ```
  - Search text is **not** saved; it stays per session, as in monday.
- **Main table** is the view with the fixed id **`main`**, type `table`, position `a0`, shared.
  - It's created lazily: the first time an editor saves settings to it. Until then the client treats a missing `main` as default settings.
  - It can't be deleted or renamed. Its name stays "Main table".
- **Schemas:** add zod schemas to `packages/shared` (for example `schemas/view.ts`): `boardViewSchema`, plus zod versions of `FilterCondition`, `FilterGroup` and `SortCondition`, which the existing TS types can derive from. Add size caps: at most 50 conditions, 10 sort conditions, 200 hidden column ids and 200 person ids.

## Rules (`firestore.rules`, hot spot: one new nested match block plus tests)

`match /views/{viewId}` inside `match /boards/{boardId}`:

- **read:** `canReadBoard` and (`resource.data.ownerId == null` or `resource.data.ownerId == uid()`).
- **create:**
  - **shared** (`ownerId == null`): `canEditBoard`;
  - **personal** (`ownerId == uid()`): `canReadBoard`, so viewers may keep personal views.
  - Both need an exact key set, `type in ['table','kanban']`, a name of 1-60, `position` as a string, `settings` as a map, `createdBy == uid()` and timestamps equal to `request.time`.
  - If `viewId == 'main'`: `ownerId == null` and `type == 'table'`.
- **update:**
  - **shared:** `canEditBoard`; **personal:** the owner only.
  - `ownerId`, `type`, `createdAt` and `createdBy` are immutable. Name and position can't change for `main`. `updatedBy == uid()`.
- **delete:** the same as update, and **never** for `main`.

Tests go in `tests/rules/src/views.test.ts`:

- shared versus personal visibility (a list query by a non-owner must not return personal views; use `where('ownerId','in',[null, uid])` on the client);
- viewer versus editor writes;
- the immutable fields;
- `main` being undeletable and unrenamable;
- an outsider being refused.

## Web

- **Routes:**
  - `boards/:boardId/views/:viewId` and `boards/:boardId/views/:viewId/items/:itemId`.
  - `boards/:boardId` opens the **last view used on this board** (localStorage `atrium.lastView.<boardId>`), else `main`.
  - The existing `boards/:boardId/items/:itemId` keeps working (it opens `main`).
  - `itemViewPath` and closing the full view keep the current view.
- **Data hooks:** `useBoardViews(boardId)` subscribes to one query for shared plus own personal views, sorted by position, with `main` synthesised first if missing. Writes go in `viewWrites` (create, rename, duplicate, delete, reorder, saveSettings).
- **Tabs** (`BoardHeader`):
  - One Vibe `Tab` per view, with the type icon (table: `Table`, kanban: Vibe's board or kanban icon) and the name. Personal views show a small person icon.
  - **Tab menu** (right-click or the tab's `⋯` on hover): Rename (inline), Duplicate, Make personal or shared (owner/editor), Delete (with confirm and an undo toast). None of these on `main`, except Duplicate.
  - **Reordering:** drag tabs to reorder (dnd-kit horizontal list), writing `position`. `main` stays first.
  - **"+" opens monday's "Add view" menu:** a Vibe `Menu` with Table and Kanban. Kanban is disabled with the tooltip "Coming soon" until `P3-kanban.md` lands. Calendar, Timeline, Gantt, Chart and Map are also listed, disabled with "Coming soon".
    - Choosing one creates a shared view (personal if the user is a viewer) called "Table" or "Kanban", numbered if the name is taken, positioned last, and navigates to it.
- **Per-view state** (replaces the memory-only per-board state in `filter-store.ts`):
  - **Key** the store by `boardId:viewId`. On entering a view, initialise from the view's saved `settings.filter`.
  - **Unsaved changes:** the store tracks `saved` and `current`. When they differ, the tab shows a small dot, and the toolbar shows monday's **"Save to this view"** button.
    - Editors get it for shared views; owners get it for their personal views. Viewers on a shared view don't get it, so their changes stay session-only.
    - The button writes `settings.filter` (and `hiddenColumnIds`).
    - "Discard changes" sits next to it.
  - Search stays per session and isn't part of "unsaved".
- **Hide columns:** enable the toolbar's **Hide** button. It opens a popover listing the board columns with checkboxes, a search box and "Hide all" / "Show all", like monday.
  - It changes `current.hiddenColumnIds`, which counts as unsaved changes, so "Save to this view" persists it.
  - `buildColumnViews`, or the column list fed to the table, skips hidden ids.
  - The name column can't be hidden.
  - The Hide button shows a count badge when any column is hidden, like the Filter badge.
- **`buildGroupModels`:** keeps taking `filterState`; it now comes from the per-view store. Remove the legacy `useTableStore.sort` path if nothing sets it (`HeaderRow` already routes header sort through the filter store), and update the tests.
- **Showcase:** add one shared view, "Due this week" (a table filtered by date, sorted by date, with two columns hidden), to `scripts/showcase/data.mjs`, plus the seed writes and the allow-list for `boards/showcase-*/views/*`.

## Tests and QA

- **Unit tests:**
  - view schemas;
  - store init, dirty and save;
  - the Hide popover;
  - routes (`/boards/:id` opening the last view);
  - tab menu permissions for viewer, editor and owner;
  - the `main` restrictions.
- **Rules tests** as listed above.
- **QA in the dev server, light and dark:**
  1. Create a view, filter it, save it, reload, and the filters are still there.
  2. Switch to Main table and its filters are separate.
  3. Hide two columns and save.
  4. Rename, duplicate and delete a view, then undo.
  5. As a viewer, create a personal view; another user can't see it.
- **Visual tests:** add a `board-views` screen (two tabs plus the "Save to this view" button visible) and a `board-hide-popover` screen. Regenerate the baselines through the workflow.

## Privacy

The repo is public: follow `AGENTS.md` → Privacy. No real names in test data or screenshots; use the fictional seed users.
