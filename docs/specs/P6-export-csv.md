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

## Out of scope / follow-ups

- Print stylesheet (`@media print`) for the table, Dashboard and item view; PDF export.
- Native `.xlsx` (needs a licence-checked dependency; run `pnpm licenses:notices`).
- Import (separate Roadmap item: CSV / Excel import).
