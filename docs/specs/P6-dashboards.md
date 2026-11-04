# P6: dashboards (build spec)

**Roadmap:** Dashboard framework (`3306248743`), Dashboard widgets (`3306251300`), Aggregation service (`3306259044`). **Author:** Ophelia (Opus 5.5). **Implementers:** Sonnet 5.5 subagents. Reuses the Chart view code (`apps/web/src/components/board-chart/`) and the My Work multi-board listener (`apps/web/src/data/my-work.ts`).

## What the owner gets

A new kind of object, the **dashboard**: a page of widgets that read from several boards. It lives in the sidebar next to boards and folders, in a workspace. v1 widgets: **Chart** (the Chart view's bar/stacked/line/pie/donut over one or more boards), **Numbers** (count, sum, average, min or max of a column, with an optional status/filter), **Battery** (progress by status, as monday's battery), **Table** (a filtered item list across boards: name, board, status, person, date) and **Workload** (items per person over time; after the Workload view). Widgets can be added, titled, resized and dragged around a grid, and removed.

## Data model

New top-level collection `dashboards/{dashboardId}` (not inside a workspace, like boards, so access checks are one document), schema `dashboardSchema` in `packages/shared/src/schemas/dashboard.ts`:

- `workspaceId`, `folderId` (nullable), `position` (fractional index, as boards), `name` (max 80), `icon` (nullable), `state` (`active|deleted`, `deletedAt`, the same trash flow as boards).
- `kind`: `'private' | 'shareable' | 'main'` and `access` / `accessUids`, **the same model as boards** (`roles.ts`: owner/editor/viewer), so sharing, the `resolveBoardRole` helpers and the Share dialog patterns carry over.
- `boardIds`: up to 50 board ids the dashboard reads from (`DASHBOARD_LIMITS`).
- `widgets`: up to 24, each `{ id (slug), type: 'chart'|'numbers'|'battery'|'table'|'workload', title (max 80), layout { x, y, w, h } (grid units, 12 columns, w 2 to 12, h 2 to 12), boardIds (subset of the dashboard's, empty = all), settings (per-type, discriminated union with `.strict()` per type) }`.
- Standard audit fields.

A dashboard stores **no item data**: widgets compute from live item listeners on the boards, under each board's own read rules. A viewer of the dashboard who cannot read one of its boards simply sees that board's data missing, with a note ("1 board you can't access is hidden"). No board data is copied into the dashboard, so nothing can leak through it.

## Rules (`firestore.rules`) and tests

- `dashboards/{id}`: read if `signedIn()` and the user is in `accessUids` (or, for `main` kind, a member of the workspace, mirroring boards); create requires workspace membership with the same helper boards use (`canCreateInWs`), `access == {uid: 'owner'}`, `boardIds` within limit; update by owners and editors for widgets/name (a `hasOnly` shape check like boards), by owners only for `access`, `kind`, `accessUids`; delete is a soft state change by owners. Widget internals are validated by zod on the client; rules check only the outer shape (`widgets` is a list of at most 24, `boardIds` at most 50).
- `tests/rules/src/dashboards.test.ts`: allow/deny per role (owner, editor, viewer, workspace member without access, non-member, signed out) for read, create, widget update, access change, delete; shape violations (25 widgets, 51 boards).
- Favourites and recents (`users/{uid}/favorites`, recents) are keyed by board id only. **Out of scope for v1:** dashboards cannot be favourited. (Generalising those schemas and their rules is its own change.)

## Web

- **Sidebar and tree:** `DashboardNode { type: 'dashboard', dashboard }` in `apps/web/src/data/boards.ts` (`TreeNode` union, `buildTree`, `flattenTree`, `dashboardKey`), rendered in `components/Sidebar/SidebarTree.tsx` with a dashboard icon, drag and drop in `data/treeDnd.ts` (same folder/position rules as boards), "Dashboard" in `components/Sidebar/AddMenu.tsx`, `WorkspaceLists.tsx`, and a `newDashboard` dialog in `components/AppShell/ui-store.ts` (name; kind). Route `dashboards/:dashboardId` in `App.tsx`. Mind the existing guard from PR #78 (`dragClickGuard`) in the new tree rows.
- **Data:** `data/dashboards.ts` (queries, writes, hooks `useDashboard`, `useWorkspaceDashboards`, following `data/firestore.ts` and `data/hooks.ts` patterns) and `data/dashboard-items.ts`: `useDashboardItems(boardIds)` generalised from `useMyWorkItems` / `useReadableBoards` (one listener per board using `queries.activeItems`, capped at `MY_WORK_BOARD_CAP`, with `truncatedFrom`, loading and error states; unreadable boards are reported, not thrown).
- **Widget engine** (`apps/web/src/components/dashboard/`): `DashboardPage.tsx`, `DashboardGrid.tsx` (CSS grid, 12 columns; dragging and resizing with dnd-kit, `transform`-only motion, keyboard move/resize with arrow keys; layout normalisation pure in `dashboard-layout.ts`, unit tested: collision resolution, clamping, compaction), `WidgetFrame.tsx` (title, menu: edit, duplicate, remove), `AddWidgetDialog.tsx`, `widgets/{ChartWidget,NumbersWidget,BatteryWidget,TableWidget,WorkloadWidget}.tsx` and a pure `widgets/*-model.ts` per type (unit tested).
- **Chart widget:** export the currently private accumulator helpers from `board-chart/chart-model.ts` (`newAcc`, `mergeAcc`, `accValue`, `makeReader`, `bucketKey`, `mergeRows`) and add `buildMultiBoardChartModel(inputs[])` that runs the one-pass builder per board and merges buckets by key; reuse `ChartSvg` and `chart-geometry.ts` unchanged. Group/status labels differ per board: merge by label text for status, by uid for people, by date bucket for dates; document that in the model's header comment.
- **Numbers / Battery:** a column picker restricted to compatible types (numbers, status, formula where the registry marks it numeric); aggregation done with the column registry's value readers so formula and derived columns work as on the Chart view.
- **Table widget:** reuse My Work row building where possible (`pages/my-work/my-work-model.ts`) and the read-only cell renderers (`columns/` `Cell` components in read-only mode).
- Tokens only (new `theme/dashboard-tokens.css`), Vibe components, empty/loading/error states as VF3, respect `prefers-reduced-motion`.

## PR split

- **C1:** shared schema, rules and tests, data layer, `dashboard-layout.ts`. Hot spots: `packages/shared`, `firestore.rules`, `tests/rules`.
- **C2:** sidebar/tree/route/new-dashboard dialog and an empty dashboard page with the grid and Add widget, with the **Numbers** and **Battery** widgets (so the page is useful at once).
- **C3:** Chart and Table widgets (+ chart-model exports).
- **C4:** Workload widget (after the Workload view lands), drag/resize polish, share dialog reuse, trash and restore, showcase dashboard in `scripts/showcase/data.mjs` (the showcase seed also needs `isOwnedPath` extended for dashboards), visual screens `dashboard-{light,dark}` and baselines.

## Tests and QA

Unit: layout engine, each widget model (counts and sums across two boards, empty boards, formula columns, status label merge), tree building with dashboards. Rules per role. Component tests for the grid keyboard moves and the widget dialog. QA against monday's dashboards in light and dark; gaps to the VF group. Owner check list gets a "Dashboards" section (create one, add each widget, resize, share with a second account).
