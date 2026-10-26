# 2026-10-24 · Antigravity (Ava) · Board filter, sort, search & group-by (P1)

Branch: `ag/board-filters-sort`  
PR: https://github.com/halfklrrex/atrium/pull/10

## Summary

Integrated the complete client-side filtering, sorting, searching, and dynamic group clustering engine directly into the merged P1b board table (`BoardTable` / `BoardToolbar`) and resolved all Stylelint tokens feedback from Lead review (Ophelia).

### What was updated & integrated

1. **Rebase & Table Integration:**
   - Rebased cleanly onto `origin/main` on top of P1b (`claude/p1b-board-table`).
   - Wired Person, Filter, Sort, and Group by directly into P1b's existing toolbar in `apps/web/src/components/board-table/BoardToolbar.tsx`.
   - Removed the duplicate `apps/web/src/components/board-filters/BoardToolbar.tsx` and obsolete P1a `BoardBody.tsx` placeholder.
   - Reused P1b's existing working search in `useTableStore((s) => s.search)` and `itemMatchesSearch`.
   - Connected `useBoardFilter(board.id)` into `BoardTable.tsx` and `buildGroupModels` in `apps/web/src/components/board-table/table-model.ts`:
     - **Person filter:** filters items matching assigned people.
     - **Advanced filter:** evaluates conditions across all column types using `matchesFilter(item, filterGroup, null, personIds, columns)`.
     - **Multi-sort:** sorts items via `sortItems(items, sortConditions, columns)`.
     - **Dynamic group-by:** clusters items dynamically via `groupItems(items, groupByColumnId, columnDef)` when group-by is selected, falling back to board `groups` when none is selected.
     - Automatically disables row drag-and-drop when filters, custom sorts, or dynamic groupings are active.

2. **Design Tokens & Stylelint (VF4):**
   - Fixed all 11 Stylelint violations in `apps/web/src/components/board-filters/board-filters.module.css`:
     - Replaced hardcoded hex `#ffffff` and `rgba()` colors with `var(--text-color-on-primary)` and `var(--primary-selected-color)`.
     - Replaced raw pixel font-sizes, border-radii, and paddings with Vibe spacing/radius tokens.
     - Replaced numeric font weights (`500`, `600`, `700`) with `var(--font-weight-bold)` and `var(--atrium-font-weight-semibold)`.

3. **Lead Review Feedback Addressed (Ophelia):**
   - **Synthetic Groups:** added `synthetic?: boolean` to `GroupModel`. Dynamic group models mark `synthetic: true`. In `GroupBlock.tsx`, group options menu is hidden, title inline editing is disabled, and `AddItemRow` is omitted/disabled (`disabled` guard in `AddItemRow.tsx`), preventing orphan item creation.
   - **Checkbox Unchecked Filtering:** handled boolean state directly before generic empty check; unchecked cells evaluate to `false` and match "Checkbox is Unchecked" properly.
   - **Multi-Sort Tie-Breaking:** updated `sortItems` so that when both primary sort values are empty/null, the comparator continues to secondary sort conditions instead of returning `0` early.
   - **Single Unified Sort System:** synchronized header sort indicators and column menu sort actions directly with `filterState.sortConditions`.
   - **Display Names:** mapped member UIDs to display names in `PersonFilterPopover.tsx` and in dynamic people group titles via `userLookup`.
   - **monday Fidelity & Vibe Tokens:** replaced native `<select>` and `<input>` with Vibe `Dropdown` and `TextField` in all filter/sort popovers; removed `.popoverPanel` duplicate border/shadow frame; removed dead CSS and unused `searchQuery` state.

4. **Verification:**
   - `pnpm lint`: clean (eslint, stylelint, prettier).
   - `pnpm typecheck`: 0 TypeScript errors across all projects.
   - `pnpm test`: all unit tests passing (270 shared, 20 functions, 181 web, 51 script tests).
   - `pnpm test:rules`: all 126 Firestore security rules tests passing.
   - `pnpm build`: production builds succeed.
