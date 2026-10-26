# 2026-10-25 · Ava (Antigravity) · Followups & Favourite Star Bug

## Summary

Addressed Ophelia's review feedback on previous PRs (#10, #23, #41) and fixed the favourite star visual bug reported by the owner in item #3308014947.

Both PRs are currently open (at the 2 WIP limit) and awaiting review:

- **PR #45** (`ag/followups-cells`): Review followups for voting `arrayUnion`, `userLookup` in filters, and 16 showcase column types.
- **PR #46** (`ag/bug-favourite-star`): Filled star icon glyph and contrast styling for favourited boards.

---

## What was done

### 1. Review Follow-ups (PR #45 · `ag/followups-cells`)

- **Vote column race protection**:
  - Replaced full-array writes on `votersIds` with atomic `arrayUnion(uid)` and `arrayRemove(uid)` targeting `values.<colId>.votersIds`.
  - Added Firestore rules test in `tests/rules/src/p1b.test.ts` verifying concurrent atomic voting/unvoting passes security rules.
- **Filters & Group-by Real Names (`userLookup`)**:
  - Passed `userLookup` into `BoardTable`, `BoardToolbar`, `PersonFilterPopover`, and `AdvancedFilterPopover`.
  - Resolved user UIDs to real display names from board presence and auth state instead of generic fallbacks.
  - Added unit test coverage in `board-filters.test.tsx`.
- **Showcase Data & Time Web Cells**:
  - Implemented missing web cell display components: `timeline`, `week`, `hour`, and `world_clock`.
  - Registered all 16 column types in `ADD_COLUMN_ORDER` and removed them from `PENDING_TYPES` in `scripts/showcase/data.mjs`.
  - Updated showcase items and verified `showcase.test.mjs` passes.
- **CI Status**: Both `verify` and `visual` passed in GitHub Actions.

### 2. Favourite Star Bug (PR #46 · `ag/bug-favourite-star` · Item #3308014947)

- **Root Cause**: Vibe's `Favorite` icon SVG includes an outer contour and an inner cutout subpath using `clip-rule="evenodd"`. When `color: var(--color-egg_yolk)` is applied, it only colored the boundary stroke, leaving the center hollow and barely visible on white backgrounds.
- **Fix**:
  - Created `FavoriteFilled` icon component matching the exact outer boundary path of Vibe's `Favorite` star (`M11.234 3.016a1.379 1.379 0 0 0-2.47 0l-1.78 3.61-3.99.584h-.003a1.376 1.376 0 0 0-.754 2.348v.001l2.878 2.813-.68 3.97v.001a1.376 1.376 0 0 0 2.005 1.45L10 15.921l3.549 1.866a1.377 1.377 0 0 0 2.005-1.45v-.001l-.68-3.97 2.882-2.81v-.001a1.377 1.377 0 0 0-.753-2.348l-3.989-.58-1.78-3.61Z`) with solid fill.
  - Updated `FavoriteStar.tsx` to render `FavoriteFilled` when `isFavorite === true` and `Favorite` when `false`.
  - Updated `BoardMenu.tsx` to display `FavoriteFilled` for "Remove from favorites".
  - Created unit tests in `apps/web/src/components/boards/FavoriteStar.test.tsx`.
  - Updated Roadmap item #3308014947 to **Pending Merge** with PR link.

---

## Next Steps

- Awaiting review by Ophelia (lead) on PR #45 and PR #46.
- Once merged, proceed with Task 2: `ag/button-files-cells` (table cell UIs for Button, Files with upload/download flows, and optional Time Tracking).
