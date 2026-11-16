# VIEW-files-gallery: a Files gallery board view

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: "Files gallery view" (P3 group; Opus creates the item) · Builds on: `docs/specs/P3-saved-views.md`, `docs/specs/P2-files-column.md`, `docs/specs/P2-files-storage-upload.md`, `docs/specs/P4-update-attachments.md`, `docs/specs/SIDEBAR-overview-tab.md` (the Files tab) · Status: spec, nothing built

## Goal

monday has a Files view: one place that shows every file on a board as a grid of thumbnails, so you find "the PDF someone attached last week" without opening items one by one. Atrium has the pieces (files columns, signed download URLs, the sidebar Files tab, the saved-views framework) but no board-wide file list. Add a **Files** view type: a thumbnail grid of the files in the board's files columns, each card showing the file name and the item it belongs to, with the board's search, person and filter controls plus a column, type and sort picker. Opening and downloading go through the existing callables. No new Storage rules.

## Decisions this spec makes (the owner can overrule them)

- **View type id `files`, default tab name "Files", menu label "Files gallery".** The "Add view" menu entry sits after Chart and uses the Vibe `Gallery` icon.
- **Files columns only.** Update and reply attachments are not in the gallery. Listing them board-wide is not cheap (see "Update attachments" below); the sidebar's Files tab already shows them per item.
- **Top-level items only, active only**, like the Kanban, Calendar and Chart views. Subitem files come later.
- **Click a card to open the file** in a new tab through its signed URL, as the files cell does today. No in-app lightbox in this spec.
- **Click the item name to open the item's side panel on its Files tab** (`openItem(boardId, itemId, { tab: 'files' })`).

## Facts this design rests on (checked against `origin/main` at `6335256`)

- **View types** are `viewTypeSchema` in `packages/shared/src/schemas/view.ts` (`table`, `kanban`, `calendar`, `timeline`, `gantt`, `workload`, `chart`, `form`). Per-type settings are optional keys of `viewSettingsSchema` (`kanban`, `calendar`, ...), each with a `default…Settings()`.
- **Rules** (`firestore.rules`, `match /views/{viewId}`): `viewBodyOk` lists the allowed `type` values, and `viewSettingsOk` lists the allowed `settings` keys with an `is map` check for each. A new type is refused until both lists have it.
- **Web registration points** (each has an exhaustive switch or a typed map, so typecheck finds a missing case): `board-views/view-actions.ts` (`LABELS`, `newViewSettings`), `board-views/ViewTabs.tsx` (tab icon map, "Add view" menu, `SOON_VIEWS`), `pages/BoardPage.tsx` (`ViewBody`), `board-filters/filter-store.ts` (`TypeSettingsMap`, `TYPE_KEYS`, `TYPE_DEFAULTS`), `board-table/BoardToolbar.tsx` (`variant`). The Excel export (`boards/view-sheet-data.ts` `SHEET_TYPES`, `packages/shared/src/workbook/view-sheets.ts`) only exports the types it lists, so `files` is skipped like `form`.
- **Item selection with filters:** `selectItems` in `board-date-views/date-view-model.ts` applies the board filter, person filter and search (Chart and Calendar use it). `ChartView.tsx` shows the wiring (`useBoardFilter`, `useTableStore` search, `useViewTypeSettings`).
- **Files values:** `filesValueSchema` is `{ files: FileAttachment[] }`; `FileAttachment` is `{ id, name, storagePath, size, mimeType, uploadedAt, uploadedBy }` (`packages/shared/src/columns/files.ts`). Files columns are server-managed (FW2), so the gallery only reads them.
- **Downloads:** `fileCalls.getDownloadUrl({ boardId, itemId, columnId, fileId })` (`lib/callables.ts`) returns a short-lived signed URL. The callable checks the caller's board role in a transaction (`functions/src/lib/file-storage.ts`), so a viewer may download. Every call is one Function invocation.
- **Thumbnails today:** `UpdateAttachments.tsx` has a private `Thumbnail` that waits for an `IntersectionObserver` hit, fetches the URL once and falls back to the type icon (`attachmentIcon(mimeType)` in `update-attachments.ts`). `isImageType` lives there too.
- **Storage rules can't read Firestore** (named database `atrium-1`), so every byte goes through the signed-URL callables. This spec keeps it that way.
- **The sidebar Files tab** (`item-card/ItemFilesTab.tsx`) exists, and the item card store has a `'files'` tab.
- **Visual tests:** the emulator run has auth, Firestore and Functions but no Storage emulator, so a thumbnail fetch fails and the card shows its type icon. That is deterministic.
- **monday reference:** `docs/reference/monday-ui-reference.md` has no Files view section yet. Opus captures it with Claude in Chrome (read-only, owner-approved 2026-10-23) and adds a `## Files view` section before PR 1's visual QA. Until then the layout below is the target.

## Scope

- The `files` view type end to end: schema, rules and rules tests, web registration, the grid, open and download, empty states.
- Gallery controls: files column picker, file type chips, sort, all saved with the view.
- A shared lazy thumbnail with a URL cache and a small concurrency cap.
- Tokens in a new `apps/web/src/theme/files-view-tokens.css` (not `tokens.css`).
- Showcase: a Files gallery view on the showcase board.

## Non-goals

- Update and reply attachments in the gallery (see below).
- Subitem files, archived or trashed items.
- Uploading from the gallery, deleting from it, renaming files. Upload and delete stay in the cell and the sidebar.
- An in-app preview or lightbox, PDF previews, video posters.
- Server-made thumbnails (resized images). Images load at full size through the signed URL, lazily.
- Export of the view to Excel.
- Any Storage rules, Functions or `firebase.json` change.

## Design

### Layout

```
| [Search] [Person] [Filter]            42 files  [Files: All v] [Type: All v] [Newest v] |  toolbar
|------------------------------------------------------------------------------------------|
| +-----------+  +-----------+  +-----------+  +-----------+                              |
| | thumbnail |  |   [PDF]   |  | thumbnail |  |  [XLSX]   |                              |
| +-----------+  +-----------+  +-----------+  +-----------+                              |
| site-plan.png  brief.pdf      hero@2x.jpg    budget.xlsx                                |
| Ship the pip.. Kickoff deck   Landing page   Q3 budget        <- item name (link)       |
| Files · 2 MB   Specs · 140 KB ...                                 <- column · size · when|
|                              [ Show more ]                                              |
```

- **Toolbar:** `BoardToolbar` with a new `variant="files"` that shows Search, Person and Filter (as `chart`). Search matches the item name and also the file name (the view applies the file-name part itself after `selectItems`). Trailing: the file count ("1 file" / "N files"), then the three pickers (PR 2).
- **Grid:** a `<ul aria-label="Files">` with `display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--atrium-files-card-min), 1fr))`, gap `var(--atrium-files-grid-gap)`, page padding as the Chart view. The content area scrolls; the toolbar doesn't.
- **Card** (`<li>`): a thumbnail button (4:3, `object-fit: cover` for images; for other files a tinted box with the type icon and the upper-case extension), then the file name (one line, ellipsis, `title` with the full name), then the item name as a small text button (secondary color, one line), then a meta line: column title · size (`formatFileSize`) · relative upload time (`formatRelativeShort`). Hover: the card gets `--box-shadow-xs` and the name underlines; no layout animation (`prefers-reduced-motion` respected; the shadow change is not motion).
- **Order** (default): newest upload first; ties by item position, then file name. One card per file, so an item with three files has three cards.
- **Paging:** render the first 120 cards and a "Show more" button that adds 120. No virtualisation in v1.

### Open and download

- **Thumbnail button** (`aria-label="Open {file name}"`): calls `fileCalls.getDownloadUrl` and opens the URL in a new tab (`noopener,noreferrer`), toast "Could not open the file. Try again." on failure (`describeCallableError`). Same as `columns/files.tsx` `handleDownload`; extract that into `openColumnFile(target)` in `apps/web/src/lib/file-open.ts` and use it in both places.
- **Item name button:** `openItem(boardId, itemId, { tab: 'files' })`.
- **Thumbnails:** move `Thumbnail` out of `UpdateAttachments.tsx` into `components/files/LazyThumbnail.tsx` with a `fetchUrl: () => Promise<string>` prop and a `size` prop, and use it in both places (update chips unchanged to the eye). Add a module-level URL cache keyed by `boardId/itemId/columnId/fileId` that reuses a URL until 60 s before its `expiresAt`, and a queue that runs at most 4 fetches at once. Opening a file reuses a cached URL when it is still fresh.

### Gallery controls (PR 2)

Saved in `settings.files` and dirty-tracked like the other views ("Save to this view"):

- **Files column picker:** "All files columns" or a checked list of the board's files columns. Hidden when the board has one files column.
- **Type chips** in a menu: Images, PDFs, Documents, Spreadsheets, Presentations, Video, Audio, Archives, Other. None checked means all. The kind comes from a pure `fileKind(mimeType, name)` (mime first, extension as fallback).
- **Sort:** Newest, Oldest, Name (A to Z), Item (board order).

### Empty states (VF3 pattern, `EmptyState`)

- Board without a files column: "No Files column yet" / "Add a Files column to collect files here, then they show up in this view." No button (adding columns stays in the table).
- Files columns but no files: "No files yet" / "Files added to this board's Files columns show up here."
- Filters leave nothing: "No files match" / "Try other filters or clear the search."

### Update attachments (not in this spec)

Update docs live under `boards/{b}/items/{i}/updates/{u}` and carry no `boardId`, so the client has no cheap board-wide query: a listener per item does not scale, and a collection-group query needs a new rules match and a field to filter on. The two real options are (a) a read callable that lists a board's attachments with the Admin SDK, paid per open, or (b) a server-maintained `boards/{b}/fileIndex` collection written by the attachment Functions, with rules, a backfill and tests. Both touch `packages/shared`, Functions and (b) `firestore.rules`. Opus writes an amendment when the owner asks for it; until then the gallery shows column files only and the empty-state copy says so.

## Data model and rules

- `packages/shared/src/schemas/view.ts`: add `'files'` to `viewTypeSchema`; add
  ```ts
  export const FILES_VIEW_KINDS = [
    'image',
    'pdf',
    'document',
    'spreadsheet',
    'presentation',
    'video',
    'audio',
    'archive',
    'other',
  ] as const;
  export const filesViewSettingsSchema = z.object({
    /** Files columns shown; null = every files column. */
    columnIds: z.array(columnIdSchema).max(60).nullable(),
    /** File kinds shown; empty = all. */
    kinds: z.array(z.enum(FILES_VIEW_KINDS)).max(FILES_VIEW_KINDS.length),
    sort: z.enum(['newest', 'oldest', 'name', 'item']),
  });
  export function defaultFilesViewSettings() {
    return { columnIds: null, kinds: [], sort: 'newest' };
  }
  ```
  and `files: filesViewSettingsSchema.optional()` in `viewSettingsSchema`. Tests in `view.test.ts`.
- `firestore.rules`: `'files'` in the `d.type in [...]` list, `'files'` in `viewSettingsOk`'s `hasOnly`, and `&& (!('files' in s.keys()) || s.files is map)`. Nothing else changes; reading files still goes through the callables.
- New `tests/rules/src/views-files.test.ts` (pattern: `views-workload.test.ts`): an editor creates a shared `files` view; a viewer creates a personal one; a `files` view with a non-map `settings.files` is refused; an unknown type is still refused.
- No item, board or Storage change. No index.

## Pure functions (unit-tested, `apps/web/src/components/board-files/files-view-model.ts`)

- `collectFiles({ items, columns, settings, search }) → FileCard[]`: walks active top-level items (already filtered by `selectItems`) and the chosen files columns, one entry per `FileAttachment` with `itemId`, `itemName`, `columnId`, `columnTitle`, `file`; applies the file-name half of the search (case-insensitive substring of file or item name), the kinds, then the sort.
- `fileKind(mimeType, name)`: `image/*` (and `.png .jpg .jpeg .gif .webp .svg .heic`), `application/pdf`, Word and OpenDocument text, Excel, CSV and OpenDocument sheets, PowerPoint and OpenDocument presentations, `video/*`, `audio/*`, zip, 7z, rar, tar, gzip, else `other`.
- `fileExtensionLabel(name)`: the upper-case extension, max 5 characters, or "FILE".

## Components and files

| File                                                                                                                                  | Change                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/shared/src/schemas/view.ts`, `view.test.ts`                                                                                 | type, settings schema, defaults (PR 1)                            |
| `firestore.rules`, `tests/rules/src/views-files.test.ts`                                                                              | allow the type and the settings key (PR 1)                        |
| `apps/web/src/components/board-files/FilesView.tsx`, `.module.css`                                                                    | the view (PR 1), pickers (PR 2)                                   |
| `apps/web/src/components/board-files/FileCard.tsx`                                                                                    | one card (PR 1)                                                   |
| `apps/web/src/components/board-files/files-view-model.ts` (+ test)                                                                    | pure functions (PR 1; kinds and sort used by the UI in PR 2)      |
| `apps/web/src/components/board-files/FilesViewControls.tsx`                                                                           | column, kind and sort menus (PR 2)                                |
| `apps/web/src/components/files/LazyThumbnail.tsx` (+ test)                                                                            | extracted thumbnail, cache, queue (PR 1)                          |
| `apps/web/src/lib/file-open.ts`                                                                                                       | `openColumnFile`, used by `columns/files.tsx` and the card (PR 1) |
| `item-card/UpdateAttachments.tsx`                                                                                                     | uses `LazyThumbnail` (PR 1, no visible change)                    |
| `board-views/view-actions.ts`, `ViewTabs.tsx`, `pages/BoardPage.tsx`, `board-filters/filter-store.ts`, `board-table/BoardToolbar.tsx` | registration (PR 1)                                               |
| `apps/web/src/theme/files-view-tokens.css` + import in `main.tsx`                                                                     | tokens (PR 1)                                                     |
| `scripts/showcase/data.mjs`                                                                                                           | a shared "Files gallery" view on the showcase board (PR 1)        |
| `tests/visual/src/seed.ts`, a views spec                                                                                              | a small seeded "Files board" and the screens (PR 1, PR 2)         |

## Tokens (`files-view-tokens.css`)

`--atrium-files-card-min` (180 px), `--atrium-files-grid-gap` (`var(--space-16)`), `--atrium-files-thumb-ratio` (`4 / 3`), `--atrium-files-thumb-bg` (`var(--ui-background-color)`), `--atrium-files-thumb-radius` (`var(--border-radius-small)`), `--atrium-files-ext-font` (Vibe `--font-text3-bold` or nearest), with dark values where a Vibe variable doesn't already switch. Adjust the numbers to the monday capture.

## Accessibility

- The grid is a list; each card has two buttons (open file, open item) in that tab order, and the meta line is plain text.
- Thumbnails are decorative (`alt=""`); the button's label carries the file name.
- The pickers are Vibe menus with checkable items; the count is in an `aria-live="polite"` span so filtering announces it.

## Tests

- **Unit (Vitest):** `files-view-model.test.ts` (collect across columns and items, search on file and item name, kinds, every sort, ties, archived and subitems excluded), `LazyThumbnail.test.tsx` (fetch on intersect only, cache reuse until expiry, at most 4 in flight, icon fallback on error), `FilesView.test.tsx` (three empty states, count, open calls `getDownloadUrl` with the right ids, item click opens the panel on Files), `view-actions` test for the new type's default settings, `ViewTabs.test.tsx` for the menu entry.
- **Rules:** as listed above.
- **Visual (Playwright):** seed a separate small "Files board" (two files columns, six items, eight files: png, jpg, pdf, docx, xlsx, zip) so no existing baseline changes. Screens `files-view-{theme}` (desktop, PR 1) and `files-view-filtered-{theme}` (a kind chip on, PR 2). Wait for the cards and the icon fallbacks, not network idle.

## Acceptance criteria

1. "Add view" → "Files gallery" creates a "Files" tab (shared for editors, personal for viewers, as other views) and it survives a reload.
2. The grid shows one card per file in the board's files columns, newest first, with file name, item name and the meta line; archived and trashed items and subitems are absent.
3. Clicking a card opens the file in a new tab; a viewer can too. Clicking the item name opens the side panel on Files.
4. Search, Person and Filter narrow the cards; search also matches file names.
5. Image thumbnails load only when scrolled into view and are fetched once per file per URL lifetime; at most four fetches run at once.
6. (PR 2) The column, kind and sort pickers work, mark the view dirty, and "Save to this view" keeps them.
7. The three empty states show the copy above.
8. `firestore.rules` changes only the views lists; rules tests pass; no Storage rules or Functions change.
9. Tokens only (`pnpm lint`); light and dark compared with the monday capture, gaps fixed or logged in VF.

## Task breakdown (Sonnet-ready)

Each PR starts from fresh `origin/main` in its own worktree (`/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>`, own `ATRIUM_PORT_OFFSET`).

| #   | Branch                       | Offset | Depends on | Hot spots touched                                                                                             |
| --- | ---------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `claude/files-view-1`        | 10     | none       | `packages/shared/**`, `firestore.rules`, `tests/rules/**`, `tests/visual/__screenshots__/**` (new files only) |
| 2   | `claude/files-view-controls` | 20     | PR 1       | `tests/visual/__screenshots__/**`                                                                             |

Not touched by either: `apps/web/src/theme/tokens.css`, `firebase.json`, `pnpm-lock.yaml` (no new dependency). Schedule PR 1 after any other open PR that edits `firestore.rules` or `packages/shared/src/schemas/view.ts`, and rebase it before merging.

### PR 1: the view, the grid, open and download (small and shippable)

1. Shared schema, defaults and tests; rules lists and rules tests.
2. `fileKind`, `fileExtensionLabel`, `collectFiles` with the default sort only; tests first.
3. Extract `LazyThumbnail` (cache, queue) and `openColumnFile`; switch `UpdateAttachments` and `columns/files.tsx` to them with no visible change.
4. Register the type (actions, tabs, menu, `BoardPage`, filter store, toolbar variant).
5. `FilesView` and `FileCard`, count, "Show more", empty states, tokens.
6. Showcase view in `scripts/showcase/data.mjs`.
7. Visual seed board and the `files-view` screens; all checks; the baseline workflow.

### PR 2: gallery controls

1. `FilesViewControls` (column, kind, sort), wired to `useViewTypeSettings(boardId, 'files')` and `setTypeSettings`.
2. Kind and sort paths of `collectFiles` exercised by the UI; tests.
3. The `files-view-filtered` screen; checks; the baseline workflow.

Each PR description: what changed, the Roadmap item, light and dark screenshots, the baseline diffs, and the model that wrote the code.

## What Ophelia (Opus) reviews

- No second copy of the thumbnail, download or filter logic: the view uses `selectItems`, `LazyThumbnail` and `openColumnFile`.
- The rules diff is the three list entries and nothing more.
- Signed URLs never land in Firestore, logs or `localStorage`; the cache is in memory only.
- Only the new screens changed in the baseline diff.

## Owner checks (production)

1. On a board with a Files column, add a "Files gallery" view: every file shows, newest first.
2. Click an image card: it opens in a new tab. Click the item name: the side panel opens on Files.
3. Type part of a file name in Search: only matching cards stay.
4. (PR 2) Pick "PDFs" and save the view; reload: the filter is still on.

## Risks

- **Function calls per thumbnail.** Each image costs one `getFileDownloadUrl` call the first time it scrolls into view. The lazy load, cache and cap keep a normal board cheap; a board with hundreds of images still makes hundreds of calls over a long scroll. If that shows up in billing, the follow-up is a batch URL callable (up to 50 files per call), which touches `packages/shared` and Functions.
- **Full-size images as thumbnails.** Large photos load in full. Acceptable for a personal app; resized thumbnails need a Storage trigger and are out of scope.
- **Shared hot spots.** PR 1 touches `firestore.rules`, `tests/rules/**` and `packages/shared/**`; keep its rules diff to the views lists so it rebases cleanly.
- **The monday capture may move details** (card size, meta line). Treat the numbers here as defaults; the capture wins for layout.
