# P4b: Board sharing (who can see and edit a board)

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: P4 "Roles, permissions & security rules" (3306251568), board-level part · Branch `claude/p4b-board-sharing`

Builds on P4a (`P4a-workspace-membership-invites.md`: workspace roles, invites, member docs). P4a left board-level sharing for this spec.

## Goal

The board header's **Invite / N** button (today a plain "Invite / N" label, `components/boards/BoardHeader.tsx`) opens a **Share** dialog where a board owner decides who can see and edit that board, as in monday:

- **Main** board: every workspace member can open it (the workspace role gives the board role: owner and admin edit everything, member edits, viewer reads). Owners can additionally grant explicit access.
- **Private** board: only the people listed on it.
- **Shareable** board: like private, with the board visible in the workspace's lists to its members only. (In Atrium there are no guests outside the workspace, so private and shareable differ only in the icon and wording, as `BOARD_KINDS` already says. Keep both; don't merge them.)

## Facts (main after P4a and #43)

- Data (`docs/architecture.md` §5.4): `kind`, `access: {uid: 'owner'|'editor'|'viewer'}`, `accessUids` (always the key set of `access`).
- `resolveBoardRole(board, uid, workspaceRole)` in `packages/shared/src/roles.ts` mirrors `boardRole` in `firestore.rules`: explicit `access` wins, otherwise `main` boards derive the role from the workspace role; **nothing counts unless the user is still a workspace member**.
- Rules (`firestore.rules` ~312-330): clients cannot change `access`, `accessUids`, `kind`, `state`, `deletedAt` or `columnLocks` on a board once created. **No code changes them today** except board creation (`access == {creator: 'owner'}`) and the P4a `removeMember` cleanup. So sharing needs server writes, like P4a's membership callables.
- Pattern to copy: `functions/src/callable/` + `functions/src/lib/membership.ts` (pure logic behind an injected store, transactions, fake-based tests) and `apps/web/src/components/membership/` (Members dialog) with `useWorkspaceMembers`/`useUserLookup`.
- The workspace Members dialog and the invite flow exist; board sharing only offers people **who are already workspace members**. Inviting someone new to the workspace stays in the Members dialog (the Share dialog links to it for owners and admins).

## Design decisions (log on the Decisions board when approved)

1. **Server-written, like membership.** Three callables write `kind`, `access` and `accessUids` together in one transaction; the rules stay as they are (clients still can't touch them). No rules change is expected; see Rules below.
2. **A board always keeps at least one owner.** Removing or demoting the last explicit board owner is refused. On a `main` board the workspace owners and admins are implicit owners, so the explicit owner list may be empty only while `kind == 'main'`.
3. **Who can share:** a board owner by the effective role (explicit owner, or workspace owner/admin on a `main` board). Workspace owners and admins do **not** gain access to a private board they aren't on (`resolveBoardRole` gives them nothing), but they can see that it exists in the workspace Archive & Trash and in a future admin list; v1 doesn't show private boards to them at all.
4. **Changing kind:**
   - `main` to `private` or `shareable`: the caller must be a board owner; every current workspace member who was relying on the implicit role **loses access** unless listed, so the dialog first asks "N members will lose access" and the caller is added as an explicit owner automatically.
   - `private`/`shareable` to `main`: allowed for board owners; the explicit entries stay (they can only raise someone above their workspace role, never lower it: explicit access wins in `resolveBoardRole`, so a viewer entry on a `main` board restricts that member. Keep that behaviour and say so in the dialog).
5. **Self-service:** any explicit board member may **leave** a private or shareable board unless they are its only owner.
6. **Roles offered:** Owner, Editor, Viewer (the existing `BOARD_ROLES`). The role is capped by the workspace role: a workspace `viewer` is never above `viewer` on any board, and a workspace `member` is never above `editor`. Enforce it in the callable and in the dialog (`min(role implied by the workspace role, requested role)`), so the assumption the rules already make holds.

## Callables (`functions/src/callable/`, logic in `functions/src/lib/board-sharing.ts`)

All three take `boardId`, require an authenticated caller and the effective **board owner** role, run in a transaction on the board doc plus a read of `workspaces/{ws}` (`roles`), and return the updated `{kind, access}`.

| Callable         | Input                        | Behaviour                                                                                               |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `setBoardAccess` | `boardId, uid, role: 'owner' | 'editor'                                                                                                | 'viewer' | null` | Adds the uid, changes their role, or removes them (`null`). The uid must be a current workspace member; the role is capped by the workspace role (decision 6). Updates `access` and `accessUids` together. Refuses removing or demoting the last explicit owner of a non-`main` board, and refuses a board that is archived or deleted. |
| `setBoardKind`   | `boardId, kind`              | Applies decision 4. Adds the caller as explicit owner when going private or shareable. Refuses a no-op. |
| `leaveBoard`     | `boardId`                    | Removes the caller's own `access` entry (decision 5).                                                   |

Put request and result zod schemas in `packages/shared/src/schemas/board-sharing.ts`, export them, and add the callables' region and database options like the other callables (`FIRESTORE_DATABASE_ID`, `europe-west1`). Every board write also sets `updatedAt` (server timestamp).

## Web

1. **Header button:** replace the label with a real button, "Invite / N" where N is the number of people with access (`access` keys for private and shareable boards, workspace `memberIds` for `main`). Visible to everyone who can read the board; for non-owners the dialog is a read-only list.
2. **Share dialog** (`components/boards/ShareBoardDialog.tsx`, via `ui-store`'s `dialog`):
   - the board's **kind** as a three-option choice (Main, Private, Shareable) with one line of explanation each, disabled for non-owners;
   - the **people** list: avatar, name, email, workspace role, and a board role select (Owner, Editor, Viewer; options above the workspace cap are disabled with a tooltip), a remove button; implicit workspace members of a `main` board are shown in a collapsed "N workspace members" row;
   - an **Add people** search over workspace members who aren't on the board yet (name or email), adding them as Editor by default;
   - for workspace owners and admins, a link "Invite someone new to the workspace" that opens the Members dialog;
   - errors from the callables show as toasts (use `describeCallableError`); the last-owner refusal has a clear message;
   - never show raw uids or ids.
3. **Sidebar and lists:** after a kind change the board's icon updates through the existing live board listener; a board the viewer can no longer read disappears from lists and, if open, the page shows the existing "couldn't find that page" state.
4. **Board menu:** "Leave board" for explicit members of private and shareable boards.
5. **Callable wrappers** in `apps/web/src/lib/callables.ts` (validated by the shared schemas, like the column actions).

## Rules

No change expected. Add **rules tests** that pin the assumptions this feature relies on: a client can't write `access`, `accessUids` or `kind` on an existing board (owner included), a private board is unreadable and unlistable to a workspace member who isn't on it, and an explicit `viewer` entry on a `main` board stays read-only for a workspace member. If a test shows a gap, fix the rules minimally and say so in the PR.

## Tests

- **Shared:** the callable schemas; a role-cap helper if you add one (`capBoardRole(workspaceRole, requested)`), exhaustively over the workspace roles.
- **Functions (fakes):** add, change and remove; the workspace-membership requirement; the role cap (workspace viewer can't be editor); last-owner refusals (remove, demote, leave); kind changes both ways with the caller added as owner; archived and deleted boards refused; non-owners refused; `accessUids` always equals the key set; a retried identical call is a no-op.
- **Web:** the dialog lists people, adds, changes a role, removes; the read-only view for non-owners; disabled role options; the "N members will lose access" confirmation; the header count for each kind; "Leave board".
- **Visual:** the Share dialog (light and dark) on the roadmap seed; check against monday's Invite dialog proportions in `docs/reference/monday-ui-reference.md` if it lists them (else use the Members dialog as the reference for spacing).
- **Showcase:** none needed.

## Out of scope

Guests outside the workspace, per-item sharing, board-level teams, share links, invite-by-email at board level, an admin list of every private board, and audit-log entries (P4 "Activity & audit log").

## Verify

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build`. Hot spots: `packages/shared` (new schema file and export), `tests/rules/**` (new tests). Open the PR only while no other PR touches them. After the merge, Ophelia does a live two-account check with the owner (add a second account to a private board, confirm they can open it, then remove them).
