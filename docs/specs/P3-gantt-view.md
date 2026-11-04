# P3: Gantt view (build spec)

**Roadmap:** Gantt view (`3306219696`, P3, High). **Author:** Ophelia (Opus 5.5). **Implementers:** Sonnet 5.5 subagents. Builds on the Timeline view (`apps/web/src/components/board-timeline/`, shared date-view model in `board-date-views/`) and the Dependency column (`packages/shared/src/columns/dependency.ts`, `dependency-graph.ts`).

## What the owner gets

A board view type **Gantt**: items as bars over time, grouped like the Timeline, with **arrows between dependent items**, a **baseline** (the planned dates drawn under each bar) and an optional **critical path** highlight. It is the Timeline plus dependencies; where the two overlap, the Gantt reuses the Timeline code, it does not copy it.

## Behaviour

- Same axis, zoom (days / weeks / months), groups, today line, weekend shading, colour-by and legend as Timeline. Bars are draggable and resizable exactly as in Timeline (reuse `planDrag` / `planBarChange`).
- **Dependency arrows.** The Gantt setting `dependencyColumnId` picks a Dependency column. Item A's `item_ids` are A's prerequisites (A depends on X), so an arrow goes from the **end of X's bar** to the **start of A's bar** (finish-to-start). Drawn as one absolutely positioned SVG layer over the grid from each bar's `(startIdx, endIdx, row)` and its lane's top row (`windowLanes` gives the lane offsets); elbow connectors with an arrowhead, `pointer-events: none` except the line itself (hover highlights both items). Arrows for a collapsed lane attach to the lane's summary bar. Arrows whose endpoint is outside the rendered row window are clipped, not computed from missing bars.
- **Violations.** When a prerequisite ends after its dependent starts, the arrow is drawn in the danger colour with a tooltip ("Starts before X finishes"). Nothing is auto-shifted. If the Dependency column has `strict: true`, the same state is shown but still never blocks a drag (web only; enforcement is out of scope).
- **Baseline.** Setting `baselineColumnId` picks a second Timeline or Date column (not the bar column). Each item with a value gets a thin bar under its main bar in a muted token colour. A header toggle shows or hides it.
- **Critical path.** Toggle `showCriticalPath`. Longest chain by duration through the dependency graph (use `topologicalSort` and a longest-path pass over bar durations in days; ties broken by item order). Items on it get a stronger bar outline and their arrows the accent colour. If the graph has a cycle (can't happen through the UI because `canAddDependency` blocks it, but data may be edited elsewhere), skip the highlight and show a notice in the settings panel.
- **Empty and error states** as in Timeline: no timeline/date column, no dated items, no Dependency column (arrows simply absent; the settings panel explains).
- Items without dates sit in the same "no dates" list as Timeline.

## Data and settings

- `viewTypeSchema` gains `'gantt'`. `viewSettingsSchema` gains `gantt?: ganttSettingsSchema` with `{ columnId, zoom, colorBy, collapsedGroupIds, showGroupSummary, showToday, showWeekends, showLegend, dependencyColumnId, baselineColumnId, showBaseline, showCriticalPath }`, defaults in `defaultGanttSettings()` (it extends or reuses `timelineViewSettingsSchema` rather than redefining the shared fields).
- `firestore.rules` view create/update: add `'gantt'` to the type allow-list and `'gantt'` to the settings `hasOnly` key list; `tests/rules` cases for creating, reading and updating a gantt view (allowed for board editors like other views, denied for viewers) and for an unknown key.
- Web: `viewActions` `newViewSettings(type)` case; remove Gantt from `SOON_VIEWS` and add its icon to `VIEW_ICONS` in `board-views/ViewTabs.tsx`; add the `ViewBody` case in `pages/BoardPage.tsx` (the `never` check forces it); the filter store's `TypeSettingsMap` / `TYPE_KEYS` / `TYPE_DEFAULTS`; `board-views/view-permissions.ts` if it lists types.
- Showcase: `scripts/showcase/data.mjs` gets a Gantt view on the showcase project board with a Dependency column and a few dependent items, plus baseline dates (rule 10 in AGENTS.md; a test checks coverage of column types with web cells, so check `scripts/showcase` tests still pass).

## Code layout

`apps/web/src/components/board-gantt/`: `GanttView.tsx` (wraps or composes the Timeline grid: extract the shared grid from `TimelineView.tsx` into a component both use, **only if** that is a small, safe refactor with the Timeline tests unchanged; otherwise compose `buildTimeline` output inside a new grid and note the duplication), `gantt-model.ts` (pure: `buildGantt(input)` = `buildTimeline` + `edges`, `baselines`, `criticalIds`; unit tested), `gantt-geometry.ts` (arrow path computation, pure, unit tested), `GanttArrows.tsx`, `GanttSettingsPanel.tsx`, `gantt.module.css`, `gantt-store.ts` if session-only UI state is needed (pattern: `timeline-store.ts`). Tokens only (`apps/web/src/theme/timeline-tokens.css` is where Timeline's tokens live; add `--atrium-gantt-*` tokens in a new `gantt-tokens.css` imported where the others are, not in `tokens.css`). No animation of layout properties; respect `prefers-reduced-motion`.

## PR split

- **G1 (this spec's first build):** view type end to end (shared schema, rules and tests, web wiring) plus bars, arrows and violations. Hot spots touched: `packages/shared`, `firestore.rules`, `tests/rules`, visual baselines.
- **G2:** baseline, critical path, settings panel options, showcase data, visual tests and baselines. (If G1 is already large, move the settings panel's extra options here.)

## Tests and QA

- Unit: `gantt-model` (edges from prerequisites; violation detection; critical path on a diamond and a chain; cycle guard), `gantt-geometry` (arrow endpoints for same-row, different-row, reversed order).
- Component: renders arrows for a two-item dependency; no arrows without a Dependency column; the settings panel updates settings.
- Visual: add `board-gantt-{light,dark}` screens to `tests/visual` (seed a board with dependencies in `tests/visual/src/seed.ts`); run the baselines workflow on the PR.
- QA: compare side by side with monday's Gantt in light and dark; gaps go to the VF group.
