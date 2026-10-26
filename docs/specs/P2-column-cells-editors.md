# P2: Remaining column cells, editors and settings editors

Author: Ophelia (Opus 5.5) · Implementer: Ava (Antigravity) · Roadmap: P2 items "#45 follow-ups" (3308619604), "Files column" (3306293650), "Button column" (3306219470), "Time tracking column" (3306234339), "Dependency column" (3306293488), "Connect boards & mirror columns" (3306234642), "Formula column" (3306219997)

## Where we are (facts at `689fb4a`)

- **Shared types:** 33 column types are registered in `packages/shared/src/columns/index.ts`, and 25 have a web UI (`apps/web/src/columns/`).
- **No web UI yet:** `location`, `dependency`, `board_relation`, `mirror`, `button`, `files`, `formula` and `time_tracking`. These are exactly the showcase `PENDING_TYPES`.
- **Display-only:** `timeline`, `week`, `hour` and `world_clock` are `editor: 'none'` today, but they're already in `ADD_COLUMN_ORDER`.
- **Callables:** the web app has no wrappers except `callBootstrapUser` (`apps/web/src/lib/callables.ts`). The server callables already exist:
  - `clickButton`, `startTimeTracking`, `stopTimeTracking`;
  - `requestFileUpload`, `finalizeFileUpload`, `getFileDownloadUrl`, `deleteFileAttachment`.
  - Their request and result zod schemas are in `packages/shared/src/schemas/column-actions.ts` and `files-upload.ts`.
- **Column settings popup:** `ColumnSettings.tsx` only has status, dropdown and numbers editors. Every other type falls back to the numbers editor, which is a bug.
- **Patterns to follow:**
  - Popover editors use `AnchoredPopup` (`components/board-table/AnchoredPopup.tsx`); see `status.tsx`, `date.tsx`, `people.tsx` and `dropdown.tsx`. Shared styles are in `columns/popups.module.css` and `cells.module.css`.
  - Editors receive `EditorProps` (`columns/types.ts`): `onChange`, `onClose`, `anchor` and `saveSettings`.

## Split into three PRs

Do them in this order, within your 2-open-PR limit. Each PR:

- removes its types from `PENDING_TYPES` and adds them to `ADD_COLUMN_ORDER` (in monday's order) and to the showcase with realistic values;
- adds unit tests for the cell, the editor and the settings editor;
- attaches light and dark screenshots, compared with monday.

### PR A: `ag/cells-time-location` (web only)

1. **#45 follow-ups (item 3308619604):**
   - The vote toggle derives `arrayUnion` or `arrayRemove` from the requested value, and goes through `validateCellWrite`.
   - Delete `components/presence/usePresence.ts`.
   - `console.warn` in the presence listener's `catch`.
2. **Timeline:**
   - **Cell:** monday's pill. A rounded bar filled in the group colour, proportional to elapsed time when `settings.showProgress`, with the date range as text ("Oct 3 - 17"). On hover it shows the day count.
   - **Editor:** a popover with Vibe `DatePicker` in range mode, plus Clear. A `from`/`to` with `from <= to` is enforced by the schema already.
3. **Week:**
   - **Cell:** "Oct 20 - 26".
   - **Editor:** a popover calendar that selects a whole week, respecting `settings.firstDayOfWeek`.
4. **Hour:**
   - **Cell:** "09:30" or "9:30 AM", per `settings.format24Hour`.
   - **Editor:** an inline input that uses the shared `parseHour`. Invalid input shows an error and isn't saved.
5. **World clock:**
   - **Cell:** the live local time for the timezone (one shared 30-second ticker, not one timer per cell), plus the city when `settings.showCity`.
   - **Editor:** a popover with a searchable list from the shared `CANONICAL_TIMEZONES`.
6. **Location:**
   - **Cell:** the address text with a pin icon. A click on the icon opens OpenStreetMap at those coordinates in a new tab (`rel="noopener noreferrer"`).
   - **Editor:** a popover with an address text field and optional lat/lng fields. No geocoding service in this PR; `location` has a schema already.
7. **Settings editors** in `ColumnSettings.tsx` for `timeline` (showProgress), `week` (firstDayOfWeek), `hour` (format24Hour) and `world_clock` (format24Hour, showCity). Also fix the fallback: types with no settings editor show "No settings for this column" instead of the numbers editor.

### PR B: `ag/cells-server-actions` (web only; the callables already exist)

1. **Callable wrappers** in `apps/web/src/lib/callables.ts`, one per server callable. Each is typed by parsing requests and results with the shared zod schemas, and maps `HttpsError` codes to friendly toast text (`permission-denied`, `failed-precondition`, `resource-exhausted`).
2. **Files:**
   - **Cell:** the first two file icons or thumbnails plus "+N".
   - **Popover:**
     - lists the files: name, size via the shared size helper, uploader and date;
     - downloads through `getFileDownloadUrl`, opened in a new tab;
     - deletes through `deleteFileAttachment`, with a confirmation;
     - uploads with "Add file" or drag-and-drop: `requestFileUpload`, then a `PUT` to the signed URL with the returned headers and an `XMLHttpRequest` progress bar, then `finalizeFileUpload`.
   - **Limits:** respect `settings.maxFileSizeMb` and `allowedTypes` on the client before requesting (the server re-checks).
   - **Settings editor:** max size and allowed types.
   - The cell is server-managed, so it never calls `setCell`.
3. **Button:**
   - **Cell:** a Vibe `Button` (size small) with `settings.label`, coloured from `settings.color`.
     - That colour is user data. Use it through a CSS custom property set in a `style` prop, with an `eslint-disable-next-line no-restricted-syntax -- user-chosen button colour (data)` comment.
     - Compute readable text colour (black or white) from its luminance.
   - **Click:** calls `clickButton`, shows a spinner while waiting, then a success toast.
   - **Settings editor:** label, plus a colour from the existing palette picker (`theme/palette.ts`).
4. **Time tracking:**
   - **Cell:** a play/stop round button plus the duration ("1h 05m"). While running it shows a live ticking timer from `startDate`, using the same shared ticker as world clock.
   - **Actions:** play calls `startTimeTracking`. If `settings.requireNote`, it first shows a small note popover. Stop calls `stopTimeTracking`.
   - **History:** when `trackHistory`, a popover lists the sessions (user, start, end, duration).
   - **Settings editor:** trackHistory, requireNote.

### PR C: `ag/cells-relations-formula` (web plus shared, no rules)

1. **Formula:**
   - **Make it derived:** set `derived: true` on the shared `formula` type, with `compute()` evaluating `settings.expression` through the shared engine (`packages/shared/src/formula/`) against the item's values.
     - Today it's not flagged and has no `compute` (TODO at `formula.ts:15`), so clients could write values. That breaks the derived-column rule in `AGENTS.md`.
     - The `onBoardColumnsWritten` trigger then adds it to `derivedColumnIds` automatically. Check the shared and rules derived tests still pass, and add formula cases.
   - **Cell:** the formatted result per `outputType`, `decimalPlaces` and `currencySymbol`. An evaluation error shows a small red "!" with the message as a tooltip.
   - **Settings editor:** an expression textarea with the column list to insert `{Column}` references, live validation through the engine's parser, and the output type.
2. **Dependency:**
   - **Cell:** chips with the linked item names (same board).
   - **Editor:** a popover with search over the board's items (excluding self) that toggles ids. Refuse a link that would create a cycle, using the shared `dependency-graph.ts`, with a toast.
   - **Settings:** strict, and `timeColumnId` (pick a date or timeline column).
3. **Board relation (connect boards):**
   - **Cell:** chips with the linked item names, read from each linked board.
     - Batch the reads: one `getDocs` per linked board with `documentId() in [...]`, chunked to 30, cached per board for the session.
     - Items the user can't read show as "Unavailable item".
   - **Editor:** a popover that picks from items in `settings.boardIds`, with a search, respecting `allowMultipleItems`.
   - **Settings editor:** choose boards from the workspace's boards that the user can read.
   - **Two-way** is out of scope here, because it needs a server-side writer. Hide the setting.
4. **Mirror:** not in this PR. It needs a server design: who writes `mirroredValues`, and fan-out on source change. Ophelia will spec it separately. Keep `mirror` in `PENDING_TYPES`.

## Not in these PRs

- `auto_number` has no server assigner (`auto-number.ts:15` says "Assigned server-side by Functions", but no Function exists). Ophelia will spec an `onItemCreated` counter later.
- Column locks are a separate spec (`docs/specs/P2-column-locks.md`). If locks merge first, the new editors must respect locked columns through `validateCellWrite`, like every other cell.

## Verify (each PR)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` pass. The showcase test passes (`scripts/showcase/showcase.test.mjs`).
- Visual QA in light and dark, compared with monday's cells (ask Ophelia for reference captures of a type if you need them). Update the visual baselines through the workflow if the table screens change.
- After merge, Ophelia re-seeds the showcase in production.
