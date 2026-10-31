# P2: Mirror column, web cell and settings

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: "Connect boards & mirror columns" (3306234642), the mirror half · Branch `claude/mirror-column`

Builds on `P2-connect-boards-mirror.md` (the shared `mirror` type and `computeMirror`, merged) and the Connect boards cell (`columns/board-relation.tsx`, #40).

## Goal

A Mirror column shows a value pulled from the items linked in a Connect boards column on the same board: for example the Status of each linked task, or the sum of their Budget. It is read-only, computed live, and it stores nothing.

## Facts (main after #40)

- `packages/shared/src/columns/mirror.ts` has the settings (`relationColumnId`, `targetColumnIds`: a map `boardId -> columnId`, `aggregation`), the value shape `{ mirroredValues, displayValue }` and `computeMirror(item, settings, connectedItems, targetColumns, registry)`. It is **not** `derived` yet, and `columnRegistry` has no `compute` for it.
- Why it can't use the synchronous `compute(ctx)` hook: it needs the linked items' values, which live on other boards and are read asynchronously.
- `columns/board-relation.tsx` already batches, caches and chunks reads of linked item **names** (`fetchLinkedItemNames`, a session cache, chunks of 30, unreadable items resolve to `null`).
- `ADD_COLUMN_ORDER` in the web registry and `PENDING_TYPES` in `scripts/showcase/data.mjs` (`['mirror']` now) list the types still missing.
- AGENTS.md: a derived column sets `derived: true` and stores nothing; clients never write `values.<id>`; `boards.derivedColumnIds` is maintained by `onBoardColumnsWritten` (it reads the registry's `derived` flag).

## Design decisions

1. **Mirror is derived.** Set `derived: true` on `mirrorColumn` in `packages/shared`, so `validateCell` refuses client values and the server adds it to `derivedColumnIds` (rules then refuse client writes to it). Its `compute()` returns `null` (the shared synchronous path has no data for it); the web computes it in the cell.
   - Check `derived.test.ts` and any test that lists the derived types, and add `mirror` there. This is a `packages/shared` hot-spot change: keep it to the flag, its test and nothing else.
2. **Computed in the cell.** A hook `useMirrorValue(item, settings, columns)` in `apps/web/src/columns/mirror.tsx`:
   - reads the relation value from the item, groups linked refs by board, fetches the linked items **in full** (not just names) with one `getDocs(documentId() in [chunk of 30])` per board and chunk, through a **session cache** shared with `board-relation.tsx` (extend its module, don't write a second cache; export what it needs);
   - looks up the target column definitions for each linked board (from the boards the user can read; a board the user cannot read yields no values, as for names);
   - calls `computeMirror` with the connected items and `columnRegistry`, and renders `displayValue`.
   - While loading, show a muted "..." (never a raw id). Unreadable or deleted linked items are skipped, and if all are, show an empty cell.
3. **Live updates:** linked items are fetched once per session per item and refreshed when the cell mounts again (page navigation). No per-item listeners in v1: with many mirror cells that would be too many listeners. Say this in the code comment and in `docs/architecture.md` §6.2.
4. **No sort, filter, group, or summary on mirror in v1.** The comparator and summaries already exist in shared, but the table sorts on stored values and the mirror isn't stored. Leave the column out of the sort, filter and group-by menus (follow how `formula` and other derived columns are handled there; reuse that mechanism).
5. **Display by target column type:** `none` aggregation shows the mirrored values joined (comma separated, up to 3, then "+N"); status and dropdown targets render as small coloured chips when `displayValue` can be matched to the target's labels, otherwise plain text. Numeric aggregations render with the target's number format. Keep it simple: plain text for everything except status and dropdown chips.

## Settings editor (`ColumnSettings.tsx`)

- **Connect boards column:** a select of the board's `board_relation` columns (none: "Add a Connect boards column first" and the rest of the editor disabled).
- **Target column:** for each board in the chosen relation's `settings.boardIds` that the user can read, a select of that board's columns, excluding `mirror` and `board_relation` themselves (no chains in v1) and server-managed columns that hold no displayable value.
- **Show as:** the `aggregation` select with human labels ("None (show values)", "Count", "Count filled", "Count empty", "Percent filled", "Sum", "Average", "Min", "Max", "Earliest", "Latest"). Offer only the aggregations that make sense for the target types chosen (numeric ones for numbers, `earliest`/`latest` for date, timeline and week targets; the count family always).
- Validate through `mirrorSettingsSchema` and show the first error inline. Reuse the editors' existing `popups.*` styles and Vibe controls where the file already uses them.

## Registry and UI

- Add `mirror` to the web column registry (`columns/mirror.tsx`: `defineColumnUi`, `editor: 'none'`, icon from `@vibe/icons` that fits "mirror" or "reflect", tone per the other connect-type column) and to `ADD_COLUMN_ORDER` right after `board_relation`, as monday lists it. The cell is read-only with the "Managed by Atrium" style used by other non-editable cells only where that is already the pattern for derived columns.
- Remove `mirror` from `PENDING_TYPES`; add a "Linked status" mirror (target: the other board's Status) and a "Total budget" mirror (sum) to the showcase `COLUMNS`, with realistic fictional values, so the showcase shows both a list and an aggregate. The showcase needs a second board for this to work: reuse the existing `showcase-archived-demo`/`showcase-trashed-demo` only if they are readable; otherwise add a `showcase-linked-demo` board (add it to `SHOWCASE_BOARD_IDS`, the allow-list follows) with a few items and a Status and a Numbers column. The relation column added in #40 should link to it.

## Tests

- **Shared:** `mirror` is derived (listed in `derived.test.ts`; `validateCell` refuses a client value).
- **Web:**
  - the cell shows loading, then the mirrored values; unreadable and deleted linked items are skipped; no raw ids ever appear;
  - each aggregation renders (sum with the target's number format);
  - the settings editor: only relation columns are offered, the target selects list the right columns, a bad setting shows the schema error, "no relation column" disables the rest;
  - the cache: two cells linking the same item cause one read.
- **Rules:** none expected (`derivedColumnIds` is already refused for clients); confirm the existing tests cover `values.<mirrorId>` writes being refused once `derivedColumnIds` includes it, and add one case if not.
- **Functions:** `derived-column-ids.test.ts` includes `mirror` in the expected set.
- **Visual:** the showcase isn't a visual-test surface; add the column to an existing table screen only if the seed already has a relation column, otherwise cover it in unit tests.

## Out of scope

Mirrors of mirrors, two-way relations, live per-item listeners, sort, filter and group-by on mirror, mirror in subitems, and editing the mirrored values from the mirror cell.

## Verify

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build`. Hot spot: `packages/shared` (the `derived` flag and its tests only). Open the PR only while no other PR touches `packages/shared`.
