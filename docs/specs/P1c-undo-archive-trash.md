# P1c: Undo, archive & trash

Author: Antigravity · Implementer: Antigravity · Roadmap: P1 "Undo, archive & trash" · Branch: `ag/undo-archive-trash`

## Summary

In monday.com, deleting or archiving items and boards is never destructive upfront:

1. **Immediate feedback:** Deleting or archiving immediately shows a floating **Undo toast** with a countdown (10s) that allows restoring the item or board with a single click.
2. **Workspace Trash & Archive page:** Users can review all deleted and archived boards and items in their workspace at `/workspaces/:workspaceId/trash`. From here, items and boards can be restored or permanently removed.
3. **Automated 30-day purge:** A scheduled Cloud Function automatically cleans up soft-deleted records older than 30 days to keep the database tidy without administrative overhead.

This feature is completely decoupled from the board table grid being built by Claude in `claude/p1b-board-table`, ensuring zero merge conflicts and respecting `AGENTS.md` Rule 1.

---

## 1. Data Model & State Transitions

### Document States

Every board and item document supports `state`:

- `'active'`: Normal working state (default).
- `'archived'`: Hidden from main workspace and board views, but preserved intact with all values, updates, and settings.
- `'deleted'`: Soft-deleted. Hidden from views; retained for 30 days before scheduled purge.
  - Carries `deletedAt: timestamp` and `deletedBy: uid`.

### Transitions

- **Archive:** `state: 'archived'` (clears `deletedAt`).
- **Soft Delete:** `state: 'deleted'`, `deletedAt: serverTimestamp()`, `deletedBy: uid`.
- **Restore:** `state: 'active'`, `deletedAt: null`, `deletedBy: null`.
- **Permanent Delete:** Hard deletion of the document (and its subcollections) from Firestore.

---

## 2. Components & Architecture

### 2.1 Undo Toast System (`apps/web/src/components/Toast/`)

- A reusable toast manager in `apps/web/src/components/Toast/` or `toast-store.ts`.
- When an item or board is archived or deleted:
  - An Undo toast appears: `"<Item/Board name> was moved to trash"` or `"archived"`.
  - A prominent "Undo" button restores the item/board immediately.
  - Automatically dismisses after 10 seconds.

### 2.2 Workspace Trash & Archive View (`/workspaces/:workspaceId/trash`)

- **Route:** `/workspaces/:workspaceId/trash`
- **Navigation:** Accessible from the Workspace options menu (`⋯` next to workspace name or switcher).
- **Vibe UI:**
  - Standard Atrium content panel layout.
  - Tabs: **Boards** and **Items**.
  - Search filter within trash.
  - **Table / List anatomy:**
    - Title / Name
    - Origin (Board name for items, Workspace for boards)
    - Deleted by (Avatar + User name)
    - Deleted at (Formatted date, relative time like "3 days ago")
    - Actions: **Restore** (outline button), **Delete permanently** (danger icon button with confirmation dialog).
  - **Header action:** "Empty Trash" button with a confirmation modal ("This will permanently delete all items in trash. This action cannot be undone.").

### 2.3 Cloud Functions: Scheduled 30-Day Purge (`purgeTrash`)

- **Path:** `functions/src/scheduled/purgeTrash.ts`
- **Trigger:** Cloud Scheduler via `onSchedule` running daily at 02:00 UTC (`0 2 * * *`).
- **Logic:**
  1. Calculate cutoff timestamp: `Date.now() - 30 * 24 * 60 * 60 * 1000`.
  2. Query `boards` where `state == 'deleted'` and `deletedAt <= cutoff`.
  3. Query `items` across collection group where `state == 'deleted'` and `deletedAt <= cutoff`.
  4. Perform batch deletions (chunked to 400 operations per Firestore batch).

---

## 3. Security Rules & Permissions

- **Read Trash:** Any workspace member with read access to the workspace can view deleted/archived boards and items in that workspace.
- **Restore:** Requires `editor` or `owner` role on the board or workspace.
- **Permanent Delete (Client):** Only allowed by workspace/board `owner` or `admin`.
- **Scheduled Purge:** Runs with Firebase Admin SDK privileges via Cloud Functions.

---

## 4. Verification & Testing

1. **Rules Tests (`tests/rules/`):**
   - Members can query trash in their workspace.
   - Non-members are denied.
   - Editors can restore items.
   - Viewers cannot restore or permanently delete.
2. **Unit Tests:**
   - Undo toast store timeouts and action triggers.
   - Date formatting and 30-day cutoff logic.
3. **Automated Checks:**
   - `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build` must pass.
