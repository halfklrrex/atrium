# 2026-10-26 · Claude (Sonnet coding subagent) · P4a workspace membership and invites

Branch `claude/p4a-membership`, built from `origin/main` at `23679f5`, to the spec `docs/specs/P4a-workspace-membership-invites.md`. Nothing is pushed, deployed or run against production.

## What was done

- **Shared** (`packages/shared/src/schemas/membership.ts`): member and invite doc schemas, every callable's request and result schema and name, `INVITE_TTL_MS`, `MAX_PENDING_INVITES`, `APP_BASE_URL`, and the permission matrix (`invitableRoles`, `assignableRoles`, `canRemoveMember`) that the callables and the dialog both use.
- **Rules and index:** `members/{uid}` readable by any workspace member and `invites/{id}` by owner and admin, both `write: false`. A collection-group index on `invites (email, status)`. Rules tests in `tests/rules/src/membership.test.ts`.
- **Functions:** nine callables (`createInvite`, `revokeInvite`, `listMyInvites`, `getInviteStatus`, `acceptInvite`, `declineInvite`, `changeMemberRole`, `removeMember`, `leaveWorkspace`). The logic is in `functions/src/lib/membership.ts` behind a narrow `MembershipTx` interface (like `bootstrap.ts`), the Admin SDK adapters are in `membership-admin.ts`. `bootstrapUser` now writes the owner's member doc for a new workspace and refreshes the caller's name, photo and email on up to 20 member docs (creating a missing one).
- **Web:** `useWorkspaceMembers` and `useUserLookup` (`data/members-store.ts`, one ref-counted listener per workspace), used by `UserAvatar`, the people cell and its picker, the person and advanced filters, and the Table and Kanban group-by lookup. The Members dialog (`components/membership/MembersDialog.tsx`, opened from the workspace page's "Invite / N" and the top bar's "Invite members"), the `/invite/:workspaceId/:inviteId` page and Home's "Pending invitations" card.
- **Scripts and docs:** showcase gets 3 fake members (docs only, behind the allow-list); `scripts/backfill-members.mjs` (dry run unless `--yes`); `scripts/e2e-membership.mjs` (`pnpm e2e:membership`); `docs/architecture.md` section 5.2a; `docs/showcase.md`.

## Verification

Unit, rules and the emulator e2e flow all pass on Windows (see the PR for the exact results). The e2e flow (`pnpm e2e:membership`, run `pnpm --filter @atrium/functions build` first) uses real email/password users, the real callables on the Functions emulator and the real rules: A invites B, wrong-email and unverified accounts are refused, B accepts and edits, A makes B a viewer (edit refused), A removes B (access cut, uid gone from `roles`, `memberIds`, the member docs and `accessUids`), then an ownership transfer and a leave.

## What is next

1. **Deploy order matters:** the `invites` collection-group index and the new rules go out with the Functions. `listMyInvites` fails until the index is built (a few minutes).
2. **After the merge:** run `scripts/backfill-members.mjs` against production (dry run first), then re-run the showcase seed (`docs/showcase.md`).
3. **Visual QA** of the Members dialog, the invite page and Home's card against monday, light and dark, with screenshots (the lead does the measured pass; the dialog is built from Vibe parts and tokens only, no pixel matching).
4. **P4b** (board-level sharing) is separate. The board header's "Invite" button still says "coming soon" on purpose.
5. **Email delivery** of invites is the P4 "Email notifications" item; until then the inviter copies the link.

## Deviations from the spec

- **Extra callable `getInviteStatus`.** The invite page needs to tell "sent to another email" from "expired" and "revoked", and `listMyInvites` by design only returns usable invites. It returns a state and, for the invitee only, the workspace and inviter names; for another account it returns `wrong_email` and nothing else. The page still calls `listMyInvites` first, as specced.
- **No trigger for browser-created workspaces.** The web app creates workspaces directly under the rules, so no Function writes the creator's member doc. It is healed in three places instead: `bootstrapUser` (every sign-in), `createInvite` (the inviter's own doc) and the people lookup, which falls back to the signed-in user's auth profile.
- **The Invites tab is only shown to owners and admins** (rules only let them read `invites`); other members see just the member list.
- **Tab opened by the top bar's "Invite members"** is the Invites tab; the workspace page's button opens Members.
- Unknown people (someone who left, or a profile not written yet) still show as "Board member" with a neutral avatar; only the placeholder for people who ARE members was removed.

## Gotchas

- Both `roles` and `memberIds` must change together; every callable goes through `MembershipTx`, never write them separately.
- Callables need a **verified** token email: the Auth emulator only sets `email_verified` when the e2e script marks it through the admin API (`Bearer owner`).
- `removeMember` strips board `access` / `accessUids` after the workspace transaction, in batches, logging and not throwing on failure. A private board whose only owner is removed is left without a board owner (workspace admins keep the usual workspace-level powers; a "reassign board owner" flow is P4b territory).
- An admin-created invite for the `admin` role can only be revoked by the owner (admins cannot invite admins).
- `KanbanBoard.tsx` was touched only to swap its lookup to `useUserLookup` (and the import), for the parallel Kanban fidelity pass to rebase over.
- The e2e script and the showcase seed both import TypeScript from `@atrium/shared`, so they run through `tsx` (`pnpm e2e:membership`, `pnpm showcase`).
