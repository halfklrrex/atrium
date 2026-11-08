# P6 Export: the designed Excel workbook (slice 3 of "Export & print")

Roadmap item: **Export & print** (P6). Branch `claude/export-workbook`. Owner decisions of 2026-11-08 (final); the lead's design choices below stand unless the owner changes them (see "Owner questions with defaults" at the end).

Slices 1 and 2 (`P6-export-csv.md`) built the CSV, a plain one-sheet `.xlsx` (`packages/shared/src/columns/xlsx.ts`, zipped with `fflate` in `apps/web/src/components/boards/board-export.ts`), the Export submenu of the board menu and the batch bar's Export button. This slice keeps all of that working and replaces the plain sheet with a **designed workbook**.

## Goals

1. The Excel file looks like Atrium: brand blue, the board's own status, priority and group colours, Figtree, clean tables without gridlines, "a little flair" (owner).
2. The first sheet is an **intro dashboard** for the whole workbook, in the spirit of the showcase dashboard "Showcase overview" (Numbers, Battery, Chart, Table and Workload widgets).
3. The board's views port to their own sheets: Kanban, Calendar, Timeline, Gantt, Chart and Workload (work packages 2 and 3).
4. The file opens cleanly in Excel (no "We found a problem with some content") and in Numbers, for boards with thousands of items.
5. The CSV gets the structural improvements that make sense for a styling-free format.

## Decisions (owner, 2026-11-08)

1. **Structure:** **Summary** (first sheet), then **Items**, then one sheet per view type the board actually has: **Kanban**, **Calendar**, **Timeline**, **Gantt**, **Chart**, **Workload** (that order; English names; one sheet per type, from the first view of that type in tab order; see question Q2).
2. **Summary = intro dashboard:** title banner (board name, export date), headline number cards, a status distribution table with in-cell data bars and a native chart, priority and group breakdowns, workload by person, and internal links to the other sheets.
3. **Colours:** Atrium's brand blue `#0073EA` (Vibe `--primary-color`, the value in `@vibe/core` `dist/tokens/tokens.css`; written as a literal in the writer with a comment citing the token, because a workbook cannot read CSS), the board's real status and priority label colours on those cells, the group colours on group markers, light neutral tints for banding, no gridlines on designed sheets.
4. **Font:** **Figtree** everywhere: `<name val="Figtree"/><family val="2"/><scheme val="none"/>`. An `.xlsx` cannot embed a font and Excel has no fallback list, so on a machine without Figtree Excel and Numbers substitute a sans-serif (family 2 = swiss). This is documented in the owner check list.
5. **Language:** every label, heading and note is English.
6. **Views as sheets:** Chart view to native Excel charts (column/bar and doughnut) driven by a data block on the same sheet; Workload to a table plus a native bar chart; Timeline and Gantt to a cell-fill timeline grid (Excel has no native Gantt); Calendar to month grids; Kanban to lanes of stacked cards.
7. **CSV:** "change both": the structural changes below; no styling, injection guard unchanged.
8. **Selection export** (batch bar): see "Selection export" below.

## Architecture

- **Pure writer in `packages/shared/src/workbook/`** (no DOM, no zip, no Firebase; returns a map of part path to XML text, like slice 2):
  - `xml.ts`: escaping, illegal-character removal, the 32 767-character cell limit, column letters and cell references (moved from `columns/xlsx.ts`, which re-exports them so existing imports keep working).
  - `palette.ts`: the Atrium colours and the font name, plus `textOn(hex)` (dark or white text for a fill, by relative luminance).
  - `styles.ts`: a **style registry**: callers ask for a style by its parts (font, fill, border, alignment, number format) and get a `cellXfs` index; identical requests share one index; fonts, fills, borders, number formats and `dxf`s are de-duplicated. It serialises `xl/styles.xml` in schema order (`numFmts, fonts, fills, borders, cellStyleXfs, cellXfs, cellStyles, dxfs`). Fill 0 is `none` and fill 1 `gray125` (Excel requires both).
  - `sheet.ts`: a **sheet writer**: cells by row (strings as inline strings, numbers, booleans, dates as serials), merged ranges (overlap is a programming error and throws), column widths, row heights, frozen panes, hidden gridlines, tab colour, conditional formats (data bar, expression), internal hyperlinks (`location`, no relationship), autofilter, print setup, and a drawing reference. It writes the elements in the `CT_Worksheet` order: `sheetPr, dimension, sheetViews, sheetFormatPr, cols, sheetData, autoFilter, mergeCells, conditionalFormatting, hyperlinks, printOptions, pageMargins, pageSetup, drawing, extLst`. Rows are built as strings while they are added, so a large sheet never holds a cell object model.
  - `chart.ts`: chart parts (`c:chartSpace` with `c:barChart` or `c:doughnutChart`) and the drawing part that anchors them (`xdr:twoCellAnchor` with a `graphicFrame`), with series caches so a viewer can draw before recalculating.
  - `package.ts`: assembles the sheets into the parts: `[Content_Types].xml` (an override per sheet, drawing and chart), `_rels/.rels`, `docProps/core.xml` (title = board name, creator "Atrium"), `docProps/app.xml`, `xl/workbook.xml` (sheets, `bookViews`, defined names for print titles and the autofilter), `xl/_rels/workbook.xml.rels`, `xl/styles.xml`, `xl/worksheets/sheetN.xml` and their `_rels`, `xl/drawings/drawingN.xml` and their `_rels`, `xl/charts/chartN.xml`.
  - `board-workbook.ts`: the board layout: `buildBoardWorkbookParts(data: BoardWorkbookData)`. It takes plain data (no item documents) and lays out Summary, Items and (later) the view sheets.
- **Data in `apps/web`**: `apps/web/src/components/boards/workbook-data.ts` turns the board, its items and the open view into `BoardWorkbookData`, **reusing the existing models** (named per sheet below), so the workbook shows what the app shows.
- **Zip in the browser**: `board-export.ts` zips the parts with `fflate` (dynamic import, unchanged), `export-run.ts` keeps the toasts.
- **No new dependency.** Everything is hand-written OOXML.

## Look and feel (all sheets)

| Element                   | Style                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Banner (row 1)            | Merged across the sheet, height 42 pt, fill brand blue `#0073EA`, Figtree 20 bold white, left aligned with an indent. Text: the board name.                                                              |
| Subtitle (row 2)          | Height 22 pt, fill `#0060B9` (Vibe `--primary-hover-color`), Figtree 10 `#CCE5FF` (Vibe `--primary-selected-color`): "Exported 8 Nov 2026, 14:32 · 128 items" (or "Selection of 3 items · ...").         |
| Colour stripe (row 3)     | Height 4 pt, cells filled with the board's status label colours in label order (repeated across the width): Atrium's colourful edge.                                                                     |
| Section bar               | Figtree 11 bold brand blue, upper case, medium brand-blue bottom border, height 26 pt.                                                                                                                   |
| Table header              | Fill `#CCE5FF`, Figtree 10 bold `#323338` (Vibe `--primary-text-color`), thin bottom border brand blue, height 24 pt, wrap.                                                                              |
| Body                      | Figtree 10 `#323338`, height 20 pt (more when wrapped), vertically centred; banding white / `#F6F7FB` (Vibe `--allgrey-background-color`); thin row separators `#E7E9EF` (Vibe `--ui-background-color`). |
| Secondary text            | `#676879` (Vibe `--secondary-text-color`).                                                                                                                                                               |
| Status and priority cells | Fill = the label's colour, text white or `#323338` by contrast (`textOn`), centred, like the app's status cells. No label: `#C4C4C4` (`EMPTY_STATUS_COLOR`).                                             |
| Group marker              | A narrow first column (width 1.3) filled with the row's group colour, like the group edge in the table; the Group cell's text is the group colour, bold.                                                 |
| Links                     | Figtree 10 brand blue, underlined.                                                                                                                                                                       |
| Notes and source line     | Figtree 9 italic `#676879`.                                                                                                                                                                              |
| Number formats            | Numbers `General` (right aligned); counts `#,##0`; shares `0%`; dates `d mmm yyyy`; date and time `d mmm yyyy hh:mm`.                                                                                    |
| Gridlines and tabs        | `showGridLines="0"` on every designed sheet; tab colours: Summary brand blue, Items `#00C875`, view sheets `#9D50DD`.                                                                                    |

## Summary sheet (intro dashboard)

Grid: A gutter (2), B 24, C 11, D 11, E gutter (3), F 24, G 11, H 11, I gutter (2). Two panels: left B:D, right F:H. The sheet is portrait, fit to one page wide.

1. **Banner, subtitle, stripe** (rows 1 to 3), as above, merged A:I.
2. **At a glance**: section bar, then 8 cards in two rows of four (card columns B, C:D, F, G:H). Each card is three rows: a small upper-case grey label (fill `#F6F7FB`), a big number (Figtree 20 bold, brand blue; "Overdue" red `#DF2F4A` when not zero, "Done" green `#00C875`), and a one-line note (secondary, 9 pt). A thin `#D0D4E4` border frames each card. Cards: **Items** (top-level), **Done** (note: "37% of items"), **In progress** (has a status that is not done), **Overdue** (not done, date before today), **Due in 7 days** (not done, date from today to today + 6), **No date**, **People** (distinct people assigned), **Groups**.
   - "Done" uses the first status column's `isDone` labels (`isRowDone`, the table's overdue rule). The date is the first Date column, else the end of the first Timeline column. With no status column the Done and In progress cards say "No status column"; with no date column the date cards say "No date column".
3. **Status** (left panel): section bar with the column's title ("STATUS"), then a table **Label / Items / Share**: label cells in the label's colour, a solid data bar on Items (brand-blue tint `#579BFC`), Share as `0%`, a bold Total row. Rows from `buildBatteryModel` (the dashboard Battery widget's model: labels in label order, "Not set" last, zero rows dropped).
   - **Right panel: native chart** of the same rows: a column chart, one bar per label in its label colour (`c:dPt`), value labels on, no legend, title "Items by status", under a section bar "STATUS CHART". If the board has no status column, the panel shows the groups chart instead.
4. **Priority** (left) and **Groups** (right): the Priority table is the same as Status for the status column whose title contains "priority" (case-insensitive), if any. Groups: **Group / Items / Done / Share**, the group cell filled with the group colour, data bar on Items. Without a priority column, Groups takes the left panel and Workload moves up.
5. **Workload by person** (left, titled "Workload by <People column title>"): **Person / Items / Done** (a panel has three columns), from the first People column (`personsOf` of `workload-model.ts`), people sorted by item count, "Unassigned" last, data bar on Items, capped at 30 people with a note "and N more people".
   - Right panel (WP3): a native bar chart of the same table.
6. **In this workbook** (right of Workload, or below): one row per other sheet, the sheet name as an internal hyperlink (`'Items'!A1`) and a one-line description ("Every exported row with all visible columns").
7. **Source line**: "Exported from Atrium (atrium-workboards.web.app) on 8 Nov 2026 at 14:32. Figures count top-level items; subitems are listed on the Items sheet." Italic, secondary.

Every number on the Summary is a value, not a formula: it is computed in the app with the same models the app uses, so Excel and Numbers show the same figures without recalculation (see Q3).

## Items sheet

- Rows 1 to 3: banner, subtitle (with a "‹ Summary" link in the last header column), stripe. Row 4: the table header. Freeze panes below row 4 and right of the Item column (`xSplit=2, ySplit=4`). Autofilter on the header row. Print titles repeat row 4; landscape, fit to one page wide.
- Columns: **group marker** (no header text), **Item**, **Group**, **Parent item** (only when the board has subitems), then the visible board columns in view order (the CSV's columns, same rules as slice 1).
- Cells: status columns (including priority) filled with the label colour; numbers right aligned with `General`; dates and date-times as serial dates (`d mmm yyyy`, `d mmm yyyy hh:mm`); checkboxes as a green check mark "✓" (ticked) or empty, centred (not boolean cells: Quick Look, and so probably Numbers, does not draw TRUE/FALSE cells); an empty status cell is grey, as in the table; long text and multi-line text wrap; everything else is the registry's `toText`, as in the CSV.
- Subitem rows: the Item cell is indented two levels and in secondary colour, the row has the parent's group marker and Group.
- Banding: alternate white and `#F6F7FB`, by top-level item (a parent and its subitems share a band), written as static fills (not conditional formats) so it survives in Numbers. Re-sorting in Excel scrambles the bands; that is accepted.
- Widths: from the longest line, header included; Item 28 to 50; other columns 10 to 45; marker 1.3. Wrapped rows get a height for up to 4 lines (15 pt per line + 5), above that the text is cut visually (the cell keeps all of it).
- The formula-injection guard of slice 2 stays (strings starting with `=`, `+`, `-` (not a number), `@`, tab or CR get a leading `'` and are always string cells).

## View sheets (WP2 and WP3)

All view sheets start with the banner, the subtitle (view name, "‹ Summary" link) and the stripe, and use the same rows the view shows with its saved settings (its filters, the open view's search does not apply). Data comes from the existing models:

| Sheet    | Model reused (apps/web)                                                                                     | Layout                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kanban   | `buildKanbanLanes`, `resolveStatusColumn`, `resolveCardColumns` (`board-kanban/kanban-model.ts`)            | One column pair per lane (lane width 28 plus a 2-wide gutter). Lane header: the label colour fill, white bold name and the card count. Each card: a bordered block of merged cells: the item name bold, then one line per card column (`title: text`), a thin left edge in the group colour. Cap 200 cards per lane with "and N more".                                            |
| Calendar | `resolveCalendarColumn`, `itemSpan`, `itemColor` (`board-calendar/calendar-model.ts`, `date-view-model.ts`) | One block per month in the items' date range (at most 24 months, the latest 24 when longer; note). Seven day columns (width 18, first day of week from the view settings), a weekday header row, one row per week with the day number and up to 6 item lines (`• name`), each item in its status (or group) colour as font colour; "+N more" when a day has more. Today outlined. |
| Timeline | `resolveTimelineColumn`, `buildTimeline` (`board-timeline/timeline-model.ts`)                               | Left: Group, Item, Start, End, Days. Right: one column per day (range up to 120 days) or per week (longer), width 2.6 (day) or 4 (week), a month header row and a day/week header row. A bar is the cells between start and end filled in the item's colour (status by default, `colorBy`). Weekends tinted, today's column outlined in red `#DF2F4A`. Cap 500 items with a note. |
| Gantt    | Timeline's model plus `buildEdges`, `criticalPath` (`board-gantt/gantt-model.ts`)                           | Same grid as Timeline plus columns **Depends on** (item names) and **Critical** ("Yes" for items on the critical path; their bars get a bold brand-blue border). Dependency arrows cannot be drawn in cells, so they are listed. Cap 500 items.                                                                                                                                   |
| Chart    | `buildChartModel` (`board-chart/chart-model.ts`) with the view's saved `ChartSettings`                      | A data block (bucket, value, share; stacked: one column per series) and a native chart: bar and stacked bar to `c:barChart` (`barDir="col"`, `grouping` clustered or stacked, overlap 100), pie and donut to `c:doughnutChart` (`holeSize` 0 for pie is not allowed, so pie uses `c:pieChart`), line to `c:lineChart`; bucket colours as `c:dPt`. Notes of the model under it.    |
| Workload | `resolveWorkloadColumns`, `buildWorkload` (`board-workload/workload-model.ts`)                              | A table person by week (or day/month by the view's zoom), cells coloured by `levelFor` (under, balanced, over capacity: the app's workload colours), a total column with a data bar, and a native bar chart of the totals.                                                                                                                                                        |

Kanban, Calendar and Timeline/Gantt are WP2; Chart, Workload and the Summary's second chart are WP3.

## Charts in OOXML (rules the writer follows)

- Part chain: sheet `<drawing r:id>` to `xl/worksheets/_rels/sheetN.xml.rels` to `xl/drawings/drawingN.xml`, whose `_rels` point to `xl/charts/chartN.xml`; content-type overrides `application/vnd.openxmlformats-officedocument.drawing+xml` and `application/vnd.openxmlformats-officedocument.drawingml.chart+xml`.
- `c:chartSpace` order: `date1904?, lang?, roundedCorners?, chart, spPr?, txPr?`. `c:chart` order: `title?, autoTitleDeleted?, plotArea, legend?, plotVisOnly?, dispBlanksAs?`. `c:barChart`: `barDir, grouping, varyColors, ser*, dLbls?, gapWidth?, overlap?, axId, axId`. `c:ser` (bar): `idx, order, tx?, spPr?, invertIfNegative?, dPt*, dLbls?, cat?, val?`. Axes: `catAx` and `valAx` with matching `axId`/`crossAx`.
- Series reference the data block with absolute, sheet-quoted references (`'Summary'!$B$14:$B$18`) and carry `strCache`/`numCache` with the same values.
- Fonts in charts: `a:latin typeface="Figtree"`.

## CSV changes (decision 7)

CSV cannot carry styling, so only structure changes:

1. **Same column order as the Items sheet** (minus the colour marker): Item, Group, Parent item (when the board has subitems), then the visible columns in view order. Unchanged from slice 1.
2. **Subitem rows now fill Group** with their parent's group (it was empty): the rows filter and pivot correctly. This is the one change of an existing value.
3. **Unique header names**: when two columns share a title, the later ones become "Status (2)", "Status (3)": spreadsheets and import tools key on header names.
4. Everything else is unchanged and backwards compatible: UTF-8 with BOM, `\r\n`, RFC 4180 quoting, the formula-injection guard, `toText` cell text, dates as `YYYY-MM-DD`, checkboxes as before.

## Selection export (batch bar)

- The workbook has **Summary and Items**, both computed from the **selected rows only**. The subtitle says "Selection of N items (of M on the board)" and the Summary's source line repeats it.
- **View sheets are omitted** for a selection: a Gantt or calendar of a hand-picked handful is misleading, and the batch bar has no view context. See Q4.
- CSV from the batch bar is unchanged (selected rows only).

## Size caps and performance

- Items: no cap (slice 2 rule). Rows are built as strings while they are added; strings are inline (no shared-strings table); a cell's text is cut to 32 767 characters (Excel's limit; a longer cell makes the file corrupt).
- Summary: people capped at 30 rows; status/priority tables are naturally capped by the 40 labels a status column may have; groups uncapped (a board has few).
- Timeline and Gantt: 500 items, 366 day columns or 260 week columns; Calendar: 24 months; Kanban: 200 cards per lane. Each capped sheet says so in a note row under the banner.
- More than 5 000 items: the "Exporting..." toast first (slice 2 rule).

## Tests

1. **Writer unit tests** (`packages/shared`): style registry de-duplication and index stability; `textOn`; merge overlap throws; column letters and references; the 32 767 cut; golden checks on a small Summary and Items (banner merge, stripe, card values, data-bar rule with the x14 extension and matching id, hyperlink locations, status fills, boolean cells, date serials, frozen pane, autofilter, defined names).
2. **Strict structure test** (`apps/web`, jsdom's `DOMParser` on every part, after a real `fflate` zip and unzip): every part is well-formed XML; every content-type override exists and every XML part has a content type; every relationship target exists; worksheet children are in `CT_Worksheet` order; chart children in schema order; style indexes (`s=`) are below the `cellXfs` count and `dxfId`s below the `dxfs` count; every font, fill, border and number-format id exists; cell references are valid and increasing in each row, rows increasing; merged ranges valid and not overlapping; hyperlinks and CF ranges valid; sheet names unique, at most 31 characters, no forbidden characters; defined names point to existing sheets. Run for a small board, a board with subitems and dates, and a 3 000-item board.
3. **Independent reader and schema check** (outside the repo, test only, not committed because they would be repo dependencies): a scratch Python venv with `openpyxl` loads every sample workbook and reports the sheets, merges, fonts and charts; `lxml` validates every worksheet, workbook, styles, chart, drawing and app-properties part against the ECMA-376 5th edition transitional XSDs (the only accepted deviation: `xml:space="preserve"` on `<t>`, which Excel itself writes but the schema does not declare).
4. **Rendering:** macOS Quick Look (`qlmanage -t`) renders the first sheet of a sample to PNG (Apple's renderer, close to what Numbers shows). It does not draw charts or data bars, so those are only checked structurally.
5. **Existing tests** stay green: CSV tests are updated deliberately for the two CSV changes; the board menu and batch-bar export tests now check the workbook parts.

## Work packages

- **WP1 (this branch, first):** workbook foundation (xml, palette, styles, sheet, chart, package), Summary dashboard with the status chart, the redesigned Items sheet, wiring in `board-export.ts`, `export-run.ts`, the board menu and the batch bar, the CSV changes, tests, owner check list section, sample workbooks.
- **WP2:** Kanban, Calendar, Timeline and Gantt sheets (view list from `useBoardViews`, settings per view).
- **WP3:** Chart and Workload sheets with native charts, the Summary's workload chart.

## Owner questions with defaults

1. **Q1 Font fallback:** Figtree is not on most computers. Default: keep Figtree. Quick Look on a Mac without Figtree drew a serif font (it ignores the family hint), so Numbers may do the same; Excel should substitute a sans-serif. Installing Figtree (free, Google Fonts) shows the file as designed. Alternative: Arial everywhere, which looks the same on every machine.
2. **Q2 Several views of one type:** default one sheet per type, from the first such view in tab order. Alternative: one sheet per view, named after the view.
3. **Q3 Live formulas:** default: Summary figures are values computed at export. Alternative: formulas over the Items sheet (they update if you edit Items, but Numbers and Excel may show different results for the date rules).
4. **Q4 Selection export:** default Summary and Items for the selection, no view sheets. Alternative: view sheets for the selection too.
5. **Q5 CSV subitem Group:** default fill Group on subitem rows with the parent's group. Alternative: keep it empty as before.
6. **Q6 Item ID column:** default none. Alternative: add an "Item ID" column (useful for a later re-import), in both CSV and Excel.
7. **Q7 Banding after sorting:** default static bands (they scramble if you re-sort in Excel). Alternative: conditional-format banding that follows sorting in Excel but may not show in Numbers.
8. **Q8 Formula-looking text:** default as slice 2: text such as `=SUM(A1)` is a string cell shown with a leading `'` (visible in the cell). Alternative: the cell's style gets Excel's "quote prefix" flag instead, so the text shows without the `'` and still never runs as a formula in Excel; the guard then only protects the CSV.
9. **Q9 Checkboxes:** default a green "✓" for ticked and an empty cell for unticked. Alternative: TRUE/FALSE boolean cells (filterable as TRUE/FALSE in Excel, but Quick Look and probably Numbers show nothing).

## Known limits (state in the owner check list)

- **Numbers** ignores data bars, internal links in some versions and the tab colours; it shows charts but may restyle them; frozen panes become header rows. Excel for the web and desktop show everything.
- Fonts: see decision 4.
- Arrows of the Gantt view become a "Depends on" list.
