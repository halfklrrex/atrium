# P4a: Workspace membership, invites and member profiles

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: P4 "Workspace membership & invites" (3306248745) · Branch `claude/p4a-membership` · Builds after `claude/p1-subitems` and `claude/vf5-item-card` merge

## Goal

The owner can invite family and friends (each with a Google account) into a workspace, choose their role, change it later and remove them. Everyone in a workspace sees the others' **names and photos** everywhere a person appears: People cells, avatars, filters and group-by. Today all of that is a "coming soon" placeholder, and other users show as "Board member".

Board-level sharing (adding people to private or shareable boards, the board "Invite / N" button) is **P4b**, a separate spec.

## Current state (facts at `689fb4a`, rechecked at `23679f5` on 2026-10-26)

- **Workspace doc:** `ownerId`, `memberIds`, `roles{uid: owner|admin|member|viewer}`, `kind` (`packages/shared/src/schemas/workspace.ts:15-27`).
  - Invariant: `memberIds == keys(roles)` (`docs/architecture.md:80`).
  - Clients can't change membership; rules allow only name, description, icon and color updates (`firestore.rules:150-218`).
- **Who checks what:**
  - Rules check membership through `memberIds` (`isWsMember`) and roles through `roles`.
  - Functions check `roles[uid]` (`functions/src/lib/admin.ts` `getWorkspaceMemberRole`, and `file-storage.ts` `verifyBoardAccess`).
  - **So both fields must change together, in one transaction, every time.**
- **Board access:**
  - `boardRole` already requires workspace membership, so a removed member loses board access at once (`firestore.rules:58-63`).
  - The stale `board.access[uid]` and `accessUids` entries stay behind.
- **User docs:** `users/{uid}` is readable by its owner only (`:94-108`). The only cross-user name and photo data is the ephemeral presence doc.
- **Invites:** `invites` is reserved in the architecture with no shape. No membership callables exist.

## Design decisions (log both on the Decisions board when this spec is approved)

1. **Member profiles are denormalised into `workspaces/{wsId}/members/{uid}`:** `{displayName, photoURL, email, role, joinedAt, updatedAt}`.
   - Only Functions write it. Any workspace member can read it.
   - **Why:** rules can't cheaply prove "shares a workspace with me" for `users/{uid}`, and copying a few fields per workspace is cheap at our scale.
   - `role` here is a display copy. The authoritative role stays in `workspace.roles`.
2. **Invites are accepted by verified Google email.**
   - An invite names an email address. Only a signed-in user whose **verified** token email matches, compared lowercased, can accept it.
   - No email is sent in P4a. The inviter copies the invite link and sends it themselves; email delivery is the P4 "Email notifications" item.
   - A link never grants access by itself.

## Data model

- **`workspaces/{wsId}/invites/{inviteId}`:**
  - `{email (lowercased), role ('admin'|'member'|'viewer'), invitedBy, invitedByName, workspaceName, createdAt, expiresAt (createdAt + 14 days), status: 'pending'|'accepted'|'declined'|'revoked'}`.
  - Only Functions write it. Workspace owners and admins can read it.
  - At most 50 pending invites per workspace, and one pending invite per email per workspace (re-inviting refreshes `expiresAt` and the role).
- **`workspaces/{wsId}/members/{uid}`:** as above.
- **Backfill:** a one-off script `scripts/backfill-members.mjs` creates member docs for existing workspaces. Use the same gcloud REST pattern as the showcase seed: dry run by default, `--yes` to write.

## Callables (`functions/src/callable/`)

Shared zod request and result schemas go in `packages/shared/src/schemas/membership.ts`. Every callable must:

- verify auth and validate input;
- run in a transaction;
- keep `memberIds == keys(roles)`;
- write the member docs in the same transaction.

| Callable                                    | Who                                        | Effect                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createInvite {workspaceId, email, role}`   | owner or admin                             | Creates or refreshes the invite. Admins can't invite admins; only the owner can. Refuses an email that's already a member. Returns `{inviteId, inviteUrl}`.                                                                                                                                              |
| `revokeInvite {workspaceId, inviteId}`      | owner or admin                             | Sets status `revoked`.                                                                                                                                                                                                                                                                                   |
| `listMyInvites {}`                          | any signed-in user                         | Pending, unexpired invites where `email ==` the caller's verified token email. Uses a collection-group query on `invites`, so add the index to `firestore.indexes.json`. Returns workspace name, role and inviter.                                                                                       |
| `acceptInvite {workspaceId, inviteId}`      | the invitee                                | Checks the email match, pending and not expired, then adds the caller to `roles` and `memberIds`, writes the member doc and sets status `accepted`. Idempotent if they're already a member.                                                                                                              |
| `declineInvite {workspaceId, inviteId}`     | the invitee                                | Sets status `declined`.                                                                                                                                                                                                                                                                                  |
| `changeMemberRole {workspaceId, uid, role}` | owner, or admin for member and viewer only | Updates `roles` and the member doc. **Ownership transfer:** only the owner can set someone to `owner`; the previous owner becomes `admin` and `ownerId` changes. The owner can't demote themselves except by transfer.                                                                                   |
| `removeMember {workspaceId, uid}`           | owner, or admin for non-admins             | Removes the uid from `roles` and `memberIds` and deletes the member doc. In the same operation, removes the uid from `access` and `accessUids` on every board in the workspace where `accessUids array-contains uid`, chunked into further batched writes if there are many. Refuses removing the owner. |
| `leaveWorkspace {workspaceId}`              | any member except the owner                | Same as removing yourself.                                                                                                                                                                                                                                                                               |

- **`bootstrapUser`:**
  - When a new workspace is created, also writes the owner's member doc.
  - On each call, refreshes `displayName` and `photoURL` on the caller's member docs in up to 20 workspaces where they're a member, only if they changed. This keeps names current without a trigger.
- **Board cleanup:** if more than one transaction is needed for `removeMember`, do the workspace change first. Board access is already revoked by the rules through `isWsMember`, so the board cleanup is housekeeping and can run as follow-up batches. Log a failure; don't throw.

## Rules

- **`members/{uid}`:**
  - read if `isWsMember(wsId)`;
  - write `false`.
- **`invites/{inviteId}`:**
  - read if `isWsAdmin(wsId)`;
  - write `false`.
  - Invitees read their invites through `listMyInvites`, not directly.
- `users/{uid}` stays self-only.
- **Rules tests** (`tests/rules/src/membership.test.ts`):
  - a member reads `members`;
  - a non-member is refused;
  - nobody writes `members` or `invites` from the client;
  - an admin reads `invites`, a member is refused;
  - a removed member (seeded state after removal) can't read the workspace, its boards or the members.

## Web

- **Data:**
  - `useWorkspaceMembers(wsId)` is one listener per open workspace, cached in a small store.
  - `useUserLookup(wsId)` returns `(uid) => {name, photoURL} | undefined` from it.
- **Use it everywhere a person appears:**
  - `BoardTable`'s lookup, which then needs no presence fallback;
  - `PersonFilterPopover` and `AdvancedFilterPopover`;
  - the `people` column cell and editor (`columns/people.tsx`): the picker lists workspace members, and `usePerson` resolves names and photos;
  - `UserAvatar`;
  - the item-card header avatar.
  - Remove the "Only the signed-in user's own profile is readable until P4" fallbacks.
- **Members dialog**, opened from WorkspacePage's "Invite / N" and the TopBar's "Invite members", replacing `showComingSoon`. It has two tabs:
  - **Members:**
    - each row shows the avatar, name, email and a role dropdown (for owners and admins, within their limits) plus Remove;
    - the owner sees "Transfer ownership" in a row menu, with a confirmation dialog;
    - a member sees "Leave workspace" on their own row.
  - **Invites:**
    - an email field, a role select and an "Invite" button;
    - a list of pending invites, each with "Copy invite link" and "Revoke".
  - Vibe components only (Modal, TextField, Dropdown, Avatar, Button), styled per monday's members dialog (Ophelia will capture a reference before the visual QA).
- **Invite links:** route `/invite/:workspaceId/:inviteId`.
  - Signed out: the login page, then return to the invite.
  - Signed in: calls `listMyInvites`, finds the invite and shows "<inviter> invited you to <workspace> as <role>" with Accept and Decline.
  - Wrong email: "This invite was sent to another email address. Sign in with that Google account."
  - Expired or revoked: an explanation.
- **Home:** a "Pending invitations" card at the top when `listMyInvites` returns any, with the same Accept and Decline buttons. Call it once per session after bootstrap.
- **After accept:** switch to the new workspace and show a success toast.

## Tests

- **Functions unit tests,** one suite per callable, against the emulator, covering:
  - the role matrix (who can do what);
  - the email match being case-insensitive and verified-only (an unverified email is refused);
  - expiry;
  - idempotent accept;
  - ownership transfer;
  - last-owner protection;
  - `removeMember` stripping board `access` and `accessUids`;
  - the `memberIds == keys(roles)` invariant after every operation.
- **Web unit tests:** the members dialog permissions per role, the invite page states, and `useUserLookup` feeding the filters and people cells.

## Showcase

Add 3 fake members (fixed fake uids) to the showcase workspace's `members` docs only, so People cells show names and photos (initials).

- Don't add them to `roles` or `memberIds`; they aren't real accounts.
- Gate this behind the seed's allow-list.
- Document it in `docs/showcase.md`.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` pass.
- **End to end in the emulator** with two email/password test users:
  1. A invites B.
  2. B opens the link, accepts, and sees the workspace.
  3. A changes B to viewer; B can't edit.
  4. A removes B; B loses access at once, and B's uid is gone from `accessUids`.
- Screenshots of the dialog and the invite page in light and dark.
