# P3: Calendar and Timeline views

Author: Ophelia (Opus 5.5) · Implementer: Ava (Antigravity) · Roadmap: P3 "Calendar view" (3306293127) and "Timeline view" (3306219643) · Branches `ag/view-calendar`, then `ag/view-timeline`

## Goal

Two more board views next to Table and Kanban, as in monday:

- **Calendar:** items placed on a month or week grid by a date or timeline column. Drag an item to another day to reschedule it; click a day to add an item on that date.
- **Timeline:** one row per item, grouped by board group, with a bar from the item's timeline (or date) column on a horizontal day axis. Drag a bar to move it, drag its ends to change its dates.

Both use the saved-views framework (`docs/specs/P3-saved-views.md`) and behave like Kanban for filters, search, person filter, permissions and the full item view.

## Split into two PRs

1. **PR 1, `ag/view-calendar`:** the shared schema and rules for **both** types, plus the Calendar view. The schema and rules files are hot spots, so they change once.
   - **Start it only after column locks merges.** Locks also changes `firestore.rules` and `packages/shared`, and hot-spot files get one open PR at a time.
   - It doesn't overlap the cells PRs, so it can be open at the same time as cells PR B or C.
2. **PR 2, `ag/view-timeline`:** the Timeline view, web only. Open it after PR 1 merges.

## Facts (code at `6c0102d`)

- **View types:** `viewTypeSchema = z.enum(['table','kanban'])` (`packages/shared/src/schemas/view.ts:46`). Per-type settings are flat optional keys in `viewSettingsSchema` (`:81-86`), like `kanban`.
- **Rules** (`firestore.rules:371-436`):
  - `viewSettingsOk` (`:386`) has `settings.keys().hasOnly(['filter','hiddenColumnIds','kanban'])` and `kanban is map` (`:395`).
  - `viewBodyOk` checks `d.type in ['table','kanban']` (`:402`).
  - The rules don't deep-validate settings; zod does, on the client and in the seeds.
- **Rules tests:** `tests/rules/src/views.test.ts` (Kanban allow case `:177`, `main` restrictions `:189-`, immutability `:241-`).
- **Web, hard-coded type lists:**
  - `board-views/view-actions.ts:28` (`LABELS`) and `:52-55` (default settings);
  - `ViewTabs.tsx:50` (`VIEW_ICONS`); `SOON_VIEWS` (`:52-58`) already lists Calendar and Timeline as disabled "Coming soon" entries, with their `@vibe/icons` imported;
  - the dispatch in `pages/BoardPage.tsx:118-123` (`ViewBody`);
  - `board-filters/filter-store.ts`: `ViewState.kanban` and its clone, merge, equality and `setKanban` plumbing (`:21`, `:47`, `:53-56`, `:74`, `:84`, `:280-293`), and `useKanbanSettings` (`:327`).
- **Pattern to copy:** `components/board-kanban/` (`KanbanBoard.tsx`, `kanban-model.ts`, `KanbanSettingsPopover.tsx` and their tests).
  - Items come from `useItems`, and columns from `buildColumnViews`.
  - Filters go through `matchesFilter`, search through `itemMatchesSearch`, and subitems are skipped.
  - Writes use optimistic `patches`, then `tableActions.setCell`, which validates through `validateCellWrite` and writes `values.<colId>` as a field path.
  - The toolbar is `BoardToolbar` with a `variant`.
  - Drag and drop uses `@dnd-kit/core`.
- **Date values:**
  - `date` is `{ date: 'YYYY-MM-DD', time?: 'HH:MM:SS' | null }` (`columns/date.ts`).
  - `timeline` is `{ from, to }`, with `from <= to` enforced (`columns/timeline.ts`; `getTimelineDurationDays` is inclusive).
  - `week.ts` already has a `firstDayOfWeek: 'monday' | 'sunday'` setting with a week-start helper. Reuse that helper, or move it to a shared spot. Don't write a second one.
- **No date library** in `apps/web`. Do the date maths over ISO strings and UTC `Date`s in one small module with unit tests. Don't add a dependency for it.
- **No monday reference yet:** `docs/reference/monday-ui-reference.md` has no Calendar or Timeline measurements. Ophelia adds a "Measured monday reference" section to this spec before PR 1 starts. Its values override the layout notes below wherever they differ.

## Settings

Add both to `viewSettingsSchema` with defaults, limits and tests in `view.test.ts`, and export them from `@atrium/shared`.

```
calendar: {
  columnId: string | null          // date or timeline column; null = first date column, else first timeline column
  mode: 'month' | 'week'           // default 'month'
  colorBy: string | null           // a status column id: items take their label colour; null = group colour
  showWeekends: boolean            // default true
  firstDayOfWeek: 'monday' | 'sunday'  // default 'monday', same as the week column
}

timeline: {
  columnId: string | null          // timeline or date column; null = first timeline column, else first date column
  zoom: 'days' | 'weeks' | 'months'  // default 'weeks'
  colorBy: string | null           // as above
  collapsedGroupIds: string[]      // capped like Kanban's collapsedLaneIds
}
```

- The month or week on screen and the timeline's scroll position are **UI state**: keep them per view in memory for the session, and don't save them to the view.
- A `columnId` that no longer exists, or isn't a date or timeline column, falls back to the default. If the board has no usable column, the view shows an empty state ("Add a date or timeline column to use this view") with an "Add column" button that opens the existing add-column menu.

## Rules and rules tests (PR 1)

- `viewSettingsOk`: allow the `calendar` and `timeline` keys, each `is map`.
- `viewBodyOk`: allow the types `calendar` and `timeline`.
- **Tests:**
  - allow each new type with and without its settings;
  - refuse an unknown settings key;
  - `main` must stay a table;
  - `type` stays immutable (table to calendar refused).
- Nothing else in the views rules changes.

## Shared web plumbing (PR 1, used by both)

- **Type lists:** add `calendar` and `timeline` to `LABELS`, `VIEW_ICONS`, the default settings and the "+ Add view" menu. Move both out of `SOON_VIEWS`, but leave Timeline disabled until PR 2: wire Calendar now and keep Timeline in "Coming soon".
- **filter-store:** generalise the per-type settings plumbing so each type isn't copy-pasted. For example, use a `typeSettings` record keyed by view type with one setter and one hook (`useViewTypeSettings(boardId, type)`), and keep Kanban's behaviour and tests passing. Dirty detection and "Save to this view" must cover the new settings.
- **Dispatch:** `ViewBody` in `BoardPage.tsx` dispatches on type with a `switch` (an exhaustive `never` check, so a new type can't be forgotten).
- **Date maths module** (for example `apps/web/src/lib/date-grid.ts`), all UTC:
  - month grid weeks for a month and `firstDayOfWeek`;
  - week days;
  - add or subtract days, weeks and months;
  - inclusive day spans;
  - the day index of an ISO date on an axis.
- **Toolbar:** a `BoardToolbar` variant per view type (the Kanban variant is the model). New item, search, person filter, filter and sort stay. Hide, Group by and the battery bar are hidden. A view settings gear opens the type's settings popover.

## Calendar (PR 1)

### Layout

- **Header row,** above the grid:
  - "Today", then back and forward arrows, then the period title ("October 2026", or "Oct 19 – 25, 2026" in week mode);
  - a Month / Week segmented toggle on the right.
- **Month grid:**
  - 7 columns, or 5 when `showWeekends` is false, and 5 or 6 week rows filling the available height;
  - weekday names in the header row;
  - day number at the top left of each cell; today's number in a filled primary-colour circle;
  - days outside the month in muted text.
- **Item pills:**
  - one line, ellipsis, coloured per `colorBy`;
  - text in black or white for contrast; reuse the label-text contrast helper the status cell uses;
  - a timeline item is one bar spanning its days, split at week rows; a date item is one pill;
  - items with a `time` show it before the name ("09:30 Name").
- **Overflow:** a cell that can't fit its pills shows "+N more", which opens an `AnchoredPopup` listing the day's items.
- **Week mode:** the same, as one tall row of 7 or 5 days, with no hour grid. Times are only shown in the pill text.
- **Items without a value** in the column aren't shown. No "unscheduled" list in this PR.

### Interaction

- **Click a pill:** opens the full item view; feed visible ids to `useItemViewStore.setVisible` as Kanban does.
- **Drag a pill** to another day (dnd-kit):
  - a date value moves to that day and keeps its `time`;
  - a timeline value moves both ends by the same number of days, keeping its length;
  - the write is an optimistic patch, then `tableActions.setCell`.
  - Dragging is off for viewers and for derived or locked columns (`validateCellWrite` decides).
  - During a drag, move the pill with `transform`, not layout properties.
- **Click "+" on a day** (shown on hover, editors only): adds an item to the board's first group, with the column set to that day (a date, or a one-day timeline `{from: day, to: day}`), then opens its full item view. Use `tableActions.addItem` with the initial value, so it's validated.
- **Keyboard:** arrows move between days, Enter on a pill opens it, and Today, back and forward are buttons. Grid cells carry `aria-label`s with the full date.

## Timeline (PR 2)

### Layout

- **Left pane** (fixed width, sticky): group headers in the group colour with a collapse chevron and item count, then one row per item with its name.
- **Right pane:** a horizontally scrolling day axis.
  - **Header:** month labels over day numbers (`days`), week ranges (`weeks`) or months (`months`).
  - **Bars:** one per item, from `from` to `to` inclusive (a date item is a one-day bar). Coloured per `colorBy`, with the name inside the bar when it fits and after it when it doesn't.
  - **Today:** a vertical marker line across the rows.
  - **Weekends:** shaded in `days` zoom.
- **Header controls:** "Today" scrolls to today; a Days / Weeks / Months toggle sets `zoom`. The initial scroll centres today.
- **Rows without a value:** the item row stays with an empty track, so the row order matches the table. Hovering an editable empty track shows a ghost one-day bar; click sets it.
- **Collapse:** collapsed groups (`collapsedGroupIds`) show only their header row.

### Interaction

- **Click a bar or a name:** opens the full item view.
- **Drag a bar body:** moves both dates by whole days.
- **Drag a bar's left or right edge:** changes `from` or `to`, never past the other end (minimum one day).
- **A date column** (not timeline): the bar moves but has no resize handles.
- **During a drag:** show the new date range in a tooltip; snap to days; move with `transform`; commit on drop with an optimistic patch, then `tableActions.setCell`. The same viewer, derived and locked rules as Calendar apply.
- **Rendering:** render only the rows in view (simple windowing over the flat row list) once a board has more than about 200 visible rows, and keep the axis maths in the date module.

## Tokens, motion, a11y

- **Tokens only:** add Calendar and Timeline tokens in `apps/web/src/theme/` (like `kanban-tokens.css`), light and dark.
- **Motion:** drags and hovers use `transform` and `opacity` only, and respect `prefers-reduced-motion`.
- **Labels:** every interactive part has a visible label or `aria-label`. Bars announce "Name, Oct 3 to Oct 17".

## Tests and QA (each PR)

- **Unit tests:**
  - the date module, including month grids for both week starts, a leap year and a month starting on each weekday;
  - the view models: which items land on which days or rows, filters, search, colour choice and fallbacks;
  - the drag plans: date moves, timeline moves and resizes, refused writes;
  - the settings popovers;
  - the filter-store generalisation (Kanban tests still pass).
- **Rules tests** (PR 1) as listed above.
- **Showcase:** add a shared Calendar view (on `due`), and in PR 2 a Timeline view, on the showcase main board. Make sure enough items have dates and timeline values across the visible month. Bump the view counts in `showcase.test.mjs`.
- **Visual:**
  - add `board-calendar` (month) and `board-calendar-week` screens in PR 1, and `board-timeline` in PR 2, light and dark;
  - follow the Kanban pattern: `addXView()`/`removeXView()` in `tests/visual/src/seed.ts`, a ready fixture, and the frozen clock of 2026-10-24;
  - give the seeded roadmap board date and timeline values around that date if it lacks them.
- **QA:** compare with monday in light and dark, side by side, once the reference is in this spec. Log any gaps in the Roadmap VF group.

## Not in these PRs

- Gantt (dependencies, baselines, critical path). It builds on Timeline later.
- Hour grids in week mode, "unscheduled" lists, drag-to-create a range, and group-by other than board groups in Timeline.
- Sharing or exporting calendar feeds (that's P9's ICS item).

## Privacy

Fictional names only in seeds and tests (see `AGENTS.md`).
