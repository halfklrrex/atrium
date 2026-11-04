# P3: Workload view (build spec)

**Roadmap:** Workload view (`3306293489`, P3, Medium). **Author:** Ophelia (Opus 5.5). **Implementers:** Sonnet 5.5 subagents. Reuses the Timeline axis and date model (`board-timeline/timeline-model.ts` `buildAxis`, `board-date-views/date-view-model.ts` `selectItems`, `itemSpan`) and the People column (`packages/shared/src/columns/people.ts`).

## What the owner gets

A board view type **Workload**: a grid with **one row per person** and **one column per day, week or month**. Each cell shows how much work the person has in that period, with a colour for light, balanced and overloaded. It answers "who is busy when" on one board. (Across boards comes with the dashboard Workload widget.)

## Behaviour

- **Rows:** the people found in the chosen People column(s) of the board's active items (`PeopleValue.personsAndTeams`, `kind: 'person'`; teams are skipped in v1), plus an "Unassigned" row. People appear in alphabetical order; a person with no items in the visible range still shows (for the board members who appear in any item).
- **Columns:** the same axis as Timeline (`buildAxis`, zoom days / weeks / months, today line, weekend shading), scrolling horizontally with the same sticky left pane.
- **Which items count in a period:** an item counts in every day its span covers (`itemSpan` on the chosen date or timeline column). For an item with several assignees it counts fully for each. Items without dates are listed in a "No dates" strip like Timeline.
- **Cell value (`measure` setting):** `count` (number of items) or `sum` of a Numbers column (e.g. "Estimate (h)"). For a multi-day item with `sum`, the value is spread evenly across the item's working days (weekends skipped when `showWeekends` is off) so a 40 h item over 5 days adds 8 h per day; for `count` the item counts once per day. Week and month cells aggregate their days' totals (sum of the day totals).
- **Capacity (`capacityPerDay`, a number, default 1 item or 8 units for `sum`):** a cell is **under** when below 60% of capacity, **balanced** from 60% to 100%, **over** above 100%, shown as a tint from design tokens with the number in the cell (tint + text, never colour alone). The capacity applies to the period (day capacity x days in the cell, skipping weekends if hidden).
- **Interaction:** click a cell to open a popover listing that person's items in that period (name, status chip, dates; click an item to open its card). Reassigning by drag is out of scope for v1.
- Empty, loading and error states as Timeline: no date or timeline column, no People column (with an explanation in the settings panel), no items.

## Settings, rules, wiring

- `viewTypeSchema` gains `'workload'`; `workloadSettingsSchema` = `{ columnId (date/timeline), peopleColumnId, zoom, measure: 'count'|'sum', sumColumnId, capacityPerDay, showWeekends, showToday, collapsedPersonIds? }` with `defaultWorkloadSettings()` in `packages/shared/src/schemas/view.ts`.
- `firestore.rules`: add `'workload'` to the view type list and the settings `hasOnly` list; `tests/rules/src/views-workload.test.ts` (pattern: `views-gantt.test.ts` from PR #83): editor create/update, viewer denial, non-map and unknown keys.
- Web: `view-actions.ts` (`newViewSettings`), `board-views/ViewTabs.tsx` (add to the add-view menu and `VIEW_ICONS`; Workload is not in `SOON_VIEWS` today, add it as a normal entry), `pages/BoardPage.tsx` `ViewBody`, `board-filters/filter-store.ts` (`TypeSettingsMap`, `TYPE_KEYS`, `TYPE_DEFAULTS`), `BoardToolbar` variant if needed.
- New `apps/web/src/components/board-workload/`: `workload-model.ts` (pure, unit tested: `buildWorkload(input)` returns rows, cells, totals, over-capacity flags and the no-dates list), `WorkloadView.tsx` (reuse the Timeline's axis header and scroll container pieces where cleanly exportable; do **not** copy large chunks), `WorkloadCell.tsx`, `WorkloadPopover.tsx`, `WorkloadSettingsPanel.tsx`, `workload.module.css`, tokens in `theme/workload-tokens.css` (under, balanced, over tints for light and dark, contrast-checked against the cell text with `textToneFor`-style logic). No layout animation; respect `prefers-reduced-motion`.
- The dashboard Workload widget (C4) will call `buildWorkload` per board and merge rows by person, so keep the model free of React and board-specific hooks.
- Showcase: a Workload view on the showcase project board (extend `scripts/showcase/data.mjs`; a test checks column-type coverage, make sure it still passes).

## PR split

- **W1:** view type end to end (schema, rules and tests, web wiring), the model with unit tests, the grid with cells and the popover. Hot spots: `packages/shared`, `firestore.rules`, `tests/rules`, visual baselines.
- **W2 (if W1 is large):** settings panel options (measure, capacity), showcase data, visual screens `board-workload-{light,dark}` and baselines.

## Tests and QA

Unit: spreading a multi-day estimate across working days with and without weekends; multi-assignee counting; week/month aggregation; capacity thresholds at exactly 60% and 100%; items without dates; unassigned row; teams skipped. Component: renders the grid, opens the popover, empty states. Visual: new screens and the baselines workflow on the PR. QA against monday's Workload in light and dark.
