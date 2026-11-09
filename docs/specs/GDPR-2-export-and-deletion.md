# GDPR-2: download my data (G1) and delete my account (G2)

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: "GDPR G1: data export" and "GDPR G2: account deletion" (plan items 11 and 12) · Plan: `docs/plans/2026-11-09-next-steps.md` · Owner decisions: 2026-11-09 (below) · Related: `docs/specs/SETTINGS-1-page.md` (Settings → Privacy and data), `docs/specs/PRIVACY-1-notice-and-complaints.md` (the notice's "Your choices"), `docs/specs/ADMIN-4-appeals-inbox.md` (`deleteThread`) · Status: spec, nothing built

Not legal advice: this is what the app does, designed to match the usual expectations of the right of access and the right to erasure for a private app. If Atrium ever opens to the public, have a lawyer check it.

## Goal

- **G1, Download my data:** Settings → Privacy and data → **Download my data** gives the person a JSON file with everything Atrium keeps about them as a person (not board content, which has its own CSV and Excel export).
- **G2, Delete my account:** Settings → Privacy and data → **Delete my account**, a step-by-step dialog that ends with a typed confirmation. It removes the person and their personal data, settles every workspace they own (a new owner, or deleted), and cannot be blocked. Also **Delete workspace** for owners, from Workspace settings, using the same engine.

## Owner decisions (2026-11-09, final)

1. **Updates and replies in shared boards are kept** and shown as **"Deleted user"**.
2. **Nobody is blocked.** A person can always delete a workspace they own and their own account. When deleting the account, for **every workspace they own that has other members they choose a new owner or choose to delete the workspace**. A workspace with no other members is deleted with the account.
3. **The person's Inbox threads are deleted at once.**
4. Deleted with the account: push tokens, favourites, recents, notifications, `inboxLimits`, presence, the Auth user and `users/{uid}`. Their member docs go, their uid leaves `memberIds` and `roles`, invites they sent are revoked, and an **audit row with no personal data** is written.
5. G1: a callable returning a JSON file (user doc, favourites, recents, notifications, memberships, push token metadata **without token values**, their Inbox threads and messages); board content stays on CSV and Excel; rate limit; approved accounts only.

## Technical decisions (mine; the owner can change them)

- **D1. Read-time "Deleted user" is not enough; the deletion scrubs the copies.** Updates, replies, activity entries and other people's notifications hold a copy of the author's name and photo (`authorName`, `authorPhotoUrl`, `actorName`, `actorPhotoUrl`/`actorPhotoURL`, `data.targetName`, `invitedByName`). Once the member doc is gone the web falls back to that copy (SETTINGS-1 S2 resolver), which would show the real name. So the job **overwrites those copies** with `Deleted user` and `null`. This is a bounded, query-able set (by `authorId`, `actorId`, `data.targetUid`, `invitedBy`), unlike the rename case, where mention labels inside other people's documents made rewriting a bad idea.
- **D2. A state machine document, not a task queue.** `deletionJobs/{jobId}` holds the phase, a cursor and counters. A Firestore trigger on that document (`onDeletionJobWritten`) runs one bounded **slice** of work and writes the progress back, which triggers the next slice. Every step is idempotent and re-runnable, so a timeout, a crash or a duplicate event only repeats work. Why not Cloud Tasks (`onTaskDispatched`): it needs the Cloud Tasks API and IAM set up by the owner, a queue and a second mechanism to learn; the trigger pattern uses what is already deployed (Eventarc for `atrium-1` triggers) and the existing daily schedule as the safety net.
- **D3. Lock first, delete later.** The first thing an account deletion does (synchronously, inside the `start` call) is make sign-in impossible: claims cleared, Auth user **disabled**, refresh tokens revoked. Every destructive step comes after. The Auth user is deleted **last**, after a final sweep. So a crash at any point leaves an account that cannot be used and a job that will finish, never a half-deleted account someone can sign back into.
- **D4. A workspace is sealed before it is emptied.** Deleting a workspace first sets `memberIds: []` and `roles: {}` in one transaction. Every rule that grants anything inside a workspace goes through `isWsMember` (`boardRole()` returns null for non-members, dashboards and folders and members and invites too), so after the seal no client can read or write anything in it. Deletion then proceeds at leisure, and a crash leaves an invisible workspace that the job finishes.
- **D5. The final sweep waits for the token window.** A Firebase ID token stays valid for up to an hour after revocation, and the rules cannot check revocation (the honest limit already in the ADMIN specs). A modified client could keep writing for that hour. The job therefore runs a **final sweep at least 65 minutes after the lock**, from the existing daily purge schedule, which repeats the membership, ownership and scrub steps before deleting the Auth user. The person's own normal client signs out at once.
- **D6. Four new functions, no more.** `exportMyData`, `deleteAccount` (actions `plan` and `start`), `deleteWorkspace`, and the trigger `onDeletionJobWritten`. The sweep extends `purgeOldNotifications` (as ADMIN-4 did). Each function adds about 0.5 vCPU to the deploy peak (`docs/specs/BUG-deploy-cpu-quota.md`; 50 exported today).
- **D7. Account deletion needs a recent sign-in.** `start` refuses unless the token's `auth_time` is within the last 10 minutes; the dialog then asks the person to confirm with Google (`reauthenticateWithPopup`) and retries. Together with the typed confirmation this protects against an unattended, signed-in device.
- **D8. Uids that stay behind.** Board content keeps bare uids: `createdBy`/`updatedBy` on items, boards and dashboards, People column values and `assigneeUids`, file `uploadedBy`, time-tracking sessions, automation `createdBy`, `inboxAudit` `adminUid`, `system/accountAudit` entries. Once the Auth user, `users/{uid}`, every member doc and every name copy are gone, nothing in Atrium links that uid to a person; the web shows such people with the existing unknown-person label. Rewriting them would change other people's content (assignments, history) and is out of scope.

## Facts this design rests on (checked against `main` at `88d648f`)

- **No workspace can be deleted today**: `allow delete: if false` on `workspaces/{workspaceId}` and no callable deletes one. G2 adds the first deletion path.
- **Membership helpers** (`functions/src/lib/membership.ts`, Admin adapter `membership-admin.ts`): `MembershipTx.transferOwnership(ws, newOwner, oldOwner)` (new owner gets `owner` and `ownerId`, the old owner becomes `admin`), `removeMember`, and `removeInTransaction`, which refuses to remove an owner ("Transfer ownership first"). `cleanupBoardAccess` + `adminBoardAccessStore` strip a removed member from boards' `access` and `accessUids` (boards only, **not dashboards**).
- **Board purge** (`functions/src/scheduled/purgeTrash.ts`, `lib/purge.ts`): Storage prefix `boards/{boardId}/` first (`getStorage().bucket().deleteFiles({ prefix })`, guarded to `boards/.../`), then `firestore.recursiveDelete(boards/{id})`. A board's Storage holds files, description images and update attachments.
- **Triggers on hard deletes:** `onItemWrittenActivity`, `onItemPeopleAssigned`, `onBoardWrittenActivity` and `onItemRequiredRevert` return when the document no longer exists; `onBoardColumnsWritten` returns when the board is gone. Deleting documents therefore writes nothing back. Item and update creates that raced with the seal can still fire `onItemCreated`/`onUpdateCreated` after a board was deleted; the sweep's second `recursiveDelete` removes any such stragglers.
- **Inbox:** `deleteThread` (`functions/src/lib/inbox.ts`) removes a thread's notifications, messages and audit entries, then the note and the thread; it keeps `inboxLimits`.
- **Site admins** carry the `admin` claim, granted only by `scripts/admin-grant.mjs`; `listAdminUids()` (`admin-account.ts`) pages through every Auth user.
- **Account status** comes from the `acct` claim (`accountStatusFromClaims`: `approved`, `blocked`, else `pending`). `actorFromRequest` refuses non-approved callers by default; `bootstrapUser` accepts every state and, for an existing approved user doc, can create a personal workspace when the person has none.
- **Push tokens** (`users/{uid}/pushTokens/{sha256-of-token}`): `token`, `userAgent`, `platform`, `createdAt`, `lastSeenAt`.
- **Collection-group queries** need a `COLLECTION_GROUP` index; single-field indexes are automatic only at collection scope. In `firestore.indexes.json` a `fieldOverrides` entry **replaces** every default index of that field, so each override below must list the collection-scope indexes too.
- **Backups and logs:** Firestore daily backups of `atrium-1` are kept 98 days (`retention: 8467200s`); Cloud Logging keeps logs 30 days.

## Data (named database `atrium-1`; schemas in `packages/shared/src/schemas/deletion.ts` and `packages/shared/src/privacy.ts`)

### `deletionJobs/{jobId}` (Functions only)

`jobId` is `account-{uid}` or `workspace-{workspaceId}`, so a second request finds the first job (idempotent start).

| Field                    | Type                                                                               | Notes                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `kind`                   | `'account' \| 'workspace'`                                                         |                                                                                                        |
| `uid`                    | uid                                                                                | Account: the person. Workspace: the owner who asked.                                                   |
| `email`                  | string, nullable                                                                   | Account only: the normalised email, needed to delete invites addressed to it. Gone with the job.       |
| `workspaceId`            | string, nullable                                                                   | Workspace jobs.                                                                                        |
| `transfers`              | `{ workspaceId, newOwnerUid }[]`                                                   | Account: the person's choices.                                                                         |
| `deleteWorkspaces`       | string[]                                                                           | Account: chosen for deletion plus every solo workspace (and any found later, see phase `memberships`). |
| `status`                 | `'running' \| 'sweep-pending' \| 'failed'`                                         |                                                                                                        |
| `phase`                  | see the phase lists below                                                          |                                                                                                        |
| `sub`                    | `{ workspaceId?: string; phase?: string; scrub?: string; after?: string \| null }` | The cursor: which workspace and sub-phase, which scrub query, the last document path processed.        |
| `runs`, `errors`         | int                                                                                | Slices run; consecutive failed slices.                                                                 |
| `lastError`              | string ≤ 300, nullable                                                             | Error code and message, never document contents.                                                       |
| `counts`                 | map of ints                                                                        | Boards, dashboards, threads deleted; workspaces transferred; documents scrubbed.                       |
| `lockedAt`               | timestamp, nullable                                                                | Account: when sign-in was made impossible.                                                             |
| `notBefore`              | timestamp, nullable                                                                | Earliest final sweep (`lockedAt + 65 min`; workspace jobs `now + 10 min`).                             |
| `createdAt`, `updatedAt` | timestamp                                                                          |                                                                                                        |

`deletionJobs/{jobId}/boards/{boardId}`: `{ done: bool }`, the board ids the job found, so the sweep can run `recursiveDelete` on them a second time. Deleted with the job.

### `workspaces/{ws}`: two server-only fields

`deletingAt` (timestamp) and `deletionJobId` (string), set by the seal. Optional in `workspaceSchema`; clients never see them (a sealed workspace has no members).

### `system/deletionAudit/entries/{autoId}` (Functions only)

`{ kind: 'account' | 'workspace', startedAt, finishedAt, counts }`. **No uid, no workspace id, no name, no email.** It records that a deletion happened and how big it was. Kept indefinitely.

### `users/{uid}.lastExportAt` (server only)

Timestamp of the last G1 export, for the rate limit. Not in the client-editable list of the rules, so only Functions write it.

## Rules (`firestore.rules`)

```
// Deletion jobs (GDPR-2): Functions only. Nobody reads them, not even the person or the site admins.
match /deletionJobs/{jobId} {
  allow read, write: if false;
  match /boards/{boardId} {
    allow read, write: if false;
  }
}
```

`system/**` is already denied by default; add an explicit `match /system/{document=**} { allow read, write: if false; }` only if the file does not already have one. No other rule changes: the seal works through the existing `isWsMember` checks.

## Indexes (`firestore.indexes.json`)

Field overrides. Each lists the collection-scope indexes as well (ascending, descending, and `CONTAINS` for arrays), because an override replaces the defaults:

| Collection group | Field                                 | Collection-group index | Used by                                                      |
| ---------------- | ------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| `updates`        | `authorId`                            | ASC                    | scrub names                                                  |
| `replies`        | `authorId`                            | ASC                    | scrub names                                                  |
| `updates`        | `likes`                               | CONTAINS               | remove likes                                                 |
| `replies`        | `likes`                               | CONTAINS               | remove likes                                                 |
| `activity`       | `actorId`                             | ASC                    | scrub names (keep the existing composites)                   |
| `activity`       | `data.targetUid`                      | ASC                    | scrub `targetName`                                           |
| `notifications`  | `actorId`                             | ASC                    | scrub names in other people's bells                          |
| `notifications`  | `workspaceId`                         | ASC                    | workspace deletion                                           |
| `invites`        | `invitedBy`                           | ASC                    | revoke and scrub sent invites                                |
| `invites`        | `email`                               | ASC                    | delete invites addressed to the person                       |
| `views`          | `ownerId`                             | ASC                    | delete personal views                                        |
| `automations`    | `runAs`                               | ASC                    | disable recipes run as the person                            |
| `presence`       | `uid`                                 | ASC                    | delete presence (keep the `expiresAt` TTL override separate) |
| `favorites`      | `workspaceId`                         | ASC                    | workspace deletion                                           |
| `recents`        | `workspaceId`                         | ASC                    | workspace deletion                                           |
| `deletionJobs`   | composite `status asc, notBefore asc` | (COLLECTION)           | the daily sweep                                              |

Check before merging that no existing query loses its index (`notifications.createdAt` already has an override; `activity` composites on `actorId` stay as composites). The indexes build for a while after deploy; the callables PR merges only once they are `READY`.

## G1: Download my data

### Callable `exportMyData` (`functions/src/callable/exportMyData.ts`, logic `functions/src/lib/data-export.ts`)

- `actorFromRequest(request)`: approved only (owner decision 5). Options `memory: '512MiB'`, `timeoutSeconds: 120`.
- **Rate limit:** in a transaction on `users/{uid}`, refuse when `lastExportAt` is less than 5 minutes ago (`resource-exhausted`, reason `export-too-soon`, `retryAfter`), else set it. Exports are cheap; the limit only stops a loop.
- **Builds and returns** (the callable result, no Storage object):

```jsonc
{
  "format": "atrium-personal-data",
  "version": 1,
  "exportedAt": "2026-11-09T14:00:00.000Z",
  "about": "Your account, settings and messages in Atrium. Board content (items, updates, files) is exported per board with Export to CSV or Excel.",
  "account": {
    "uid": "...",
    "googleName": "...",
    "displayNameOverride": null,
    "email": "...",
    "photoURL": "...",
    "timezone": "...",
    "locale": "...",
    "theme": "system",
    "notificationPrefs": {},
    "accountStatus": "approved",
    "createdAt": "...",
    "lastWorkspaceId": "...",
  },
  "signIn": { "providers": ["google.com"], "createdAt": "...", "lastSignInAt": "..." },
  "memberships": [
    {
      "workspaceId": "...",
      "workspaceName": "...",
      "role": "owner",
      "joinedAt": "...",
      "profileShownToMembers": { "displayName": "...", "photoURL": "...", "email": "..." },
    },
  ],
  "favorites": [{ "boardId": "...", "workspaceId": "...", "addedAt": "..." }],
  "recents": [{ "boardId": "...", "workspaceId": "...", "visitedAt": "..." }],
  "notifications": { "items": [{ "...": "every stored field" }], "truncated": false },
  "pushDevices": [
    { "platform": "ios", "userAgent": "...", "createdAt": "...", "lastSeenAt": "..." },
  ],
  "invitationsWaitingForYou": [
    { "workspaceName": "...", "role": "member", "createdAt": "...", "expiresAt": "..." },
  ],
  "inbox": [
    {
      "kind": "feedback",
      "category": "idea",
      "subject": "...",
      "status": "open",
      "createdAt": "...",
      "messages": [
        { "from": "you", "text": "...", "createdAt": "..." },
        { "from": "Site Administrator", "text": "...", "createdAt": "..." },
      ],
    },
  ],
}
```

- Timestamps as ISO strings. Notifications: newest 2000 (`truncated: true` beyond). Inbox: every thread with `senderUid == uid` (both kinds) and their messages ordered by `seq`; the sender-readable fields only (no `adminUnread`, nothing from `inboxNotes` or `inboxAudit`; admin messages already store no identity, ADMIN-4 T6).
- **Push devices: never the `token` field, and not the document id** (it is a hash of the token).
- `invitationsWaitingForYou` reuses `listMyInvites` (pending invites to the verified email; no inviter email).
- Memberships come from `workspaces where memberIds array-contains uid` (paged) plus the person's own member doc; **no other member's data**.
- A hard cap: if the serialised result exceeds 8 MB, drop the oldest notifications first and set `truncated`; refuse with `resource-exhausted` (reason `export-too-large`) only if it is still too big (not expected at family scale).
- Shared: `EXPORT_MY_DATA_CALLABLE`, `PERSONAL_DATA_EXPORT_VERSION`, a zod schema of the result (`personalDataExportSchema`), reasons `export-too-soon`, `export-too-large`.

### Web

- Settings → Privacy and data → **Download my data** (replaces the S1 placeholder): button, then "Preparing your file…", then the browser downloads `atrium-my-data-YYYY-MM-DD.json` (`Blob` + a temporary `<a download>`; on iPhone Safari this opens the share sheet, which is fine). Text: "Your account, settings, notifications and messages to the site admins. To export board content, use Export on each board." Errors with exact text (the wait time from `retryAfter`).
- PRIVACY-1's "Your choices" sentence switches to the "after G1/G2" wording when G1 and G2 are both live (or names only the one that is live).

## G2: what "delete a workspace" removes

In this order (each step idempotent; see "Phases"):

1. **Seal** (one transaction): `memberIds: []`, `roles: {}`, `deletingAt`, `deletionJobId`. From now on no client can see or change anything in it.
2. **Boards** of the workspace, every state (active, archived, in the trash): for each, Storage `boards/{boardId}/` (files, description images, update attachments), then `recursiveDelete(boards/{boardId})`: items and subitems, updates, replies, activity, automations, automation runs, views (forms included), presence, counters, column snapshots. The id is recorded under the job first.
3. **Dashboards** of the workspace (`dashboards where workspaceId == ws`): `recursiveDelete` each.
4. **References elsewhere:** every user's favourites and recents pointing into the workspace (collection group, `workspaceId ==`), and every notification about it (collection group `notifications`, `workspaceId ==`).
5. **The workspace document and its subcollections**: `recursiveDelete(workspaces/{ws})`: members, invites (all statuses), folders, templates.
6. **Sweep** (daily, after `notBefore`): `recursiveDelete` and the Storage prefix again for every recorded board (stragglers from writes that raced the seal), then the audit row, then the job is deleted.

Not touched: links from boards in **other** workspaces (Connect boards, Mirror, dependencies, dashboards) that pointed at its items. They show as empty, as for any deleted item today. The item numbers (`counters/items`) are never reused.

### Standalone: `deleteWorkspace` (owner only)

- Callable `deleteWorkspace({ workspaceId, confirmName })`, `actorFromRequest` (approved). In one transaction: the workspace exists, `ownerId == uid` and `roles[uid] == 'owner'` (else `permission-denied`); `confirmName` equals the workspace name after trimming (case-insensitive; else `invalid-argument`, reason `confirm-mismatch`); if `deletionJobs/workspace-{ws}` exists, return `{ status: 'started' }`; else seal and create the job (`status: 'running'`, `phase: 'boards'`). Returns `{ status: 'started' }`.
- Other members are not asked and not blocked (owner decision 2). They lose access at the seal.
- Web: Workspace settings dialog (`WorkspaceDialogs.tsx`, `WorkspaceSettingsDialog`), owners only: a **Delete workspace** button in a "Danger zone" section at the bottom. Confirm dialog: "Delete {name}? Its {n} boards, dashboards and files are deleted for all {m} members. This can't be undone." and "Type the workspace name to confirm". On success: toast "Workspace deleted", navigate to `/workspaces`, and if it was the last workspace the person had, call `retryBootstrap()` so `bootstrapUser` creates a new personal workspace.

## G2: delete my account

### The flow the person sees (Settings → Privacy and data → Delete my account)

A dialog (full-screen sheet on phones) with steps and a step indicator. Each step has Back and Continue.

1. **What happens.** "Your account and your personal data are deleted: your profile, settings, favourites, notifications, devices and your messages to the site admins. Updates and replies you wrote on shared boards stay, shown as 'Deleted user'. Boards in workspaces you keep or give away stay. You'll be signed out at once, and deletion finishes within a day. Copies in backups are removed when the backups expire (up to 98 days)." A link "Download my data first" (G1).
   - **Last site admin:** if `plan.isLastSiteAdmin`, this step shows "You're the only site admin. Another account must be made a site admin before you can delete yours." and no Continue (see "The last site admin").
2. **Your workspaces** (only when the plan lists any):
   - Workspaces with other members: one card each (icon, name, "{n} other members") with two choices: **Give it to** (a member picker listing the other members, admins first, each with name and email) or **Delete it for everyone** ("{boards} boards and their files are deleted for {n} members"). Continue is disabled until every card has a choice.
   - Workspaces with no other members: a list "Deleted with your account".
   - Workspaces where the person is not the owner: a line "You'll leave {n} other workspaces."
3. **Confirm.** A summary (what is given to whom, what is deleted), then "Type DELETE to confirm" (a `TextField`, 16 px on phones) and the red **Delete my account** button.
   - If the server answers `recent-sign-in` (D7): "For your safety, confirm it's you." → `reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider())` → retry once automatically.
   - If it answers `plan-changed` (someone joined, left, or ownership moved meanwhile): reload the plan, go back to step 2 with the choices kept where still valid.
4. **Done.** The app signs out with the existing `signOut()` (its push-token cleanup is best effort; the job deletes every token anyway) and the login page shows a one-shot notice (like `blocked-notice.ts`): "Your account is being deleted. This finishes within a day."

### Callable `deleteAccount` (`functions/src/callable/deleteAccount.ts`, logic `functions/src/lib/account-deletion.ts`)

`actorFromRequest(request)` (approved only in v1; see open question 4), input a discriminated union on `action`:

**`plan`** → result:

```ts
{
  ownedShared: Array<{ workspaceId, name, icon, color, boardCount,
                       otherMembers: Array<{ uid, displayName, email, role }> }>,  // from member docs
  ownedSolo: Array<{ workspaceId, name }>,
  memberOfCount: number,      // workspaces owned by someone else
  isLastSiteAdmin: boolean,
}
```

Reads: `workspaces where memberIds array-contains uid` (paged); member docs of the owned shared ones (the owner can already read them); boards count per owned shared workspace (`count()` aggregation); `listAdminUids()` only when the caller has the `admin` claim.

**`start`**, input `{ confirm: 'DELETE', decisions: Array<{ workspaceId, action: 'transfer', newOwnerUid } | { workspaceId, action: 'delete' }> }`:

1. `confirm === 'DELETE'` (else `invalid-argument`, reason `confirm-mismatch`).
2. `auth_time` (from `request.auth.token`) within 10 minutes (else `failed-precondition`, reason `recent-sign-in`).
3. Not the last site admin (else `failed-precondition`, reason `last-site-admin`).
4. If `deletionJobs/account-{uid}` exists: skip to step 7 (a retry of a call that timed out).
5. Recompute the plan. The decisions must cover **exactly** the owned shared workspaces; each `newOwnerUid` must be a current member other than the caller (else `failed-precondition`, reason `plan-changed`).
6. **Create the job** in a transaction (create-if-absent): `kind: 'account'`, `uid`, `email` (normalised, from the token), `transfers`, `deleteWorkspaces` (the `delete` decisions plus every solo workspace), `status: 'running'`, `phase: 'lock'`.
7. **Lock** (D3), each step idempotent: `setCustomUserClaims(uid, {})` (no `acct`, no `admin`), `updateUser(uid, { disabled: true })`, `revokeRefreshTokens(uid)`; then set `lockedAt` and `phase: 'inbox'` on the job (this write starts the worker). A failure here throws; the job already exists, so the worker's `lock` phase repeats it.
8. Returns `{ status: 'started' }`.

**The bootstrap guard.** `bootstrapUser` reads `deletionJobs/account-{uid}` before its transaction (one read per sign-in) and refuses with `permission-denied`, reason `account-deleting`, so a token minted before the lock can never recreate a user doc or a personal workspace. `AuthProvider` maps that reason to sign-out plus the login notice. (`bootstrapUser` stays the one callable that accepts every account state.)

### Phases of an account job

Run by the worker in this order. Each phase finishes before the next starts; within a phase the cursor (`sub`) makes it resumable. "Scrub" means set the name field to `Deleted user` (`DELETED_USER_NAME`, shared constant) and the photo field to `null`; it never touches `updatedAt` or content.

| Phase         | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lock`        | Repeat the lock (claims, disabled, revoke) if `lockedAt` is missing. An Auth user that no longer exists is fine.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `inbox`       | `inbox where senderUid == uid` → `deleteThread` for each (owner decision 3); delete `inboxLimits/{uid}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `transfers`   | For each transfer, one transaction: the workspace exists and the person is still its owner (else skip: already done); the target is still a member and not the person, **otherwise the fallback**: the remaining member with the highest role (admin, member, viewer), then the earliest `joinedAt`, then the smallest uid; if nobody else is left, move the workspace to `deleteWorkspaces`. `transferOwnership(ws, target, uid)` then `removeMember(ws, uid)` in the same transaction (so the workspace never has two owners or none). Then the access cleanup below for that workspace.                                                                                                                                                                                                                                                                                                                                                                                  |
| `workspaces`  | For each id in `deleteWorkspaces`, the workspace sub-phases `seal`, `boards`, `dashboards`, `references`, `workspace` (above), with `sub.workspaceId` and `sub.phase` as the cursor. A workspace that no longer exists is skipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `memberships` | `workspaces where memberIds array-contains uid`. A workspace the person **owns** here was not in the plan (created after `start`, inside the token window): append it to `deleteWorkspaces` and go back to `workspaces`. Otherwise one transaction removes the person (`removeMember`: `roles`, `memberIds`, the member doc), then the access cleanup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `scrub`       | Collection-group queries, each with its own cursor (`sub.scrub`, `sub.after` = last document path), batches of up to 400: (1) `updates` and (2) `replies` `authorId == uid` → scrub `authorName`/`authorPhotoUrl`; (3) `updates` and (4) `replies` `likes array-contains uid` → `arrayRemove(uid)`; (5) `activity` `actorId == uid` → scrub `actorName`/`actorPhotoUrl`; (6) `activity` `data.targetUid == uid` → `data.targetName`; (7) `notifications` `actorId == uid` in other people's bells → scrub `actorName`/`actorPhotoURL`; (8) `invites` `invitedBy == uid` → `invitedByName` scrubbed and `status: 'revoked'` when pending; (9) `invites` `email == job.email` → delete (any status; they hold the email); (10) `views` `ownerId == uid` → delete (personal views); (11) `automations` `runAs == uid` → `enabled: false`, `disabledReason: 'Its creator deleted their account. Open it and save it to run it as you.'`; (12) `presence` `uid == uid` → delete. |
| `user`        | `recursiveDelete(users/{uid})`: favourites, recents, push tokens, notifications and the document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| then          | `status: 'sweep-pending'`, `notBefore = lockedAt + 65 minutes`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `sweep`       | Started by the daily purge: run `memberships`, `scrub`, `user` again from empty cursors (normally they find nothing), `recursiveDelete` and the Storage prefix again for every recorded board, then `auth.deleteUser(uid)` (not-found is fine).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `finish`      | Write the audit row, then `recursiveDelete(deletionJobs/{jobId})`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**The access cleanup** (after a transfer or a removal), for the boards **and dashboards** of that workspace whose `accessUids` contain the person (extend `cleanupBoardAccess`/`adminBoardAccessStore` with a dashboards variant; deletion runs it as a required step, not best effort):

- remove the uid from `access` and `accessUids`;
- a private or shareable board (or dashboard) left **without any explicit member** is deleted (Storage prefix plus `recursiveDelete`): only the person could see it, so it is their content;
- one left with members but **without an owner** gets one: the remaining explicit member with the highest role (editor, then viewer), then the smallest uid, becomes `owner` (otherwise nobody could manage it).

`main` boards need nothing more (roles come from the workspace).

### The worker: `onDeletionJobWritten`

`onDocumentWritten('deletionJobs/{jobId}', { database: FIRESTORE_DATABASE_ID, retry: true, timeoutSeconds: 540, memory: '1GiB' })`, logic in `functions/src/lib/deletion-jobs.ts` behind an injected `DeletionStore` (Admin adapter `admin-deletion.ts`), unit-tested with an in-memory fake like `account-admin.ts`.

1. Read the job **from the database** (never trust the event payload). Return when it is missing or `status != 'running'`.
2. Run the current phase until it finishes, or until **240 seconds** or **2000 document operations** have passed, whichever comes first.
3. Write the progress in a transaction that **requires `runs` to still equal the value read** (`runs + 1`, `phase`, `sub`, `counts`, `errors: 0`, `updatedAt`). If another invocation already moved it on (a duplicate event), this one stops without writing. The write triggers the next slice.
4. A caught error writes `errors + 1` and `lastError` (code and message, no document data) with the same `runs` check, and does **not** rethrow (the write re-triggers). After 20 consecutive errors: `status: 'failed'` and a `logger.error` with the job id. A crash or a timeout is retried by the platform (`retry: true`); the `runs` check makes the retry harmless.
5. Every step is idempotent: deletes of missing documents succeed, scrubs set fixed values, transfers check the current owner first, the seal checks `deletionJobId`, `recursiveDelete` and `deleteFiles` can run twice.

**The daily safety net** (`purgeOldNotifications`, a third isolated step next to the notification and Inbox purges): (a) jobs `status == 'sweep-pending'` and `notBefore <= now` → `status: 'running'`, `phase: 'sweep'`; (b) jobs `status == 'failed'`, or `running` with `updatedAt` older than an hour → `status: 'running'`, `errors: 0`, `nudgedAt: now` (the write restarts the worker); at most 50 jobs per run, logged by job id.

### Why every crash point is safe (ordering)

| Crash after…                                | State                                                                               | What finishes it                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| job created, before the lock                | Job exists; the bootstrap guard refuses any sign-in; the token is still valid ≤ 1 h | the worker's `lock` phase                     |
| the lock                                    | Sign-in impossible (disabled); everything else intact                               | the worker                                    |
| a transfer transaction                      | That workspace is fully transferred (atomic); the rest untouched                    | the next slice                                |
| the seal of a workspace                     | The workspace is invisible to everyone; its data waits                              | the `boards` sub-phase                        |
| a board's Storage, before its docs          | Files gone, documents present but invisible (sealed workspace)                      | the same board is retried (not `done`)        |
| part of a scrub query                       | Some copies say "Deleted user", the rest still the name                             | the cursor resumes (re-scrubbing is harmless) |
| `users/{uid}` deleted                       | The person's data is gone; Auth user disabled                                       | the sweep                                     |
| the Auth user deleted, before the audit row | Everything gone; the job remains                                                    | `finish`                                      |

To make the audit row write-once without storing the uid, its id is a random UUID saved on the job (`auditId`) when the job enters `finish`, and the row is written with `create` (an `ALREADY_EXISTS` on a retry is ignored).

### The last site admin (owner protection)

- If the caller carries `admin` and no other Auth user does, `plan` reports `isLastSiteAdmin: true` and `start` refuses (`last-site-admin`). Without this, the site would be left with nobody able to approve accounts or answer the Inbox, and only a script could repair it.
- What to do: grant `admin` to a second account first with `scripts/admin-grant.mjs` (the owner runs it; it is the only way to grant the claim today), then delete. The dialog says so in plain words.
- A site admin who is **not** the last one can delete their account. The claim is removed at the lock; `inboxAudit` rows keep their bare `adminUid` (D8).
- Deleting workspaces is never limited by this rule.

### Web

- Settings → Privacy and data → **Delete my account** (replaces the S1 placeholder), the dialog above: `apps/web/src/pages/settings/DeleteAccountDialog.tsx` (+ test), `deletion-plan.ts` (pure helpers: summary text, default selections, validation), `lib/callables.ts` (`accountCalls.exportMyData`, `.deleteAccountPlan`, `.deleteAccountStart`, `workspaceCalls.deleteWorkspace`), `describeCallableError` for the new reasons.
- `WorkspaceDialogs.tsx`: the Danger zone and its confirm dialog.
- `auth/AuthProvider.tsx`: map `account-deleting` from `bootstrapUser` to sign-out plus the notice; `pages/LoginPage.tsx`: the one-shot notice.
- People who are gone render with the existing unknown-person label in People cells (D8), and as "Deleted user" on updates, replies, activity and notifications (the scrubbed copies). SETTINGS-1's resolver already falls back to the stored copy.

## Backups and logs (say it in the dialog and the notice)

- Firestore backups (daily, kept 98 days) still contain the deleted data until each backup expires. Atrium never restores a single person from a backup; a full restore after a disaster would bring deleted accounts back, so the owner would re-run the deletion for any account deleted after that backup's date (the audit rows carry no uid, so this needs the list of deletion dates; keep that in mind before any restore).
- Cloud Logging keeps logs with uids for about 30 days. The functions log job ids (which contain the uid or the workspace id) and never names, emails or content.

## Tests that must exist

- **Rules** (`tests/rules/src/deletion.test.ts`): no client (the person, a site admin, anyone) can read or write `deletionJobs/**` or `system/deletionAudit/**`. **After a seal** (written with rules disabled in the test), a former owner, admin, member and viewer can read nothing: the workspace, members, invites, folders, templates, a main board, a private board with explicit access, a shareable board, its items, updates, replies, activity, views, presence, a dashboard; and can write nothing there. A client cannot write `lastExportAt`, `deletingAt` or `deletionJobId`.
- **Functions unit** (in-memory stores):
  - `data-export.test.ts`: every section present; no push `token` and no token document id in the output; no other member's email; no admin identity in Inbox messages; notifications truncation; the 5-minute limit; a pending or blocked caller is refused.
  - `account-deletion.test.ts`: plan (shared, solo, member-of, last admin); start validation (confirm, `auth_time` 9 and 11 minutes, last admin, `plan-changed` when a member left or joined, a target that is the caller); idempotent start; lock order (claims, disabled, revoke).
  - `deletion-jobs.test.ts`: each phase on a fixture; resume from every cursor; the `runs` check drops a duplicate slice; 20 errors mark the job failed; the transfer fallback (target left, then nobody left → deleted); a workspace found in `memberships` that the person owns is deleted; the access cleanup (orphan private board deleted, board without owner gets one, dashboards too); scrub never changes `updatedAt` or content; invites revoked and deleted; the bootstrap guard.
  - `purge` step: sweep-pending jobs start after `notBefore` only; stalled and failed jobs are nudged; one failing step does not skip the others.
  - Guard test `approved-only.test.ts`: the three new callables call `actorFromRequest(` with no `allow` option.
- **Emulator e2e** (`tests/rules/src/deletion.e2e.test.ts`): two users share a workspace with a board, an item, an update with an attachment-free reply and a like, a mention, a notification each way, a favourite and a pending invite. User A deletes their account choosing B as the new owner of the shared workspace and owning a solo workspace: afterwards B owns the workspace, A is gone from `memberIds`, `roles`, members, the update shows `Deleted user`, the like is gone, B's notification from A says `Deleted user`, A's solo workspace and its board are gone, `users/A` is gone, A's Auth user is disabled (deleted after a forced sweep in the test). A second test deletes a workspace with two members and checks that nothing of it remains and B's favourite is gone.
- **Web:** the dialog steps (last admin stops at step 1; Continue disabled until every workspace has a choice; summary text; typed DELETE; `recent-sign-in` → reauth → retry once; `plan-changed` → reload), the Danger zone (owners only, typed name), the login notice, the export download.

## Security review plan

- **G1 (PR 3): strict in-session review.** Opus reads the diff line by line against "Tests that must exist", then runs `/code-review high` locally on the PR (the plan's "strict in-session security review") and a separate Sonnet reviewer pass; every finding is checked against `main` before fixing. Focus: the output contains only the caller's data (no other member's email, no token values, no admin identity), the gate is approved-only, the limit is in a transaction.
- **G2 (PRs 4 and 5): the best candidate for the next ultrareview.** The owner launches `/code-review ultra <PR#>` on PR 5 (the callables plus the engine, once both are on the branch; build the review on `main` with PR 4 merged, not on a copy over an old base, per the HANDOFF lessons). Before that, Opus reviews: the lock happens before any destructive step and the Auth user is deleted last; no phase can delete a workspace the person does not own or that was transferred; the transfer is atomic with the removal; the seal is the first write of every workspace deletion; the access cleanup cannot delete a board that still has another explicit member; the scrubs touch only the listed fields; the `runs` check cannot be bypassed by two concurrent slices; job ids and logs carry no names or emails; nothing reads the event payload instead of the database; every Firestore access goes through `db()` and the trigger has `database: FIRESTORE_DATABASE_ID`.
- Owner checks in production (below) with a **second Google account**, never the owner's own.

## PR split and order

Own worktree and `ATRIUM_PORT_OFFSET` per branch (10, 20, 40, ...; not 30). Hot spots: `firestore.rules`, `tests/rules/**`, `packages/shared/**`, `firestore.indexes.json`, `tests/visual/__screenshots__/**`.

| #   | Branch                           | What                                                                                                                                                                                                                                      | Hot spots                                                                           | Review                  | Depends on                     |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------- | ------------------------------ |
| 1   | `claude/settings-spec`           | This spec                                                                                                                                                                                                                                 | none                                                                                | Opus                    | none                           |
| 2   | `claude/gdpr-data-rules`         | Shared schemas (`deletion.ts`, `privacy.ts`, `DELETED_USER_NAME`, callable names and schemas, reasons), `deletionJobs` rules, the indexes, rules tests (incl. the seal test)                                                              | `packages/shared/**`, `firestore.rules`, `tests/rules/**`, `firestore.indexes.json` | Opus, strict            | SETTINGS-1 S2b merged (shared) |
| 3   | `claude/gdpr-export`             | G1: `exportMyData`, the Settings button, PRIVACY-1 sentence (G1 part)                                                                                                                                                                     | baselines (Privacy tab)                                                             | **strict in-session**   | PR 2, SETTINGS-1 PR 2          |
| 4   | `claude/gdpr-deletion-engine`    | `deletion-jobs.ts`, `account-deletion.ts` (pure parts), `admin-deletion.ts`, `onDeletionJobWritten`, the purge step, the bootstrap guard, the dashboards access cleanup. No callable yet, so nothing can create a job: safe to merge dark | none                                                                                | Opus                    | PR 2 indexes `READY`           |
| 5   | `claude/gdpr-deletion-callables` | `deleteAccount`, `deleteWorkspace`, e2e tests, `approved-only.test.ts`                                                                                                                                                                    | `tests/rules/**` (e2e)                                                              | **ultrareview** (owner) | PR 4                           |
| 6   | `claude/gdpr-deletion-ui`        | The dialog, the Danger zone, AuthProvider and login notice, PRIVACY-1 sentence (G2 part)                                                                                                                                                  | baselines                                                                           | Opus                    | PR 5 deployed                  |
| 7   | `claude/gdpr-docs` (Opus)        | `docs/architecture.md` (a "Deletion" section: jobs, phases, seal, scrub; §5.2 workspaces can now be deleted), `HANDOFF.md`, owner check list                                                                                              | none                                                                                | -                       | PR 6                           |

- PR 2 merges after SETTINGS-1 PR 5 and PRIVACY-1 PR 2 (all touch `packages/shared`), each rebasing on the one before.
- PR 2's indexes must be `READY` (`gcloud firestore indexes composite list --database=atrium-1`, and the field overrides in the console) before PR 4 merges.
- The functions count goes from 50 to 54 (D6). Watch the first deploy of PRs 3 to 5 for the CPU quota and re-run once if needed.

## Owner checks (production, after PR 6; a second Google account as the test person)

1. Second account: Settings → Privacy and data → Download my data: a JSON file with its settings, memberships and a feedback thread; no push token value.
2. Second account: create a workspace "Test delete", add a board with a file, invite your main account; accept the invite with your main account.
3. Second account: Delete my account. Step 2 lists "Test delete" with you as a possible new owner; choose **Give it to** you. Type DELETE. Google asks to confirm; the app signs out with the notice. Trying to sign in again with that Google account shows the "disabled" message.
4. Main account: you own "Test delete"; the second account is gone from its members; its updates show "Deleted user"; the second account's feedback threads are gone from the Inbox.
5. Main account: Workspace settings → Delete workspace on "Test delete", type its name: it disappears.
6. After a day: the second account can sign in again only as a brand-new (pending) account (open question 3).

## Out of scope

- Deleting pending or blocked accounts from `/admin` (open question 4).
- Rewriting uids left in board content (D8) and names inside other people's text.
- Restoring from backups, and removing a person from existing backups.
- Exporting board content (CSV and Excel exist per board).
- Undo of a deletion.

## Risks

- **Deleting the wrong thing.** Mitigations: deletion only ever starts from the person's own `start` call (typed DELETE, recent sign-in) or an owner's typed workspace name; the seal is checked against `deletionJobId`; the access cleanup deletes a board only when no explicit member is left; the ultrareview; the e2e tests.
- **A stuck job.** Mitigations: the `runs` check, error counting, the daily nudge, `logger.error` on `failed`; the person cannot sign in meanwhile, so a stuck job is a delay, not a leak.
- **The one-hour token window** (D5): bounded by the sweep at `lockedAt + 65 min`.
- **Collection-group scrubs are slow on a big account.** Fine at family scale; the slices make it safe at any size.
- **Index overrides drop an index by mistake.** The PR lists every collection-scope index in each override; the rules tests and e2e run against the emulator, which does not enforce indexes, so Opus also checks the deployed index list after PR 2.

## Open questions (recommended defaults)

1. Typed confirmation: the word `DELETE`, or the person's email? **Default: `DELETE`** (short on a phone; the recent Google sign-in already proves who it is).
2. Tell the new owner of a transferred workspace (a bell notification "You now own {workspace}")? **Default: not in v1**; the new owner sees it in the Members dialog. Easy to add later as an `account`-style notification with no actor name.
3. After deletion, signing in again with the same Google account creates a brand-new account (new uid, pending approval). **Default: accept**; the approval gate decides whether it gets in.
4. Pending and blocked people cannot reach Settings, so they cannot delete their account themselves. **Default: v1 approved only**; they can ask through the appeal box (blocked) or the owner refuses them (pending). Later: a "Delete account" action for site admins in `/admin` that starts the same job.
5. People cells and assignments that point at a deleted person show the generic unknown-person label, not "Deleted user" (D8; telling them apart would need a list of deleted uids). **Default: accept.**

## Acceptance checks

- [ ] G1: the file holds every listed section, only the caller's data, no push token values or ids, no admin identity; approved only; one export per 5 minutes.
- [ ] `deletionJobs/**` and `system/deletionAudit/**` are unreadable and unwritable from every client (rules tests); after a seal no former member can read or write anything in the workspace (rules test).
- [ ] `deleteWorkspace`: owners only, typed name, removes boards (all states) with their Storage files, dashboards, favourites, recents and notifications pointing at it, members, invites, folders, templates, the workspace; other workspaces untouched.
- [ ] `deleteAccount`: plan and start as specified; last site admin refused; `recent-sign-in` and `plan-changed` handled; lock before any delete; Auth user deleted last after the sweep; inbox threads, `inboxLimits`, push tokens, favourites, recents, notifications, presence, member docs, `memberIds` and `roles` entries, personal views, invites to the email, `users/{uid}` all gone; sent invites revoked; updates, replies, activity and other people's notifications show "Deleted user"; likes removed; recipes run as the person disabled; an audit row with no uid, id, name or email.
- [ ] Resumable: a test kills the worker after every phase and the job still finishes; duplicate events do no double work.
- [ ] The privacy notice's "Your choices" names Download my data and Delete my account once live.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build` pass; baselines through the workflow; the G1 strict review and the G2 ultrareview done and their real findings fixed.
