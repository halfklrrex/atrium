# P6 Export a board to CSV (first slice of "Export & print")

Roadmap item: **Export & print** (P6). Branch `claude/export-csv`. Owner not available when this was written; the decisions below are mine and the owner can change them.

## Scope

A board member can download the board as a CSV file from the board's **⋯ Board options** menu in the header ("Export to CSV"). Excel, Numbers and Google Sheets all open CSV, so this covers "Excel export" for now. Print styles and a native `.xlsx` file are **not** in this slice (logged as follow-ups).

## Decisions

1. **Client-side only.** No Function, no rules change, no new dependency. The file is built in the browser from the items the user can already read, and downloaded through a `Blob` and a temporary `<a download>`.
2. **Which rows:** the rows the user currently sees in the open view, in that order (filters, search, sort and group order applied), top-level items only, **plus subitems directly under their parent** when the board has subitems. Archived and trashed items are never exported. If the menu is opened from a place with no open view (sidebar, workspace list), export all active items in group order.
3. **Which columns:** every column except those hidden in the current view, in the view's column order. A first column "Item" (the name), then "Group", then the board columns. Subitem rows leave Group empty and put the parent's name in a "Parent item" column (only present when the board has subitems).
4. **Cell text** comes from the column registry's `toText(value, settings)` for each type (the same text the converter and search use), so no per-type formatting is written twice. A type with no sensible text (`button`, `files`) exports its `toText` result as-is (file names joined with `; `). Derived columns (formula, mirror, dependency, etc.) export their **computed** value the same way the table shows it; where the web already has a helper that computes it for display, use that. People columns export display names, not uids.
5. **CSV format (RFC 4180):** UTF-8 **with a BOM** (so Excel reads accents), `\r\n` row endings, a field is quoted when it contains `"`, `,`, CR or LF (with `"` doubled). **Formula injection guard:** a text field starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with a single quote `'` (OWASP guidance). Numbers that start with `-` (negative numbers from numeric columns) are the one exception: they are exported as plain numbers, not prefixed.
6. **File name:** `<board name>.csv`, with characters not allowed in file names replaced by `-` and the name trimmed to 80 characters.
7. **Size guard:** boards over 20 000 rows still export; the work is synchronous and cheap, no spinner needed. Show a toast "Exported N items" on success and an error toast if building the file throws.
8. **Permissions:** any board role that can read the board can export (viewers too), the same as what they can already see. Do not export columns the user can't see because of column permissions: reuse whatever the table uses to hide those.
9. **Activity log:** none (it is a client-side read).

## Code layout

- `packages/shared/src/columns/csv.ts` (pure, exported from `packages/shared/src/index.ts` through `columns/index.ts`):
  - `csvEscapeField(text: string): string` (quoting plus the formula guard, with the negative-number exception handled by the caller passing `{ numeric: true }`).
  - `buildCsv(rows: string[][]): string` (joins with `\r\n`, no BOM).
  - `CSV_BOM = '﻿'`.
  - `csvFileName(boardName: string): string`.
  - Tests: quoting of commas, quotes, newlines; every formula-guard prefix; the numeric exception; empty cells; unicode; file-name cleaning; a 3-column, 3-row golden string.
- `apps/web/src/components/boards/board-export.ts`: `buildBoardCsvRows({ board, items, subitems, columns, hiddenColumnIds, groups, personNames })` returning `string[][]` (pure, tested with a board using at least status, dropdown, people, date, numbers, checkbox, a formula column and one subitem), and `downloadCsv(fileName, csv)`.
- `BoardMenu.tsx`: a new **Export to CSV** item (icon `Download` from `@vibe/icons`, or the nearest existing one) below "Save as template". It needs the open view's visible rows; pass them from `BoardHeader` through a new optional prop (for example `getExportRows`) rather than making the menu fetch the whole board. When the prop is missing (sidebar), the item exports all active items, loading them the way the table does (reuse the existing items hook; the content only mounts while the menu is open, which keeps listeners cheap).
- Tokens only for any styling; this slice should need none.

## Tests and checks

- Shared unit tests as above.
- Web unit tests for `buildBoardCsvRows` (hidden columns skipped, view order respected, subitems under parent, archived items excluded, people names, formula computed value).
- A `BoardMenu` test: the item is present for a viewer and an editor, and clicking it calls the download helper (mock `URL.createObjectURL`).
- Showcase: nothing visible on a board, so no change. `pnpm lint`, `typecheck` (`pnpm -r --workspace-concurrency=1 typecheck`), `pnpm test`, `pnpm test:rules` (unchanged), `pnpm build`.
- No hot-spot files except the shared package export line (`packages/shared/**`); keep it to the new file plus one re-export.

## Slice 2: Excel file, print, and Export from the selection (owner autonomy run, 2026-11-07)

Decisions are the lead's; the defaults stand unless the owner changes them.

1. **Native `.xlsx` with one small dependency, `fflate` (MIT, about 8 kB, zip only).** SheetJS community and ExcelJS were rejected: SheetJS' npm release is old and unmaintained, ExcelJS is large. The sheet XML is written by us (`packages/shared/src/columns/xlsx.ts`, pure and tested): one sheet "Items", a bold frozen header row, column widths from the longest cell (max 60), inline strings (no shared-string table), numbers as numbers, dates as Excel serial dates with a date style, checkboxes as `TRUE`/`FALSE` text, everything else the same `toText` as the CSV. The same formula-injection guard applies to strings that start with `=`, `+`, `-` (non-numeric), `@`, tab or CR (written as a string cell, which Excel does not evaluate, plus the leading `'`). `fflate` is imported **dynamically** when the user clicks Export, so it is not in the main bundle. Run `pnpm licenses:notices` and commit `THIRD_PARTY_NOTICES.md` (hot spot: `pnpm-lock.yaml`, merge alone).
2. **Menu:** the board menu's "Export to CSV" becomes a small submenu "Export" with **CSV** and **Excel (.xlsx)**, both using the exact row/column rules of slice 1. File name `<board name>.xlsx`.
3. **Print.** `@media print` styles (tokens only; the print rules live in `apps/web/src/theme/print.css`, the only place for print-specific literals) for the board table, the item view and a dashboard: hide the app shell (sidebar, top bar, board header actions, view tabs, batch bar, add-item rows), show every row of every expanded group (no virtual scrolling cut: when printing, render all rows), black text on white regardless of theme, avoid breaking a row across pages, repeat the header row, landscape hint for tables (`@page { size: landscape }` on the board only). A **Print** item in the board menu calls `window.print()`; a browser "Save as PDF" covers PDF. No server rendering.
4. **Export from the selection.** In the batch bar (shown when rows are selected), add an **Export** button with the same two choices (CSV, Excel). It exports only the selected rows (subitems of a selected parent are included; the selection order is the view order), with the same columns as the full export. The bar's buttons keep their order: Export goes after Duplicate, before Delete. Convert and Apps (monday's other batch-bar buttons) stay out of scope.
5. **Performance:** build the file in the browser; for more than 5 000 rows show the "Exporting..." toast first and yield to the event loop once before building.
6. **Tests:** xlsx.ts golden test (open the produced zip with `fflate`, check `[Content_Types].xml`, the sheet XML for a header, a number, a date, an injection string, and column widths); the board menu and batch bar tests; a CSS test that `print.css` contains no colour or px literals outside the theme folder rules; `pnpm licenses:check` passes.
7. **Work packages:** (a) `claude/export-xlsx`: shared writer + menu submenu + dependency; (b) `claude/export-batch-bar`: the batch-bar Export button (after (a)); (c) `claude/print-styles`: `print.css`, the Print menu item and tests (independent). Visual baselines are not needed for print (it is checked with `emulateMedia({ media: 'print' })` in one Playwright snapshot test, added to `tests/visual`, which needs a baseline run).
8. **Owner checks:** open an exported `.xlsx` in Excel or Numbers (header bold and frozen, dates as dates, numbers right-aligned); print preview of a board, an item and a dashboard.

## Out of scope / follow-ups

- Server-side PDF generation; Convert (to subitems or another board).
- Print styles for Calendar, Timeline and Kanban views (the table only in this slice).
- Import (separate Roadmap item: CSV / Excel import).
