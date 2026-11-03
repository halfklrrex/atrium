# P1 Spec: Reorder favourite boards

**Roadmap item:** "Feature: users can reorder their favourite boards" (bug inbox request, 2026-11-01, item `3327933132`). **Branch:** `claude/favorites-reorder`. Web only.

## What exists already

- `users/{uid}/favorites/{boardId}` has a `position` (fractional index, `favoriteSchema` in `packages/shared/src/schemas/user.ts`). The rules already allow an update that changes `position` only (`firestore.rules`, "Reordering changes position only"); `useFavorites` returns the list sorted by it (`apps/web/src/data/hooks.ts`, `comparePositions`).
- New favourites go to the end (`positionAfterAll`, `board-actions.ts` `toggleFavorite`).
- The sidebar list is `apps/web/src/components/Sidebar/Favorites.tsx`. The project uses `@dnd-kit/core` and `@dnd-kit/sortable` (see `board-kanban/KanbanLane.tsx`, `board-table/GroupBlock.tsx`) and the position helpers in `apps/web/src/lib/positions.ts` (`positionBetween`).

So no schema, rules or Functions change is needed. If you find you need one, stop and report.

## Behaviour

1. **Drag and drop** in the sidebar Favorites list: each row can be dragged vertically to a new place. While dragging, show a drop indicator or a lifted row (transform and opacity only, respect `prefers-reduced-motion`). A plain click still navigates; a drag must not navigate (use dnd-kit's activation constraint, a small distance, so clicks work).
2. **Keyboard and menu alternative:** the row's board menu (or the row's own small menu) gets **Move up** and **Move down** (disabled at the ends); dnd-kit's keyboard sensor also works (Space to lift, arrows, Space to drop) with the usual announcements.
3. **Write:** on drop, compute the new key with `positionBetween(before.position, after.position)` from the **neighbours in the full favourites list** (not only the visible ones: favourites for boards the user can no longer see, or archived, are hidden but still occupy positions) and write only `position` with `updateDoc` through a new `writes.moveFavorite(uid, boardId, position)` in `apps/web/src/data/firestore.ts`. Optimistic: reorder the local list immediately and let the snapshot confirm; on error show the existing toast pattern ("Could not reorder favorites.") and let the snapshot restore the order.
4. **Where else favourites show:** the Home page's favourites section (`pages/HomePage.tsx`) reads the same sorted list, so it follows automatically; do not add drag there.
5. Per-user: favourites are already per user, so this never affects other people.

## Tests

- `Favorites.test.tsx` (web): renders in position order; Move up and Move down call `moveFavorite` with a key between the right neighbours; disabled at the ends; a drag changes the order and writes once; a click still navigates; hidden (archived or inaccessible) favourites are skipped in the UI but counted as neighbours.
- Unit test for the neighbour-key computation (extract a small pure helper, e.g. `favoritePositionFor(favorites, boardId, targetIndex)`).
- `tests/rules` already covers favourites (`p1a.test.ts`); add one test only if "update changes position only, refuses other keys" is missing there (that file is a hot spot: touch it only for that case, keep it tiny, and say so in your report).
- Visual: not needed (no new static screen). If dragging changes the look of a row, add no screenshot.

## Out of scope

Reordering workspace boards or folders (separate feature), reorder on Home, cross-user ordering, undo.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (and `pnpm test:rules` only if you touched `tests/rules`).
