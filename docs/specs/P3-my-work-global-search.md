# P3: My Work and global search

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: P3 "My Work & global search" (3306219645) · Branches `claude/item-index`, `claude/my-work`, `claude/global-search`

## Goal

- **My Work** (`/my-work`): every item and subitem assigned to me in a People column, on any board I can read, in one table grouped by date as in monday: **Past dates, Today, This week, Next week, Later, Without a date, Done**. Search box, row click opens the item card.
- **Global search** ("Search everything"): one dialog, opened from the top bar's Search icon, Home's "Quick Search" button and a keyboard shortcut. It finds workspaces and boards by name and items by name, across every workspace I belong to, and never shows anything from a board I can't read (P4b private and shareable boards included).

## Facts (main at `1e1cd0a`)

- **My Work today** is a shell: `pages/MyWorkPage.tsx` (title, Table and a disabled Calendar tab, disabled "New item", a `Search` box, the `EmptyMyWork` empty state with its "Learn about My work" popover). The route exists (`App.tsx`) and the sidebar links to it.
- **Search today:** the top bar's Search button (`components/AppShell/TopBar.tsx`, `ACTIONS`) and Home's "Quick Search" (`pages/HomePage.tsx:76`) both call `showComingSoon`. The sidebar has a per-workspace board-name filter (`Sidebar.tsx`, `filterTree`), which stays as it is.
- **People values** are `values.<colId> = { personsAndTeams: [{ id: uid, kind: 'person'|'team' }] }` (`packages/shared/src/columns/people.ts`). Column ids differ per board and the uid is nested in an array of maps, so **no Firestore query can find "items assigned to me"** from the stored values.
- **Boards I can read:** per workspace, two listing queries merged by id (`queries.mainBoardsInWorkspace`, `queries.myBoardsInWorkspace` in `data/firestore.ts`; `useAllWorkspaceBoards` in `data/hooks.ts`). The rules (`firestore.rules` ~345-352) only allow those two shapes, and only for workspaces the caller still belongs to. Workspaces: `where('memberIds','array-contains',uid)`.
- **Item reads** are authorised per board (`allow read: if canReadBoard(boardId)`, ~585), with the board id in the path. There is **no `{path=**}/items` match**, so collection-group queries on `items` are denied to clients. That is correct and stays: a collection-group rule can't prove board access for every result, and an "assigned to me" rule alone would leak items from boards I lost access to.
- **Item writes** use key allow-lists (`validItemCreate`, `validItemUpdate`): a field in neither list is Functions-only, like `seq` and `boardSeq`.
- **The item trigger** `onItemPeopleAssigned` (`functions/src/triggers/`, logic in `functions/src/lib/notifications.ts`) already runs on every item write and reads the board when `values` changed. `onItemCreated` shows the pattern for metadata writes that don't touch `updatedAt`/`updatedBy`.
- **Helpers to reuse:** `isRowDone` (`board-table/table-env.ts`), `buildColumnViews` and `itemMatchesSearch` (`board-table/table-model.ts`), `lib/date-grid.ts` (`todayIso`, `addDays`, `weekStart`, all UTC over ISO days), `useUserLookup`, `useRecents`, `UserAvatar`, `EmptyState`, `ui-store`'s `openDialog` / `DialogHost`.
- **Indexes:** `firestore.indexes.json` has no index on items other than the purge's collection-group `state` + `deletedAt`.

## Design decisions (log on the Decisions board when approved)

1. **Two server-maintained index fields on every item.** `assigneeUids: string[]` (sorted unique uids of `kind: 'person'` entries across the board's People columns; `subitemColumns` for subitems) and `nameTokens: string[]` (search tokens of `name`, decision 4). Written only by Cloud Functions; clients can't write them because they're in neither key list. **No rules change.**
   - Rejected: a client-written field (rules can't compute a union over dynamic column ids, so it would be unverifiable); a `users/{uid}/assignments` fan-out index (it would hold copies of item data that outlive a lost board access, and needs cleanup on every access change).
2. **My Work queries per board, never across boards.** For each active board I can list, one listener on `boards/{b}/items where assigneeUids array-contains me and state == 'active'`. The existing per-board read rule authorises it, so access to private boards, removed members and lost shares is enforced by the rules exactly as on the board page. Cost: 1 read per board on open (Firestore bills an empty result as one read) plus only my items, then live deltas.
   - Cap: **100 boards** (by most-recent visit first, then name). Above it, a notice "Showing work from 100 of N boards". Family scale is far below this.
3. **The client re-verifies.** `assigneeUids` is an index hint. The web recomputes it with the same shared function from the item's values and the board's current columns and drops items that no longer match (a deleted People column leaves a stale hint until the item's next write). A column changed _to_ People writes its values through the Admin SDK, which fires the trigger, so false negatives don't arise.
4. **Item search uses Firestore token queries, per board; no external search service.** Tokens: lowercase, diacritics stripped (NFKD), split on anything that isn't a letter or digit, every prefix of each word from 2 to 15 characters, unique, at most 100 per item. A search takes the **longest word** of the term (cut to 15 characters) and runs `items where nameTokens array-contains <word> and state == 'active' limit 10` on each readable board, at most 10 queries in flight; the client then requires every word of the term as a substring of the name.
   - Rejected: a Cloud Function that scans items (reads every item per search); Algolia/Typesense (a paid third party holding family data outside `eur3`); loading every item client-side (reads every item of every board); `name` range prefix queries (case-sensitive, first word only).
   - Cost: at most (readable boards + matches) reads per settled search. With 30 boards and 10 searches a day per person, well under Blaze's free tier.
5. **Boards and workspaces are searched client-side** from the board listing documents, already the source of the sidebar. Only `state == 'active'` boards.
6. **Updates are not searched in v1** (they'd need their own tokens on a much larger collection). See Out of scope.
7. **Shortcut: Ctrl/Cmd+B** (monday's) **and Ctrl/Cmd+K** (approved plan, common elsewhere) open search. It's ignored while focus is in an input, textarea, select or contenteditable, so bold in the description editor keeps working. It calls `preventDefault` (Firefox's bookmarks sidebar).
8. **My Work v1 is read-only.** Cells render with the column modules' `Cell` (`canEdit: false`); a row click opens the item at `/boards/:b/items/:i`. Inline editing, "New item", Calendar tab and "Customize" (choose the date column per board) come later.

## Data model and indexes (PR 1)

- `boards/{b}/items/{i}`: `assigneeUids?: string[]`, `nameTokens?: string[]`. Absent until the trigger or the backfill has run (reads as `[]`).
- `packages/shared/src/item-index.ts` (pure, exported from `index.ts`):
  - `assigneeUidsOf(columns, values): string[]` (People columns only, persons only, sorted unique, uses `peopleValueSchema.safeParse`);
  - `nameTokensOf(name): string[]` and `searchWordsOf(term): string[]` (same normalisation; `searchWordsOf` returns the words, longest first, each cut to 15);
  - `itemIndexFields(board, item) -> { assigneeUids, nameTokens }` picking `columns` or `subitemColumns` by `parentItemId`;
  - `ITEM_INDEX_LIMITS = { maxTokens: 100, minPrefix: 2, maxPrefix: 15 }`.
- `functions/src/lib/item-index.ts`: `syncItemIndexFields(store, change)`. Returns early unless `name` or `values` changed (or the fields are missing). Reads the board only when `values` changed (share the read with `notifyPeopleAssigned`: fetch once in the trigger and pass it to both). Writes both fields with one `update` only when either differs, without `updatedAt`/`updatedBy`. Its own write retriggers and finds nothing to do. Skips `state == 'deleted'`.
- `onItemPeopleAssigned` calls it first. Keep the trigger's name (a rename deletes and recreates it on deploy); update its doc comment.
- `firestore.indexes.json`, two `COLLECTION`-scope indexes on `items`: `assigneeUids` CONTAINS + `state` ASC, and `nameTokens` CONTAINS + `state` ASC.
- `scripts/migrations/2026-11-backfill-item-index.mjs` (pattern: `2026-10-backfill-item-seq.mjs`): dry run unless `--apply`, emulator without `--project`, batches of 400, precondition on `updateTime`, writes only changed items. Test next to it.
- Client duplication and copy paths must not copy the two fields (the rules would refuse the create). Check `data/item-writes.ts` builds new items from explicit keys; add a test.
- `docs/architecture.md` §5.5: document both fields and decisions 1-4.

## Web: My Work (PR 2)

- **Data** (`data/my-work.ts`, queries added to `data/firestore.ts`):
  - `useReadableBoards(uid)`: live board docs across all my workspaces (workspaces listener, then the two listing queries per workspace, merged, `state == 'active'`). Imperative listener set like `useBoardsByIds`, rebuilt when the workspace id set changes. PR 3 reuses it.
  - `useMyWorkItems(uid)`: the per-board listeners of decision 2, capped, returning `{ rows, loading, error, truncated }`. A board whose listener errors (access lost mid-session) is dropped silently; `error` only when every listener failed.
- **Model** (`pages/my-work/my-work-model.ts`, pure, unit-tested): `bucketOf(row, todayIso, firstDayOfWeek='monday')`:
  - **Done** when `isRowDone` (first status column's label `isDone`), whatever the date;
  - otherwise the date is the first `date` column (by position), else the first `timeline` column's `to`;
  - Past dates (before today), Today, This week (rest of the current week), Next week, Later, Without a date.
  - Rows inside a bucket sort by date, then board name, then item position. Search filters by item name, board name and group title (case-insensitive substring, the page's existing `Search`).
- **Page** (`pages/MyWorkPage.tsx`, `MyWork.module.css`): keep the header, tabs and toolbar. Below, one collapsible section per non-empty bucket (`CollapsibleSection`: title in the bucket's colour token, count), Done collapsed by default. Table columns (fixed widths as tokens): **Item** (name; subitems get the subitem icon), **Board** (board icon by kind + name, workspace name in secondary text), **Group** (colour dot + title), **People** (that board's first People column), **Date**, **Status** (first status column). Cells reuse the column modules' `Cell` read-only. Row height and borders follow the board table tokens.
- **States:** loading shows Vibe `Skeleton` rows; no assigned items keeps today's `EmptyState`; no search match shows "No items match your search"; all-failed shows an error `EmptyState` with a Retry button; the truncation notice sits above the table.
- **Tokens only.** Bucket colours: add named tokens to `theme/` only if Vibe has none (`--my-work-bucket-*`); this touches `tokens.css` (hot spot) in PR 2 only.

## Web: global search (PR 3)

- `ui-store`: dialog type `{ type: 'search'; initialTerm?: string }`. `components/search/SearchDialog.tsx` rendered by `DialogHost`, using Vibe `Modal` (width as monday's "Search everything", about 720), a `Search` input autofocused, and `TabList` **All / Boards / Items**.
- **Empty term:** "Recent boards" from `useRecents` (up to 8).
- **Typing:** workspaces and boards filter instantly (decision 5). Items start at 2 characters, debounced 300 ms, through `searchItems(boards, term, signal)` in `data/search.ts` (decision 4; a newer term aborts the older run; results stream in per board). Merge, prefer names that start with the term, cap 50, show "Searching N boards" while running.
- **Rows:** board rows = kind icon, name, workspace breadcrumb; item rows = name, "Board › Group" breadcrumb, subitem icon when it is one; the matched text highlighted like `NotificationCard`. Enter or click navigates (`/boards/:b`, `/boards/:b/items/:i`, `/workspaces/:w`) and closes.
- **Keyboard:** Up/Down move the active row (`aria-activedescendant`, `role="listbox"`), Enter opens, Esc closes, Ctrl/Cmd+B or Ctrl/Cmd+K toggles (decision 7; one listener in `AppShell`).
- **Wiring:** TopBar's Search action and Home's Quick Search open the dialog (remove them from the coming-soon path).
- **States:** "No results for “term”" with the `NoSearchResults` illustration; an items error shows an inline "Couldn't search items" with Retry while board results stay.

## Rules and tests

No rules change. PR 1 adds `tests/rules/src/item-index.test.ts`:

- a client can't create an item with `assigneeUids` or `nameTokens`, and can't change or remove them on update (owner included);
- a workspace member can run the per-board `assigneeUids array-contains` and `nameTokens array-contains` queries on a `main` board, and is **denied** them on a private board they aren't on, and after removal from the workspace;
- a collection-group `items` query with `assigneeUids array-contains uid` is denied.

Other tests:

- **Shared:** token normalisation (accents, punctuation, numbers, emoji, very long names capped at 100), `searchWordsOf` ordering, `assigneeUidsOf` (teams ignored, invalid values ignored, subitem columns for subitems).
- **Functions (fakes):** fields written on create; name change rewrites tokens without a board read; values change rewrites assignees; no write when equal (idempotent retry, own-write loop); deleted items skipped; `updatedAt` untouched. Backfill script test.
- **Web PR 2:** bucketing across week and month boundaries and Sunday/Monday, Done precedence, date fallback to timeline, client re-verification drops stale rows, search filter, the cap notice, the four states, row click navigation.
- **Web PR 3:** shortcut ignored in inputs and contenteditable, keyboard navigation, abort on a newer term, board and item results, private board not queried when not listed, error state.
- **Visual:** PR 2 adds a My Work screen with assigned items (light and dark) to `tests/visual/src/screens.spec.ts` (seed assignees in `seed.ts`); PR 3 adds the search dialog with a term. Run the baseline workflow per PR.
- **Showcase:** assign the showcase items' People cells to the showcase owner if they aren't (`scripts/showcase/data.mjs`) in PR 2, so My Work isn't empty there.

## Out of scope

Searching updates, replies, descriptions, docs and people; search filters (by workspace, date, person); inline editing, "New item", Calendar tab and "Customize" in My Work; teams in People columns; My Work for another person; recent-search history.

## Verify

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build` in every PR.

- PR 1: deploy creates the two indexes (they build for a few minutes; the web PRs merge after they're `READY`: `gcloud firestore indexes composite list --database=atrium-1`). Then Ophelia runs the backfill (dry run, then `--apply`) against production.
- PR 2: on production, assign yourself on two boards in two workspaces plus a private board, check the buckets; remove access to the private board from a second account and confirm its items disappear for that account.
- PR 3: search a word from an item on a private board from an account that isn't on it: no result. Ctrl/Cmd+B in the description editor still bolds.

## PR split (strictly sequential)

1. **PR 1 `claude/item-index`** (hot spots: `packages/shared/**`, `tests/rules/**`; open only when no other open PR touches them):
   `packages/shared/src/item-index.ts`, `packages/shared/src/item-index.test.ts`, `packages/shared/src/index.ts`, `functions/src/lib/item-index.ts`, `functions/src/lib/item-index.test.ts`, `functions/src/triggers/onItemPeopleAssigned.ts`, `firestore.indexes.json`, `tests/rules/src/item-index.test.ts`, `scripts/migrations/2026-11-backfill-item-index.mjs`, `scripts/migrations/backfill-item-index.test.mjs`, `apps/web/src/data/model.ts` (optional fields on `ItemDoc`), `apps/web/src/data/item-writes.ts` + its test (only if duplication copies unknown keys), `docs/architecture.md`.
2. **PR 2 `claude/my-work`** after PR 1 merges and the indexes are READY (hot spots: `apps/web/src/theme/tokens.css` only if a token is needed, `tests/visual/__screenshots__/**` via the workflow):
   `apps/web/src/data/firestore.ts`, `apps/web/src/data/my-work.ts`, `apps/web/src/data/my-work.test.ts`, `apps/web/src/pages/my-work/my-work-model.ts`, `apps/web/src/pages/my-work/my-work-model.test.ts`, `apps/web/src/pages/my-work/MyWorkTable.tsx`, `apps/web/src/pages/MyWorkPage.tsx`, `apps/web/src/pages/MyWork.module.css`, `apps/web/src/pages/MyWorkPage.test.tsx`, `apps/web/src/theme/tokens.css` (if needed), `tests/visual/src/screens.spec.ts`, `tests/visual/src/seed.ts`, `scripts/showcase/data.mjs`.
3. **PR 3 `claude/global-search`** after PR 2 merges (hot spot: `tests/visual/__screenshots__/**` via the workflow):
   `apps/web/src/data/search.ts`, `apps/web/src/data/search.test.ts`, `apps/web/src/components/search/SearchDialog.tsx`, `apps/web/src/components/search/SearchDialog.module.css`, `apps/web/src/components/search/SearchDialog.test.tsx`, `apps/web/src/components/search/search-model.ts`, `apps/web/src/components/search/search-model.test.ts`, `apps/web/src/components/AppShell/ui-store.ts`, `apps/web/src/components/AppShell/AppShell.tsx` (shortcut), `apps/web/src/components/AppShell/TopBar.tsx`, `apps/web/src/components/AppShell/TopBar.test.tsx`, `apps/web/src/components/dialogs/DialogHost.tsx`, `apps/web/src/pages/HomePage.tsx`, `tests/visual/src/screens.spec.ts`.

None of the three touches `firestore.rules`, `firebase.json` or `pnpm-lock.yaml` (no new dependency).

## Questions for the owner

1. Shortcut: decided (owner-approved plan): both Ctrl/Cmd+B and Ctrl/Cmd+K, ignored inside inputs and editors.
2. Should search cover updates in a follow-up? It needs tokens on every update (more index writes); fine at family scale, but it's a separate PR.
3. My Work is read-only in v1 (click opens the item). Is inline editing of Status and Date there a priority for the next pass?
