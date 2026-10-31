# P3: Chart view

Author: Ophelia (Opus 5.5) · Implementer: Ophelia's Sonnet subagent · Roadmap: P3 "Chart view" (3306219644) · Branch `claude/view-chart`

## Goal

A Chart board view next to Table, Kanban, Calendar and Timeline, as in monday. It charts the board's own items (after the view's filters, search and person filter) as a bar, stacked bar, line, pie or donut chart. The X axis groups items by a column or by board group. The Y axis counts them, or sums, averages or takes the min or max of a Numbers column. The settings are saved to the view with "Save to this view", like the other view types.

## Facts (code at `48e4f1e`)

- **View types:** `viewTypeSchema = z.enum(['table','kanban','calendar','timeline'])` (`packages/shared/src/schemas/view.ts:46`). Per-type settings are optional keys in `viewSettingsSchema` (`:136-145`), with a `defaultXSettings()` each.
- **Rules:** `viewSettingsOk` (`firestore.rules:429-443`) uses `hasOnly([... 'kanban','calendar','timeline'])` plus `is map` per key. `viewBodyOk` (`:450`) checks `d.type in [...]`. Settings aren't deep-validated in rules; zod does that.
- **Rules tests:** `tests/rules/src/views.test.ts:190` ("allows calendar and timeline views ...") and `:203` (unknown key, non-map). Copy those two cases.
- **Column dependents:** `columnDependents` in `packages/shared/src/columns/convert.ts:695-706` lists the views that read a column (for the change-column-type warning). The chart's column ids must be added there.
- **Web lists to extend:** `board-views/view-actions.ts:30` (`LABELS`) and `:36-55` (`newViewSettings`, exhaustive `never`); `ViewTabs.tsx:50` (`VIEW_ICONS`), `:52-56` (`SOON_VIEWS` has a disabled "Chart" with the `Chart` icon already imported) and the "+ Add view" menu (`:301-331`); `pages/BoardPage.tsx:120-135` (`ViewBody` switch); `board-filters/filter-store.ts:28-40` (`TypeSettingsMap`, `TYPE_KEYS`, `TYPE_DEFAULTS`) and `ViewState`; `board-table/BoardToolbar.tsx:30` (`variant`).
- **Reusable model code:** `board-date-views/date-view-model.ts`: `selectItems` (filters, search, person filter, skips subitems, board order), `statusColumns`, `cardLabel`-based label colours, `buildLegend`; `DateViewParts.tsx` (`ColorLegend`). The settings panel to copy is `board-timeline/TimelineSettingsPanel.tsx` (right-hand panel, collapsible sections, dirty state saved through the toolbar).
- **Numbers:** `numbers` values are numbers; settings `{ unit, decimals }`, and `columnRegistry.toText` formats them (`columns/numbers.ts`). People values are `{ personsAndTeams: [{ id, kind }] }`, dropdown values are `{ ids: number[] }` with labels that have **no colour**, status values point at labels with a hex `color`.
- **Dependencies:** `apps/web` has no chart or SVG library (only `@dnd-kit`, `@tanstack/react-virtual`, Tiptap, Vibe, zustand). Don't add one.
- **Reference:** monday's Chart view isn't on the owner's plan, so there are no measurements. Use the help-centre article "The Chart View" and its screenshots (read it before building), plus Vibe and our existing tokens. A fidelity pass follows if a capture becomes available.

## Design decisions

1. **Chart types (v1):** `bar` (vertical columns, monday's "Bar"), `stacked_bar`, `line`, `pie`, `donut`. No number card in v1 (that's the dashboard Numbers widget, P8), no horizontal bar, no stacked line. Default `bar`.
2. **X axis** (`xColumnId`): a status, people, dropdown, date or timeline column, or `__group` (board groups). Null = the board's first status column, else groups. Date and timeline (by `from`) bucket by `dateBucket`: `day`, `week` (ISO weeks starting Monday; reuse the week-start helper from `columns/week.ts`) or `month`. Default `month`.
   - People and dropdown are multi-value: an item counts once in **each** of its buckets (monday does the same). Pie percentages are then over the bucket total, not the item count; the hidden table says so.
   - Items with no value go into an "Empty" bucket (`__empty`), shown when `showEmpty` is on.
   - Bucket order: status labels by `index`, groups by position, dropdown labels in settings order, people by name, dates ascending; `sortBy` can override it (`value_desc`, `value_asc`). Date buckets always stay in time order, and gaps between dates are filled with zero buckets so a line doesn't lie.
3. **Stack** (`stacked_bar` only, `stackColumnId`): a status column, `__group`, or a people or dropdown column, different from X. Null = the first status column that isn't X, else groups.
4. **Y axis** (`yMode`): `count` (default), `sum`, `average`, `min`, `max` of `yColumnId`, which must be a Numbers column. Empty numbers are skipped (they don't count as 0 for average/min/max). A bucket with no numbers shows 0 for `sum` and no value for the others (no bar; a gap in the line). If `yColumnId` is missing or not Numbers, fall back to `count` and show the fallback in the panel. Values are formatted with the column's unit and decimals.
5. **Colours:** status buckets use their label colour; groups use the group colour; people, dropdown and date buckets cycle through 12 new series tokens `--atrium-chart-series-1..12`, each an alias of a Vibe `--color-*` token (Vibe has no chart palette). Empty uses `--atrium-chart-empty` (alias of the empty-status grey). An unstacked `bar` with an X that has colours uses them per bar; `line` uses `--atrium-chart-series-1` (primary). Hex label colours from data go in `fill` via a CSS variable on `style` (`--bar-color`), never as literals in code.
6. **Limits:** the board already loads all its items, and the chart computes from them client side: no new query, index or Function. The model is one O(n) pass, memoised on items, settings and filter state, and must take under 50 ms for 10,000 items (a unit test times it loosely). Bar and line show at most **50** X buckets and stacks at most **12** series; pie and donut at most **12** slices. Anything beyond that merges into "Other" (smallest buckets first). Date buckets cap at 50 by widening (`day` → `week` → `month`) and say so in a note under the chart.
7. **Settings UI:** a **right-hand side panel**, as on monday's Chart view and our Timeline, opened from the toolbar gear. Sections: Chart type (icon buttons), X axis (column dropdown, then date bucket when relevant), Y axis (Count / Sum / Average / Min / Max, then the Numbers column; disabled with a tooltip "Add a Numbers column" when the board has none), Stack by (stacked bar only), View settings (Show legend, Show values, Show empty, Sort). Changes apply at once and mark the view dirty; "Save to this view" in the toolbar saves them.
8. **Drawing:** hand-drawn SVG in React, sized by a `ResizeObserver` hook. Pure geometry functions (nice ticks with 4 to 6 steps, band scale, stacked offsets, pie arc paths, label truncation) live in `chart-geometry.ts` with tests. No animation in v1 beyond a hover opacity change.

## Settings (shared)

```
chart: {
  chartType: 'bar' | 'stacked_bar' | 'line' | 'pie' | 'donut'   // default 'bar'
  xColumnId: string | null           // column id or '__group'; null = first status column, else groups
  dateBucket: 'day' | 'week' | 'month'                           // default 'month'
  stackColumnId: string | null       // stacked_bar only; null = default as above
  yMode: 'count' | 'sum' | 'average' | 'min' | 'max'           // default 'count'
  yColumnId: string | null           // a numbers column; null with a non-count yMode = first numbers column
  sortBy: 'board' | 'value_desc' | 'value_asc'                 // default 'board'
  showLegend: boolean; showValues: boolean; showEmpty: boolean // defaults true, true, true
}
```

Export `chartSettingsSchema`, `ChartSettings`, `defaultChartSettings()`, `CHART_GROUP_AXIS = '__group'`, `CHART_EMPTY_BUCKET = '__empty'` and `CHART_LIMITS = { xBuckets: 50, series: 12, slices: 12 }` from `@atrium/shared`. A stale column id falls back to the default, like the other views.

## Rules (hot spot, minimal)

- `viewSettingsOk`: add `'chart'` to `hasOnly` and `(!('chart' in s.keys()) || s.chart is map)`. `viewBodyOk`: add `'chart'` to the type list. Nothing else changes.
- Tests: extend `:190` to allow a chart view with and without settings, and `:203` to refuse non-map `chart`. The `main`-stays-a-table and immutable-`type` tests get one chart case each.

## Web UI

- **Toolbar:** `BoardToolbar` `variant="chart"`: Search, Person, Filter; no New item, Sort, Hide, Group by or battery. On the right, the gear toggles the settings panel.
- **Layout:** the chart fills the view under the toolbar on the board background, with a title row in the chart card ("Items by Status", or "Sum of Budget by Owner"). Axes and grid lines in the table border token, tick labels in secondary text, values above bars (or inside slices when there's room) when `showValues`. The legend (`ColorLegend`) sits centred under the chart when `showLegend`, for stacked bar, pie and donut, and for bar when the bars have colours. Donut shows the total in its centre.
- **Hover and focus:** a tooltip (Vibe `Tooltip`-styled, positioned in the SVG layer) shows "Done · 5 items · 42%" or "Owner: Avery Quinn · €1,200". Bars and slices dim the others to `opacity` on hover.
- **States:** loading shows the Vibe `Loader`; a load error shows the shared error line; a board or filter with no items shows "No items to chart" with a hint to clear filters (reuse the VF3 empty-state component). A board with no status column still works (groups).
- **Click** on a bar or slice does nothing in v1 (monday drills down; out of scope).
- **Accessibility:** the SVG has `role="img"` and an `aria-label` summary ("Bar chart, items by Status: Done 5, Working on it 3, Stuck 1"; the first 10 buckets, then "and N more"). A visually hidden `<table>` next to it lists every bucket (and series) with its value, which screen readers read in full. A toolbar toggle "Show as table" isn't in v1. Respect `prefers-reduced-motion` for the hover transition.
- **Tokens:** new `apps/web/src/theme/chart-tokens.css` (geometry, fonts, series aliases, empty, grid; light and dark through Vibe variables), imported where the other view token files are. Stylelint and the ESLint style rule must pass with no disables.

## Files (one PR)

- `packages/shared/src/schemas/view.ts`, `view.test.ts`; `packages/shared/src/columns/convert.ts` (+ its test: chart column ids are dependents); `packages/shared/src/index.ts` only if the exports need it.
- `firestore.rules`; `tests/rules/src/views.test.ts`.
- `apps/web/src/components/board-chart/`: `ChartView.tsx`, `chart-model.ts` (buckets, aggregates, Other, ordering, colours), `chart-geometry.ts`, `ChartSvg.tsx` (bar, stacked, line, pie, donut), `ChartSettingsPanel.tsx`, `chart.module.css`, with `chart-model.test.ts`, `chart-geometry.test.ts`, `ChartView.test.tsx`, `ChartSettingsPanel.test.tsx`.
- `apps/web/src/theme/chart-tokens.css` (and its import).
- `apps/web/src/components/board-views/view-actions.ts`, `ViewTabs.tsx`; `apps/web/src/pages/BoardPage.tsx`; `apps/web/src/components/board-filters/filter-store.ts` (+ test); `apps/web/src/components/board-table/BoardToolbar.tsx`.
- `scripts/showcase/data.mjs` (a shared "Budget by owner" chart view: `bar`, X `person`, Y sum of `budget`; and "Status mix": `donut` by `status`), `scripts/showcase/showcase.test.mjs` (view count 4 → 6).
- `tests/visual/src/seed.ts` (`addChartView(type)` / `removeChartView()`), `fixtures.ts` (`chartReady`), `screens.spec.ts`: screens `board-chart-bar` (by status, count) and `board-chart-donut` (by group), light and dark; baselines via the workflow.

Hot spots touched: `firestore.rules`, `tests/rules/**`, `packages/shared/**`, `tests/visual/__screenshots__/**`. **Open #51 (`claude/item-index`) touches `packages/shared`; start the branch now but open this PR after #51 merges**, then rebase.

## Out of scope

Number card, horizontal and stacked line or area charts, drill-down on click, cross-board charts and dashboard widgets (P8), formula, mirror or rating columns on Y, per-bucket hiding, custom colours, export as image or CSV, and "Show as table".

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build`, `pnpm licenses:check` (unchanged lockfile) all green; CI `visual` green with the two new screens reviewed.
- Unit tests cover: each X kind (status, people multi-value, dropdown, date day/week/month with gap filling, timeline `from`, groups), empty bucket on and off, each Y mode with empty numbers, stale ids, Other merging and date widening at the caps, sort orders, colour choice, the aria summary text, the 10,000-item timing, and the panel's dirty/save behaviour.
- In the emulator: add a Chart view, try every type and axis, filter and search, save, reload, and see the settings come back; a viewer sees the chart but can only save a personal view.
- QA against the help-centre screenshots in light and dark; log gaps in the VF group.

## Privacy

Fictional names only in seeds and tests (see `AGENTS.md`).
