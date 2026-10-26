# Handoff: Undo, archive & trash

Date: 2026-10-24  
Agent: Antigravity  
Roadmap Item: P1 "Undo, archive & trash" (ID 3306251637)  
Branch: `ag/undo-archive-trash`

## What was done

1. **Workspace Archive & Trash UI (`/workspaces/:workspaceId/trash`):**
   - Built [`TrashPage.tsx`](../../apps/web/src/pages/TrashPage.tsx) matching Vibe styling.
   - Tabs: "Deleted Boards" and "Archived Boards".
   - Shows board kind, column count, and group count.
   - Restore button with real-time optimistic state update and Undo toast notification.
   - Added entry link in Workspace options menu (`Archive & Trash`).
   - Routed at `/workspaces/:workspaceId/trash`.
   - Comprehensive component tests in [`TrashPage.test.tsx`](../../apps/web/src/pages/TrashPage.test.tsx).

2. **Data & Mutation Hooks (`apps/web/src/data/`):**
   - Added `archivedBoards` and `deletedBoards` filter helpers in `boards.ts`.
   - Added `useAllWorkspaceBoards`, `useDeletedItems`, and `useArchivedItems` in `hooks.ts`.
   - Added `setItemState` and `deleteItemPermanently` in `firestore.ts`.

3. **Scheduled 30-Day Automated Purge (`purgeTrash`):**
   - Built pure logic and interfaces in [`functions/src/lib/purge.ts`](../../functions/src/lib/purge.ts) with full unit test coverage in [`functions/src/lib/purge.test.ts`](../../functions/src/lib/purge.test.ts).
   - Created Cloud Function `purgeTrash` running daily at 02:00 UTC via `onSchedule` in [`functions/src/scheduled/purgeTrash.ts`](../../functions/src/scheduled/purgeTrash.ts).

4. **Checks Verified:**
   - `pnpm lint` ✓
   - `pnpm typecheck` ✓
   - `pnpm test` (all 74 web tests + 11 functions tests) ✓
   - `pnpm test:rules` (all 65 emulator rules tests) ✓
   - `pnpm build` ✓

## What's next

- Open PR for `ag/undo-archive-trash` against `main`.
- Update Monday item Status to "In review" or "Done" upon merge.
