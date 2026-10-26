# Handoff: P1c Review Resolutions, P1b Integration & P2 Columns Revisions

- **Date:** 2026-10-24
- **Agent:** Ava (Antigravity)
- **Lead:** Ophelia (Claude Opus 5.5)
- **Tasks Addressed:**
  - [PR #4](https://github.com/halfklrrex/atrium/pull/4): P1c: Undo, archive & trash (Merged)
  - [PR #6](https://github.com/halfklrrex/atrium/pull/6): P1c: Item card & updates feed (Merged)
  - [PR #12](https://github.com/halfklrrex/atrium/pull/12): feat(shared): P2 simple column types (Merged)
  - [PR #13](https://github.com/halfklrrex/atrium/pull/13): feat(shared): P2 computed columns (Pending Merge)

---

## 1. Summary of Changes

### PR #4 (`ag/undo-archive-trash`)

- **Review resolutions:**
  - Board purge uses `firestore.recursiveDelete(boardRef)` (firebase-admin) to recursively remove child subcollections (`items`, `updates`, `replies`).
  - Added composite indexes in `firestore.indexes.json` for `boards` (`state` ASC, `deletedAt` ASC) and collection-group `items` (`queryScope: "COLLECTION_GROUP"`, `state` ASC, `deletedAt` ASC).
  - Configured `onSchedule` in `purgeTrash.ts` with `timeZone: 'UTC'`, `timeoutSeconds: 540`, `memory: '512MiB'`, and switched to `logger` from `firebase-functions/logger`.
  - Documented deploy prerequisite (`roles/cloudscheduler.admin` on `github-deployer`).
- **Status:** Merged to `main` by Ophelia (`028e631`).

### PR #6 (`ag/item-card-updates`)

- **Review resolutions & Lead integration:**
  - Implemented `validLikesUpdate()` in `firestore.rules` preventing forged likes (`diff.hasOnly([uid()])`, uniqueness check).
  - Restricted `repliesCount` to delta increment of `±1` on create/delete.
  - Reverted root `package.json` and `scripts/test-rules.mjs` script modifications.
  - Resolved all VF4 Stylelint token violations using Vibe and Atrium theme variables (`--atrium-scrim`, `--atrium-panel-shadow`, `--atrium-font-weight-semibold`, `var(--border-width)`).
  - Wired `openItem(boardId, itemId)` in `apps/web/src/components/board-table/open-item.ts` directly to `useItemCardStore.getState().open(boardId, itemId)`.
- **Status:** Merged to `main` by Ophelia (`090c534`).

### PR #12 (`ag/columns-simple`)

- **Review resolutions (all 12 points addressed):**
  1. Updated type slug to `tags` in `tags.ts`, spec, and tests.
  2. `tags` value schema is strictly `{ tag_ids: number[] }` (allowing `tag_ids: []` treated as empty). `toText` looks up names from settings `tags: [{ id, name, color? }]`.
  3. `color_picker` value is strictly `{ color: { hex: "#RRGGBB" } }`.
  4. Removed `color` alias; only canonical `color_picker` is registered.
  5. `vote` value is strictly `{ votersIds: string[] }` (unique, max 1000). Dropped stored `voters` and `vote_count`.
  6. `rating` settings renamed to `limit` (3..10) and added `symbol: 'stars' | 'hearts'`. Added `.strict()`.
  7. Exported `isRatingWithinLimit(value, settings)` helper with tests.
  8. `country` value is strictly `{ countryCode: string, countryName?: string }`. Removed nested form and getters.
  9. `phone` requires at least 5 digits (`.refine(s => s.replace(/\D/g, '').length >= 5)`). Comparer uses `{ numeric: true }`.
  10. Rewrote `simple-columns.test.ts` (34 tests) covering round-trips through registry `parseValue`/`toText`, unknown keys rejection, rating limits, and location coordinate bounds (±90 / ±180).
  11. Updated `registry.test.ts` (dropped `'color'`, renamed `'tag'` to `'tags'`).
  12. Updated `docs/specs/P2-columns-simple.md`.
- **Status:** Merged to `main` by Ophelia (`86f15be`).

### PR #13 (`ag/columns-computed`)

- **Review resolutions (all follow-up points addressed):**
  1. Converted purely derived types to standalone compute helpers and flagged with `// TODO(derived)`:
     - `computeItemId(item, settings)` and `formatItemId(id, settings)`
     - `computeCreationLog(item)`
     - `computeLastUpdated(item)`
     - `computeProgress(item, settings, statusColumns)`
     - `auto_number` is strictly `{ auto_number: int >= 0 }` (server-assigned).
  2. `progress`: status matching uses `statusValueSchema.safeParse` and `findStatusLabel(parsed, settings)?.isDone`. Added edge case tests for weighted non-normalized columns, label-text matching, missing column entries, and invalid values.
  3. `item_id`: unified `formatItemId` for compute and `toText`. Added `superRefine` ensuring `customKey` requires `customKeySettings`. Dropped `padding` and "pulseId" semantics.
  4. `creation_log` and `last_updated`: extracted shared `timestampToIso` supporting ISO string, Date, or Firestore `{ toDate(): Date }`, returning null if pending server timestamp.
  5. Updated `docs/specs/P2-columns-computed.md` documenting derived flag lifecycle.
  6. Rebased cleanly on `origin/main` (dropping duplicate #12 commits).

---

## 2. CI Status Matrix

| PR                                                  | Branch                  | Status          | Note                     |
| --------------------------------------------------- | ----------------------- | --------------- | ------------------------ |
| [#4](https://github.com/halfklrrex/atrium/pull/4)   | `ag/undo-archive-trash` | Merged (`028e`) | Merged into main         |
| [#6](https://github.com/halfklrrex/atrium/pull/6)   | `ag/item-card-updates`  | Merged (`090c`) | Merged into main         |
| [#12](https://github.com/halfklrrex/atrium/pull/12) | `ag/columns-simple`     | Merged (`86f1`) | Merged into main         |
| [#13](https://github.com/halfklrrex/atrium/pull/13) | `ag/columns-computed`   | Pending Merge   | Rebased on main; reviews |
