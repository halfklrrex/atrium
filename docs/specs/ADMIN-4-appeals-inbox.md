# ADMIN-4: Appeals and feedback Inbox in Site admin

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: "Feature: appeals and feedback inbox in Site admin" (WP-D, item 3b of `docs/plans/2026-11-07-owner-feedback-round-2.md`) · Research: `docs/plans/2026-11-07-appeals-inbox-research.md` · Builds on: `docs/specs/ADMIN-site-admin-role.md` · Owner decisions: 2026-11-07 (below, final) · Status: spec, nothing built

## Goal

Site admins get an **Inbox** tab in `/admin` where they read and answer two kinds of messages:

- **Appeals** from blocked people, who now sign in to a blocked screen with an appeal box and see the replies there.
- **Feedback** from approved people, sent from the profile menu ("Send feedback") and followed in "My feedback".

Each message starts a private, two-way thread between the sender and the admins. Nobody else can see it.

## Owner decisions (2026-11-07, final)

1. **A blocked person appeals by signing in.** Blocking stops disabling the Firebase Auth user. The person keeps the `blocked` status and claim, and the rules still refuse everything except what the blocked screen needs. The blocked screen (`AccountGate`) gets an appeal box and shows the thread and the replies.
2. **Two-way conversation until an admin closes the thread.** Closing locks it. A sender reply on an answered thread reopens it.
3. **Feedback goes to the same Inbox.** One Inbox tab with an Appeals / Feedback filter. "Send feedback" and "My feedback" go in the profile menu; this also gives the "Give feedback" header icon a purpose.
4. **Defaults accepted:** feedback categories Bug, Idea, Question, Other, no priority; no attachments in v1; bell notification only (no email), one notification per thread per person (overwritten, not stacked); closed threads deleted automatically 365 days after closing; limits: 1 open appeal per account, 7 days' wait after a refused appeal, feedback at most 5 new threads a day and 3 open at once, 2000 characters per message.
5. **The admin's identity is hidden from the sender (answered 2026-11-07).** The sender sees every admin message as written by "Site Administrator" (no name, no photo, no uid). This is enforced in the data, not only in the screen: see "Hiding the admin" below.
6. **Message caps accepted (T7):** 10 messages a day for a blocked account, 30 for an approved one, 200 per thread, admins exempt.

## Technical decisions (mine; the owner can change them)

These fix or tighten the research proposal.

- **T1. Blocked appellants read their thread through a narrow rules exception, not a callable.** The research suggested a `getMyAppeal` callable to keep `authed()` limited to the user document. The owner's decision 1 says the rules allow "what the blocked screen needs", and a read-only rule on the person's **own appeal threads** gives live replies with no polling and one fewer Cloud Function. It is narrower than it sounds: a blocked token can read `inbox` documents only where `senderUid` is its own uid **and** `kind == 'appeal'`, plus their messages. Nothing else changes for blocked tokens, and pending tokens get nothing new.
- **T2. Two callables instead of five.** Every function adds about 0.5 vCPU to the deploy peak (`docs/specs/BUG-deploy-cpu-quota.md`; 48 functions are deployed today). The sender side is `sendInboxMessage` (actions `feedback`, `appeal`, `reply`) and the admin side is `manageInboxThread` (actions `reply`, `close`, `reopen`, `keepBlocked`, `delete`). Splitting by **role** (not by action) means the role of a message is fixed by the callable, never guessed: an admin who sends their own feedback replies to it as the sender through `sendInboxMessage`, and as an admin through `manageInboxThread`. The daily purge extends the existing `purgeOldNotifications` schedule instead of adding a function.
- **T3. Unread state is two booleans on the thread** (`adminUnread`, `senderUnread`), not read timestamps, so the badge is a single equality query (`adminUnread == true`) with no composite index and no cross-field comparison. Read state lives on the thread, never in notifications (Minerva lesson 6).
- **T4. Admin-only data never sits in a document the sender can read.** The internal note is `inboxNotes/{threadId}`. Everything in `inbox/{threadId}` and its messages is visible to the sender, so it holds only what the sender may see (see "What each side sees").
- **T5. The sender's email is stored on the thread** (`senderEmail`). The research left it out, but the admin needs it next to the message, and only the sender and admins can read the thread. It is a snapshot from the verified token at send time.
- **T6. The admin's identity is hidden from the sender (owner decision, final).** The sender reads the message documents, so hiding the name only in the UI would not hide it. Admin messages therefore store NO uid, name or photo (`authorUid`, `authorName`, `authorPhotoURL` are `null` on `authorRole: 'admin'` messages) and the web shows the fixed label "Site Administrator" with a generic avatar. The acting admin is recorded only in the admin-only `inboxAudit/{threadId}/entries/{messageId}` (`{ adminUid, action, createdAt }`, written by the Function). Everything else the sender can read must also be free of the admin's identity: the thread's `closedBy` moves to `inboxAudit`, and the `inbox_reply` notification uses `actorName: 'Site Administrator'`, `actorPhotoURL: null` and, because the notification schema needs an actor id, the recipient's own uid as `actorId` (the card never shows it). Admins see which admin acted in the admin UI through `inboxAudit`. The owner is today the only admin, so this is about what other people see, not about hiding from the owner.
- **T7. Daily message caps** (my addition to the owner's limits, needed because a blocked person now has a write path; the owner accepted them on 2026-11-07): at most **10 messages a day for a blocked account** and **30 a day for an approved one**, admins exempt; at most **200 messages per thread**.
- **T8. Pending people get nothing new in v1.** They keep the waiting screen. (Out of scope; the same box could serve them later.)
- **T9. Client-chosen request ids for idempotence.** Every send carries a `requestId` (UUID). The Function uses it as the message id (and as the thread id for a new thread), so a double click or a network retry never creates two messages.

## Facts this design rests on

- Firestore is the **named** database `atrium-1`. Functions reach it only through `db()` in `functions/src/lib/admin.ts`, which uses `FIRESTORE_DATABASE_ID` (`packages/shared/src/firebase-env.ts`). This feature adds **no Firestore trigger**, so there is no trigger `database` option to forget; `scripts/database-id.test.mjs` keeps guarding the rest.
- `signedIn()` in `firestore.rules` is "signed in and `acct == 'approved'`"; `authed()` (any state) is used only to read your own `users/{uid}`. There is no `isSiteAdmin()` rules helper yet.
- Storage rules are deny-all and cannot read Firestore. This feature has no attachments and **does not touch `storage.rules`**.
- Notifications (`users/{uid}/notifications/{id}`) are written only by Functions; the recipient may set `readAt` or delete. Today they are written with `create`, so a second write with the same id is ignored.
- `actorFromRequest` (`functions/src/lib/actor.ts`) checks only that the caller is signed in. 18 of the 34 callables use it; the other 16 read `request.auth` directly. Neither path checks the `acct` claim.
- The approval flag `ACCOUNT_APPROVAL_REQUIRED` is **on** in production (PR #152), so new sign-ups are pending.
- `AuthProvider` runs `bootstrapUser` once per session and force-refreshes the ID token at most **once per session** (`refreshedSessions` loop guard); `refreshAccount()` does `getIdToken(true)` and re-runs the bootstrap.

## Blocking: today and after

### `setAccountStatus` today (`functions/src/lib/account-admin.ts`)

- **Block:** `users/{uid}.accountStatus = 'blocked'` → `auth.setDisabled(uid, true)` → `revokeRefreshTokens(uid)` → claims `acct: 'blocked'`, `admin` removed. The person cannot sign in again (`auth/user-disabled`). A token they already hold works until it expires (up to an hour) because the rules do not check revocation.
- **Unblock / approve:** ensure the personal workspace → doc `approved` → `setDisabled(false)` if disabled → claim `acct: 'approved'` last.
- **No-op check:** `from === status && target.disabled === (status === 'blocked')`, where `from` comes from the claims.

### `setAccountStatus` after (PR3)

- **Block**, in this order:
  1. claims `acct: 'blocked'`, `admin` removed (as today);
  2. `revokeRefreshTokens(uid)`;
  3. `users/{uid}.accountStatus = 'blocked'` (plus `statusChangedAt`, `statusChangedBy`);
  4. audit entry.

  **The Auth user is no longer disabled.** The order matters now that the person can sign in again:
  - Claims before revoke: any token minted after the revoke carries `blocked`. (With revoke first, a sign-in in the gap would mint a fresh `approved` token valid for an hour.)
  - The document last: the document change is what an open client listens to (below). When it fires, the refresh token is already revoked, so the client's forced refresh fails instead of minting a new `approved` token.

- **Unblock / approve:** unchanged steps (workspace, doc, claim last), and `setDisabled(false)` stays for accounts that are still disabled (legacy blocks, see Migration). **New:** after the claim, close any open or answered appeal thread of that uid with `outcome: 'unblocked'` (best effort: a failure is logged and never fails the unblock; the admin can still close it by hand).
- **No-op check:** the call is a no-op only when the claim status, `users/{uid}.accountStatus` **and** the target status all agree (read the doc through `store.getAccountStatuses`). The `disabled` flag no longer counts, so a half-finished block (claims set, doc not yet) is finished by a retry.
- **Never touches `disabled` on block.** An account an operator disabled in the Firebase console stays disabled whether it is blocked or not.

### Token revocation, claim propagation and the open session

- Custom claims reach a client only in a newly minted ID token. Revoking refresh tokens stops new tokens from the old session; it does **not** invalidate an ID token already issued (up to one hour), and Firestore rules cannot check revocation. That honest limit from the ADMIN spec stays for a modified client.
- **What changes for a normal client (PR3):** while the account is approved, `AuthProvider` keeps one listener on the person's own `users/{uid}` document (already readable through `authed()`). When `accountStatus` becomes `blocked`, the app calls `getIdToken(true)`:
  - the refresh token is revoked, so it fails (`auth/user-token-expired`); the app then calls `signOut()` and the login page shows "Your account was blocked. Sign in again to see why and to send an appeal." (a one-shot flag in `sessionStorage`, cleared once shown);
  - if it unexpectedly succeeds, the new token carries `blocked`: the app re-runs the bootstrap and shows the blocked screen.

  In practice an open tab is cut off within seconds of the block, instead of up to an hour later.

- **Sign-in after a block:** Google sign-in works (the user is enabled), the new token carries `acct: 'blocked'`, `bootstrapUser` returns `{ accountStatus: 'blocked' }` and no workspace, and `RequireAuth` shows `AccountGate` blocked.
- **Unblock while the blocked screen is open:** `AccountGate` already listens to the user document for a pending person; it does the same for a blocked person. On `approved` it calls `refreshAccount()`.
- **Race fix:** the server writes the document before the claim on approve and unblock (claim last, for retries). `refreshAccount()` therefore checks the claim after `getIdToken(true)` and, while it is not `approved`, retries up to 5 times 1 second apart before re-running the bootstrap. This fixes the same small race in the existing pending flow.
- **Admin claim:** blocking still removes `admin`, so a blocked admin's next token has no admin rights. Their current token keeps admin rights for up to an hour (unchanged honest limit); the client cut-off above ends it for a normal client.

### Effect on WP-C (`auth/user-disabled` message)

WP-C maps `auth/user-disabled` to "Your account has been disabled. If you think this is an error, contact the site admin." After PR3, blocking no longer produces `auth/user-disabled`; only an account disabled in the Firebase console (or a legacy block, see Migration) does. **The message stays as the fallback**, unchanged. Blocked people now see the blocked screen instead, whose text says appeals are possible (PR6). PR3 changes the blocked screen text to "An admin has blocked this account, so you can't use Atrium with it. If you think this is a mistake, contact the site admin." until PR6 adds the box and the text "... you can send an appeal below." WP-C can land before or after PR3; neither depends on the other.

### Migration (accounts blocked before PR3)

Accounts blocked by the old code are blocked **and** disabled, so they still cannot sign in or appeal. No script is needed: today there are none except possibly the owner's second test account (the owner blocked and unblocked it on 2026-11-07, which re-enabled it).

1. Before PR3 merges, Ophelia lists accounts that have `acct: 'blocked'` or are disabled, read-only (Firebase console > Authentication, or the Identity Toolkit `accounts:batchGet` call the backfill script already uses). She reports the count and uids only, never emails, on the Roadmap item.
2. For each blocked-and-disabled account, the owner chooses after PR3 is live:
   - **can appeal:** Unblock, then Block again from `/admin`. Unblock re-enables the Auth user; the new Block leaves it enabled.
   - **cannot appeal:** leave it. It stays disabled and sees the WP-C fallback message.
3. An account disabled in the console without a `blocked` claim is never touched.

## Data (named database `atrium-1`; zod schemas in `packages/shared`)

All limits live in one shared constant, `INBOX_LIMITS`, used by the schemas, the Functions, the web counters and (as literals with a pointer comment) the rules.

```ts
export const INBOX_LIMITS = {
  subject: 120,
  text: 2000,
  snippet: 200,
  note: 2000,
  feedbackThreadsPerDay: 5,
  openFeedbackThreads: 3,
  messagesPerDayApproved: 30,
  messagesPerDayBlocked: 10,
  messagesPerThread: 200,
  appealWaitDays: 7,
  retentionDays: 365,
  pageSize: 20,
} as const;
```

### `inbox/{threadId}`: one thread

| Field                    | Type                                               | Notes                                                                                                           |
| ------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `kind`                   | `'appeal' \| 'feedback'`                           |                                                                                                                 |
| `category`               | `'bug' \| 'idea' \| 'question' \| 'other' \| null` | Feedback only; `null` for appeals.                                                                              |
| `subject`                | string 1 to 120                                    | Appeals: the fixed text `Appeal`.                                                                               |
| `senderUid`              | uid                                                |                                                                                                                 |
| `senderName`             | string ≤ 200                                       | From the verified token at send time (`name`, else email, else "Someone").                                      |
| `senderEmail`            | string ≤ 320, nullable                             | From the verified token (T5).                                                                                   |
| `senderPhotoURL`         | string ≤ 2048, nullable                            |                                                                                                                 |
| `status`                 | `'open' \| 'answered' \| 'closed'`                 | `open`: waiting for an admin. `answered`: an admin replied last. `closed`: locked.                              |
| `outcome`                | `'unblocked' \| 'upheld' \| null`                  | Appeals only, set when closed. `null` for feedback and for open appeals.                                        |
| `messageCount`           | int                                                |                                                                                                                 |
| `lastMessageAt`          | timestamp                                          |                                                                                                                 |
| `lastMessageBy`          | `'sender' \| 'admin'`                              |                                                                                                                 |
| `lastSnippet`            | string ≤ 200                                       | First characters of the newest message.                                                                         |
| `adminUnread`            | bool                                               | True after a sender message; an admin sets it false (T3).                                                       |
| `senderUnread`           | bool                                               | True after an admin message; the sender sets it false.                                                          |
| `createdAt`, `updatedAt` | timestamp                                          |                                                                                                                 |
| `closedAt`               | timestamp, nullable                                | Who closed it is NOT stored here (T6): it goes to the admin-only `inboxAudit` (`adminUid` or `system:unblock`). |

### `inbox/{threadId}/messages/{messageId}`: one document per message

Not an array in the thread (Minerva lesson 5). `messageId` is the request's `requestId` (T9).

| Field            | Type                    | Notes                                                                   |
| ---------------- | ----------------------- | ----------------------------------------------------------------------- |
| `seq`            | int                     | 1, 2, 3... in send order (assigned in the transaction); the sort key.   |
| `authorRole`     | `'sender' \| 'admin'`   | Fixed by the callable (T2).                                             |
| `authorUid`      | uid, nullable           | `null` on admin messages (T6); the sender's uid on sender messages.     |
| `authorName`     | string ≤ 200, nullable  | `null` on admin messages (T6).                                          |
| `authorPhotoURL` | string ≤ 2048, nullable | `null` on admin messages (T6).                                          |
| `text`           | string 1 to 2000        | Trimmed; control characters except newline and tab removed; plain text. |
| `createdAt`      | timestamp               |                                                                         |

No edits and no deletes of single messages in v1 (an honest record).

### `inboxNotes/{threadId}`: admin-only internal note

`{ text: string ≤ 2000, updatedAt: timestamp, updatedBy: uid }`. Written by admins from the client (rules-checked), deleted with the thread by Functions.

### `inboxLimits/{uid}`: Functions-only counters

`{ day: 'YYYY-MM-DD' (UTC), threadsToday: int, messagesToday: int, appealRefusedAt: timestamp | null, updatedAt: timestamp }`. The counters reset when `day` is not today. `appealRefusedAt` is set by `keepBlocked` and cleared when an admin reopens that appeal.

### Indexes (`firestore.indexes.json`, PR2)

| Collection | Fields                                            | Used by                                     |
| ---------- | ------------------------------------------------- | ------------------------------------------- |
| `inbox`    | `status` asc, `lastMessageAt` desc                | Admin list, status filter                   |
| `inbox`    | `kind` asc, `lastMessageAt` desc                  | Admin list, kind filter                     |
| `inbox`    | `kind` asc, `status` asc, `lastMessageAt` desc    | Admin list, both filters                    |
| `inbox`    | `senderUid` asc, `kind` asc, `lastMessageAt` desc | My feedback; blocked screen                 |
| `inbox`    | `senderUid` asc, `kind` asc, `status` asc         | Functions: open appeal, open feedback count |
| `inbox`    | `status` asc, `closedAt` asc                      | Purge                                       |

`adminUnread == true` (the badge) and `messages` ordered by `seq` use automatic single-field indexes. Every listener in the web passes an error callback that logs and shows a quiet error state (Minerva lesson 4).

### What each side sees

| Data                                   | Sender                                        | Admins                     | Other people |
| -------------------------------------- | --------------------------------------------- | -------------------------- | ------------ |
| Their own thread document and messages | yes                                           | yes                        | no           |
| `senderEmail`                          | yes (their own)                               | yes                        | no           |
| Admin author name on admin messages    | **never** (shown as "Site Administrator", T6) | yes (through `inboxAudit`) | no           |
| `adminUnread` flag                     | readable, not shown                           | yes                        | no           |
| `inboxNotes/{threadId}`                | **never**                                     | yes                        | no           |
| `inboxLimits/{uid}`                    | no (errors explain limits)                    | no                         | no           |
| Other people's threads                 | **never**                                     | yes                        | no           |

A blocked sender sees only their appeal threads (T1), not their old feedback.

## Rules (`firestore.rules`, PR2)

```
// Site admin (ADMIN-4): approved and carrying the `admin` claim (set only by Functions and scripts).
function isSiteAdmin() {
  return signedIn() && request.auth.token.get('admin', false) == true;
}

// A blocked account (ADMIN-4). ONLY for a blocked person reading their own appeal threads.
function isBlockedAccount() {
  return request.auth != null && request.auth.token.get('acct', '') == 'blocked';
}

match /inbox/{threadId} {
  function senderMayRead(t) {
    return request.auth != null && t.senderUid == request.auth.uid
      && (signedIn() || (isBlockedAccount() && t.kind == 'appeal'));
  }
  allow read: if isSiteAdmin() || senderMayRead(resource.data);
  allow create, delete: if false;  // Functions only
  allow update: if
    (isSiteAdmin()
      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['adminUnread'])
      && request.resource.data.adminUnread == false)
    || (signedIn() && resource.data.senderUid == uid()
      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['senderUnread'])
      && request.resource.data.senderUnread == false);

  match /messages/{messageId} {
    allow read: if isSiteAdmin()
      || senderMayRead(get(/databases/$(database)/documents/inbox/$(threadId)).data);
    allow write: if false;  // Functions only
  }
}

match /inboxNotes/{threadId} {
  allow read: if isSiteAdmin();
  allow create, update: if isSiteAdmin()
    && exists(/databases/$(database)/documents/inbox/$(threadId))
    && request.resource.data.keys().hasOnly(['text', 'updatedAt', 'updatedBy'])
    && request.resource.data.keys().hasAll(['text', 'updatedAt', 'updatedBy'])
    && request.resource.data.text is string && request.resource.data.text.size() <= 2000
    && request.resource.data.updatedAt == request.time
    && request.resource.data.updatedBy == uid();
  allow delete: if false;  // with the thread, by Functions
}

match /inboxLimits/{userId} {
  allow read, write: if false;
}
```

- Update the `authed()` comment: it is still only for reading your own `users/{uid}`; the blocked appeal read uses `isBlockedAccount()` inside `senderMayRead` and nowhere else.
- The ADMIN spec said "No `isSiteAdmin()` helper"; update that sentence in `ADMIN-site-admin-role.md` to point here.
- A sender (approved) marking their thread read: the second `update` branch. A blocked sender writes nothing (the blocked screen shows the whole thread, so it needs no unread state).
- Notifications rules are unchanged (Functions write them; the kinds are not checked by the rules).

## Central "approved only" check for callables (PR3)

**Gap:** no callable checks the `acct` claim, so a pending person, or a blocked person with a still-valid old token, can call `createInvite`, `acceptInvite`, `submitForm`, `clickButton` and the rest. The rules still guard direct reads and writes, and most callables check membership, but the Admin SDK bypasses the rules.

**Fix:**

- `actorFromRequest(request, options?: { allow?: ReadonlyArray<AccountStatus> })` in `functions/src/lib/actor.ts`. Default `allow` is `['approved']`. It reads `accountStatusFromClaims(request.auth.token)` and throws `permission-denied`, message "Your account can't do this.", details `{ reason: 'account-not-approved', status }`, when the status is not allowed. It returns the status on the actor (`actor.accountStatus`) for callables that branch on it.
- The 16 callables that read `request.auth` directly switch to `actorFromRequest` (they keep their own messages for everything else): `changeColumnType`, `revertColumnType`, `clickButton`, `deleteFileAttachment`, `deleteUpdateAttachment`, `finalizeDescriptionImage`, `finalizeFileUpload`, `finalizeUpdateAttachment`, `getDescriptionImageUrl`, `getFileDownloadUrl`, `getUpdateAttachmentUrl`, `requestDescriptionImageUpload`, `requestFileUpload`, `requestUpdateAttachmentUpload`, `startTimeTracking`, `stopTimeTracking`.
- The 17 that already use it get the approved check with no code change: `acceptInvite`, `changeMemberRole`, `createInvite`, `declineInvite`, `getForm`, `getInviteStatus`, `leaveBoard`, `leaveWorkspace`, `listAccounts`, `listMyInvites`, `removeMember`, `revokeInvite`, `setAccountStatus`, `setBoardAccess`, `setBoardKind`, `setDashboardAccess`, `submitForm`. (`listAccounts` and `setAccountStatus` also keep `assertAdminToken`.) The 34th, `bootstrapUser`, is the opt-out below.
- **Explicit opt-outs, the only ones allowed:**
  - `bootstrapUser`: any state (it is how the app learns the state). Its `syncMemberProfiles` step now runs **only for approved** callers, so a blocked or pending person never writes member documents.
  - `sendInboxMessage` (PR4): `allow: ['approved', 'blocked']`, then a per-action check (below).
- **Guard test** `functions/src/callable/approved-only.test.ts`, in the style of `scripts/database-id.test.mjs`: it reads every `functions/src/callable/*.ts` (not tests) and fails when a file reads `request.auth` other than `bootstrapUser.ts`, when a file does not call `actorFromRequest(` (again except `bootstrapUser.ts`), or when an `allow:` option appears outside an allowlist (`sendInboxMessage.ts`). The failure message points at this section.
- **Invite and form pages** (`/invite/...`, `/forms/...`) are inside `RequireAuth`, so a pending or blocked person never reaches them. The web maps `account-not-approved` in `describeCallableError` to "Your account isn't approved yet." just in case.
- **Emulator users:** the e2e helpers (`tests/rules/src/*.e2e.test.ts`, `scripts/e2e-membership.mjs`, visual seeds) already create users with `acct: 'approved'` (ADMIN-1b). The implementer checks every e2e caller; any that lacks the claim gets it.

## Functions (2nd gen, `europe-west1` via global options, zod input, Admin SDK through `db()`)

Pure logic in `functions/src/lib/inbox.ts` with narrow `InboxStore` and `InboxAuth` interfaces (unit-tested without an emulator, like `account-admin.ts`); the Admin SDK adapter in `functions/src/lib/admin-inbox.ts`; thin callables in `functions/src/callable/`. Names in `packages/shared/src/inbox.ts`: `SEND_INBOX_MESSAGE_CALLABLE = 'sendInboxMessage'`, `MANAGE_INBOX_THREAD_CALLABLE = 'manageInboxThread'`.

### `sendInboxMessage` (the sender side)

`actorFromRequest(request, { allow: ['approved', 'blocked'] })`, then the input is a zod discriminated union on `action`. Every action carries `requestId` (UUID) and `text` (trimmed, 1 to 2000).

| Action     | Input                                  | Who                 | What happens (one transaction)                                                                                                                                                                                                                                                                                                                                            | Result                 |
| ---------- | -------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `feedback` | `category`, `subject` (1 to 120), text | approved only       | Limits: `threadsToday < 5`, open plus answered feedback threads of this sender `< 3`, `messagesToday < 30`. Creates `inbox/{requestId}` (`status: 'open'`, `adminUnread: true`, `senderUnread: false`) and message `seq: 1`. Increments the counters.                                                                                                                     | `{ threadId }`         |
| `appeal`   | text                                   | blocked only        | No open or answered appeal of this sender (else `already-exists`, reason `appeal-open`, with that `threadId`); `appealRefusedAt` null or older than 7 days (else `resource-exhausted`, reason `appeal-wait`, `retryAfter` ISO); `messagesToday < 10`. Creates the thread (`kind: 'appeal'`, `subject: 'Appeal'`, `category: null`, `outcome: null`) and message `seq: 1`. | `{ threadId }`         |
| `reply`    | `threadId`, text                       | the thread's sender | The thread exists and `senderUid` is the caller (else `not-found`, never revealing that it exists); feedback threads need an approved caller, appeal threads a blocked one; `status != 'closed'` (else `failed-precondition`, reason `closed`); `messageCount < 200`; daily cap by status. Adds the message, `status: 'open'`, `adminUnread: true`, counters, snippet.    | `{ threadId, status }` |

- **Idempotence (T9):** if `inbox/{requestId}` (new thread) or `messages/{requestId}` (reply) already exists with the same sender, return the existing result and change nothing; with a different sender, `already-exists`.
- **Notifications** after the commit (below): every admin except the sender gets `inbox_new`.
- Error reasons are a shared enum (`INBOX_ERROR_REASONS`) so the web shows exact messages: `daily-thread-limit`, `open-thread-limit`, `daily-message-limit`, `thread-full`, `appeal-open`, `appeal-wait`, `closed`, `account-not-approved`.

### `manageInboxThread` (the admin side)

`actorFromRequest(request)` then `assertAdminToken`. Discriminated union on `action`; all take `threadId`.

| Action        | Extra input                 | Rules                                                                                    | Effect                                                                                                                                                                                   |
| ------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reply`       | `requestId`, text           | Not closed; `messageCount < 200`. No daily cap.                                          | Adds an `admin` message; `status: 'answered'`, `senderUnread: true`, `adminUnread: false`. Notifies the sender with `inbox_reply` (feedback only, and not when the admin is the sender). |
| `close`       | none                        | Feedback only (appeals close through Unblock or Keep blocked).                           | `status: 'closed'`, `closedAt`, `adminUnread: false`; the acting admin goes to `inboxAudit` (T6).                                                                                        |
| `reopen`      | none                        | Closed threads. For an appeal: the sender is still blocked and has no other open appeal. | `status` back to `open` (last message from the sender) or `answered`; clears `closedAt`, `outcome`; for an appeal clears `inboxLimits.appealRefusedAt`.                                  |
| `keepBlocked` | optional `requestId` + text | Appeal, not closed, sender still blocked.                                                | Adds the optional final admin message, then `status: 'closed'`, `outcome: 'upheld'`, and sets `inboxLimits/{senderUid}.appealRefusedAt` (starts the 7-day wait).                         |
| `delete`      | none                        | Any thread.                                                                              | Deletes the messages (batches of up to 500), the note, the thread, and the deterministic `inbox_new` / `inbox_reply` notifications of that thread (every admin uid and the sender).      |

`deleteThread` lives in `lib/inbox.ts` and is reused by the purge (PR7).

### `setAccountStatus` (existing, PR4 part)

On approve or unblock, after the claim: find this uid's appeals with status `open` or `answered` and close them (`outcome: 'unblocked'`; `inboxAudit` records `system:unblock`). `AccountStore` gets a `closeOpenAppeals(uid)` method. Unit tests in `account-admin.test.ts`. (The blocking change itself is PR3.)

### Notifications

- New kinds in `notificationKindSchema`: `inbox_new` (to every admin: a new appeal or feedback, or a sender reply) and `inbox_reply` (to a feedback sender: an admin replied). No preference switch (the prefs map and its rules are strict; same as the account kinds).
- Fields: `actorId`/`actorName`/`actorPhotoURL` = the message author; `workspaceId` and `boardId` = `ACCOUNT_NOTIFICATION_REF`; `itemId` = `threadId`; `itemName` = the subject; `snippet` = the first 200 characters of the message.
- **One per thread per recipient, overwritten:** id `notificationId(kind, threadId, uid)`, written with a new `upsertNotification` store method (`set`, with `createdAt` = now and `readAt: null`), so a long exchange keeps one card that moves to the top and turns unread again. The existing `createNotification` (create-only) stays for every other kind.
- Admin uids come from `listAdminUids()` (as for `account_request`). The author is never notified. Appeal senders get no bell notification (a blocked person cannot read the bell; they see replies live on the blocked screen).
- Web: `NotificationCard` icon (a Vibe icon such as `Email` or `Chat`), `notification-filter` labels ("wrote to the site admins", "replied to your feedback"), and routing in `NotificationsPanel`: `inbox_new` opens `/admin/inbox/{itemId}`, `inbox_reply` opens `/feedback/{itemId}`; neither opens a board.
- No email (owner decision 4).

### Daily purge (PR7)

`purgeOldNotifications` (existing schedule, every day 04:00 UTC) gains a second step, each step in its own try/catch so one failing never skips the other: delete `inbox` threads with `status == 'closed'` and `closedAt` older than 365 days (through `deleteThread`, at most 200 threads per run, logged), then `inboxLimits` documents with `updatedAt` older than 30 days and no `appealRefusedAt` in the last 7 days. Keep the exported name; update its doc comment ("Daily purge: old notifications and closed Inbox threads").

## Web UI (Vibe components, tokens only, light and dark)

All message text renders as plain text (`white-space: pre-wrap`), never as HTML, and links are not turned into anchors in v1. Every text area shows a "N / 2000" counter and disables Send at 0 or over the limit. Send buttons are disabled while a call is in flight; each send generates its `requestId` once and reuses it on retry.

### Admin (PR5)

- **Routes:** `/admin` (Accounts, as today), `/admin/inbox`, `/admin/inbox/:threadId`. All guarded by `useIsSiteAdmin` like today.
- **Tabs** under the page title: **Accounts** and **Inbox** with an unread count (live `inbox where adminUnread == true`, `limit(100)`, shown as "99+" above 99). The same count shows on the profile menu's "Site admin" entry.
- **List:** filter chips **Open** (default), **Answered**, **Closed**, **All**, and a kind filter **All / Appeals / Feedback**. Rows: avatar, name and email, a kind label (Appeal; Feedback with its category), subject, `lastSnippet`, relative time, an unread dot when `adminUnread`. 20 per page, "Load more" with a cursor. Cards on narrow screens. Empty states per filter.
- **Thread view:** header (subject, sender, email, kind and category, status chip, started date; for a closed appeal, its outcome). No extra call fetches the account's status: an open appeal implies a blocked account, and the server refuses Keep blocked or Reopen if that is no longer true. Messages styled like Atrium's item updates (avatar, name, "Site Administrator" label on admin messages, time). Reply box (hidden when closed, with "This conversation is closed. Reopen it to reply."). Opening the thread sets `adminUnread: false` when it is true.
  - Feedback actions: **Close** / **Reopen**.
  - Appeal actions: **Unblock** (confirm; calls `setAccountStatus({ uid, status: 'approved' })`, which closes the appeal) and **Keep blocked** (confirm dialog with an optional final message; `keepBlocked`), **Reopen** on a closed appeal.
  - **Internal note** panel ("Only site admins see this"), saved on blur and on a short debounce, with "Saved" feedback.
  - **Delete thread** in a ⋯ menu, with a confirm that says it cannot be undone.

### Sender (PR6)

- **Profile menu** (`UserMenu.tsx`), above "About Atrium": **Send feedback** (opens the dialog) and **My feedback** (`/feedback`).
- **Send feedback dialog** (in `DialogHost`): category (Bug, Idea, Question, Other; default Idea), subject (120), message (2000), Send. On success: toast "Thanks, your feedback was sent." with a "View" action to `/feedback/{threadId}`. Limit errors show the exact reason ("You can have 3 open conversations at a time. Wait for a reply or for one to close.").
- **"Give feedback" in the Automation center header** (`CenterHeader.tsx`, the P5e gap): an icon button that opens the same dialog with category Idea and subject "Automation center". Update the row in `docs/specs/P5e-fidelity-gaps.md` (Opus edits the doc).
- **My feedback** (`/feedback`, `/feedback/:threadId`, inside `AppShell`): the person's feedback threads (status chip, unread dot from `senderUnread`, snippet, time), and the thread view with the messages and a reply box (or the closed notice). Opening a thread sets `senderUnread: false`.
- **Blocked screen** (`AccountGate`, blocked):
  - Text: "Your account is blocked" / "An admin has blocked this account, so you can't use Atrium with it. If you think this is a mistake, you can send an appeal below."
  - No appeal yet: a 2000-character box and **Send appeal**.
  - An open or answered appeal: the thread (live), "We'll show the reply here." and a reply box.
  - The latest appeal closed with `upheld`: the thread, "Your appeal was not accepted on {date}. You can send a new appeal from {date + 7 days}." and the box disabled until then (the server enforces it anyway).
  - **Sign out** stays. Unblock takes the person into the app without a reload (listener above).
- **Login page:** the `sessionStorage` notice after a forced sign-out (PR3). The WP-C `auth/user-disabled` text stays as is.

## Work packages in PR order

Branches start from fresh `origin/main` in their own worktree. Port offsets: 70, 80, 90 (reuse a number once its worktree is removed; 100 and up belong to Ava). Hot spots: `firestore.rules`, `tests/rules/**`, `packages/shared/**`, `tests/visual/__screenshots__/**`.

| PR  | Branch                           | Depends on | Hot spots                                                 | Ultrareview | Baselines         |
| --- | -------------------------------- | ---------- | --------------------------------------------------------- | ----------- | ----------------- |
| 1   | `claude/spec-admin-4-inbox`      | none       | none                                                      | no          | no                |
| 2   | `claude/inbox-data-rules`        | PR1        | `packages/shared/**`, `firestore.rules`, `tests/rules/**` | **yes**     | no                |
| 3   | `claude/approved-only-callables` | PR1        | `packages/shared/**` (error reason only)                  | **yes**     | no                |
| 4   | `claude/inbox-functions`         | PR2, PR3   | `tests/rules/**` (e2e test)                               | **yes**     | no                |
| 5   | `claude/inbox-admin-ui`          | PR4        | `tests/visual/__screenshots__/**`                         | no          | yes (new screens) |
| 6   | `claude/inbox-sender-ui`         | PR5        | `tests/visual/__screenshots__/**`                         | no          | yes               |
| 7   | `claude/inbox-purge`             | PR4        | none                                                      | no          | no                |

PR2 and PR3 can be built in parallel but merge in that order (both touch `packages/shared`). PR6 waits for PR5 because both edit `UserMenu.tsx` and the visual baselines. PR7 can go any time after PR4.

### PR1: this spec

- `docs/specs/ADMIN-4-appeals-inbox.md`. Opus also logs on the Decisions board: "Blocking no longer disables the Auth user; blocked people sign in to a blocked screen with an appeal box (owner, 2026-11-07)", and creates the Roadmap item.

### PR2: shared schemas, rules, indexes, rules tests

- `packages/shared/src/schemas/inbox.ts` (new): `INBOX_LIMITS`, kind, category, status, outcome, author role enums, `inboxThreadSchema`, `inboxMessageSchema`, `inboxNoteSchema`, `inboxLimitsSchema`.
- `packages/shared/src/inbox.ts` (new): callable names, request and result schemas for both callables (discriminated unions), `INBOX_ERROR_REASONS`, `normalizeInboxText()` (trim, strip control characters except newline and tab).
- `packages/shared/src/schemas/notification.ts`: kinds `inbox_new`, `inbox_reply`.
- `packages/shared/src/index.ts`: exports.
- Tests: `packages/shared/src/schemas/inbox.test.ts`, `packages/shared/src/inbox.test.ts`, `notification.test.ts`.
- Exhaustive maps that must compile with the new kinds: `functions/src/lib/notifications.ts` (`KIND_PRIORITY` 0, `prefKeyOf` null), `apps/web/src/components/AppShell/NotificationCard.tsx`, `notification-filter.ts`, `NotificationsPanel.tsx` (routing as above; the routes arrive in PR5 and PR6, and no such notification exists before PR4 deploys).
- `firestore.rules`: `isSiteAdmin()`, `isBlockedAccount()`, the `inbox`, `messages`, `inboxNotes`, `inboxLimits` matches, the `authed()` comment.
- `firestore.indexes.json`: the six indexes.
- `tests/rules/src/inbox.test.ts` (new).
- `docs/specs/ADMIN-site-admin-role.md`: the `isSiteAdmin()` sentence.

### PR3: approved-only callables, the blocking change, the gate shell

- `functions/src/lib/actor.ts` (+ `actor.test.ts`): `allow` option, `accountStatus` on the actor.
- `functions/src/lib/membership.ts`: `Actor` type gains `accountStatus` (if the type lives there).
- The 16 callables listed above; `bootstrapUser.ts` (profile sync for approved only).
- `functions/src/callable/approved-only.test.ts` (new guard test).
- `functions/src/lib/account-admin.ts` (+ `account-admin.test.ts`): block order, no `setDisabled(true)`, the new no-op check.
- `packages/shared/src/account-admin.ts` or `inbox.ts`: the `account-not-approved` reason constant (small).
- `apps/web/src/auth/AuthProvider.tsx` (+ test): the approved-session listener and forced sign-out; `refreshAccount` claim retry.
- `apps/web/src/auth/AccountGate.tsx` (+ test): blocked screen listens for unblock; interim text; a layout with room for the appeal panel (PR6).
- `apps/web/src/pages/LoginPage.tsx` (+ test): the one-shot "account was blocked" notice.
- `apps/web/src/lib/callables.ts`: `describeCallableError` maps `account-not-approved`.
- `tests/rules/src/account-callables.e2e.test.ts` (new, emulator): a pending token and a blocked token calling `createInvite`, `acceptInvite` and `submitForm` get `permission-denied`; an approved one passes the gate.
- Docs: `ADMIN-site-admin-role.md` (block bullet, honest limits, decision 4 note pointing here).

### PR4: Functions

- `functions/src/lib/inbox.ts` (+ `inbox.test.ts`): send, reply, admin actions, limits, idempotence, `deleteThread`, notification fan-out.
- `functions/src/lib/admin-inbox.ts`: Admin SDK adapter (transactions with queries; everything through `db()`).
- `functions/src/lib/notifications.ts` and `admin-notifications.ts` (+ tests): `upsertNotification`.
- `functions/src/lib/account-admin.ts`, `admin-account.ts` (+ tests): `closeOpenAppeals` on approve or unblock.
- `functions/src/callable/sendInboxMessage.ts`, `manageInboxThread.ts` (new); `functions/src/index.ts` exports.
- `functions/src/callable/approved-only.test.ts`: allowlist `sendInboxMessage.ts`.
- `apps/web/src/lib/callables.ts`: typed `inboxCalls` (used by PR5 and PR6).
- `tests/rules/src/inbox.e2e.test.ts` (new, emulator): a blocked token can appeal and read the thread; an approved one can send feedback; limits; another approved user can't reply to someone else's thread.

### PR5: admin web UI

- `apps/web/src/App.tsx`: routes `admin/inbox`, `admin/inbox/:threadId`.
- `apps/web/src/pages/admin/AdminPage.tsx` (+ test): tabs; keep the Accounts content as is (move it into `AccountsTab.tsx` if that keeps the file readable).
- New in `apps/web/src/pages/admin/`: `InboxTab.tsx`, `InboxThreadView.tsx`, `InboxNote.tsx`, `inbox.ts` (filters, labels, pure helpers), `Inbox.module.css`, tests for each.
- `apps/web/src/data/inbox.ts` (new): listeners (admin list with cursor, unread count, one thread, its messages) and the rules-checked writes (`adminUnread`, `senderUnread`, notes), with error callbacks.
- `apps/web/src/components/AppShell/UserMenu.tsx` (+ test): unread count on "Site admin".
- `tests/visual/src/screens.spec.ts`, `tests/visual/src/seed.ts`: "admin: Inbox list" and "admin: appeal thread" (the visual user needs the `admin` claim; seed one appeal and one feedback thread with fictional names on `example.com`). Baselines through the update workflow.

### PR6: sender web UI

- `apps/web/src/auth/AccountGate.tsx` (+ test), new `apps/web/src/auth/AppealPanel.tsx` (+ test): the appeal box and live thread.
- `apps/web/src/components/AppShell/UserMenu.tsx` (+ test): Send feedback, My feedback.
- `apps/web/src/components/dialogs/FeedbackDialog.tsx` (+ test), `DialogHost.tsx`, the dialog type in the UI store.
- `apps/web/src/pages/feedback/MyFeedbackPage.tsx`, `FeedbackThreadView.tsx` (+ tests), routes in `App.tsx`.
- `apps/web/src/components/automations/CenterHeader.tsx` (+ test): the Give feedback icon.
- A shared message list component if PR5's thread view can be reused (`apps/web/src/components/inbox/MessageList.tsx`); otherwise PR6 extracts it from PR5's view.
- Visual: "blocked screen with an answered appeal" (a second seeded emulator user with `acct: 'blocked'`), "Send feedback dialog", "My feedback thread"; the Automation center baseline changes (icon). Baselines through the workflow.
- `docs/specs/P5e-fidelity-gaps.md` row (Opus).

### PR7: purge

- `functions/src/scheduled/purgeOldNotifications.ts`, `functions/src/lib/purge.ts` or `lib/inbox.ts` (+ tests): the inbox and limits purge with injected `now`.

## Tests that must exist

- **Rules (`tests/rules/src/inbox.test.ts`):**
  - the sender (approved) reads their own thread and its messages; another approved user reads neither (single get and list query);
  - a blocked sender reads their own appeal thread and messages, but **not** their own feedback thread, and not anyone else's appeal; a list query without the `kind == 'appeal'` filter is refused;
  - a pending token reads nothing; a no-claim token reads nothing;
  - an admin reads every thread, message and note; an approved non-admin can't read notes;
  - nobody creates or deletes a thread or a message from a client, admins included;
  - the admin may set `adminUnread` to false only (changing `status`, `messageCount`, `adminUnread: true` or two keys at once is refused); the sender may set `senderUnread` to false only; a blocked sender can't write anything;
  - notes: admin create and update with valid shape only, `updatedAt == request.time`, `updatedBy` own uid, text over 2000 refused, a note for a missing thread refused, delete refused;
  - `inboxLimits` refused for everyone.
- **Functions unit (`inbox.test.ts`, `actor.test.ts`, `account-admin.test.ts`, `notifications.test.ts`):**
  - every limit at its edge (5th thread passes, 6th fails; 3 open; 30 and 10 messages; 200 per thread; 7-day appeal wait, exactly 7 days passes);
  - an approved caller can't appeal; a blocked one can't send feedback or reply to a feedback thread; a pending one can do nothing;
  - reply to someone else's thread gives `not-found`; reply to a closed thread fails;
  - status transitions (sender reply on answered gives open; admin reply gives answered; close locks; reopen restores);
  - `keepBlocked` sets `upheld` and the wait; reopen clears it; unblock closes open appeals with `unblocked` and a failure there does not fail the unblock;
  - idempotent `requestId`;
  - notification upsert: one doc per thread per recipient, overwritten with `readAt: null`; the author never notified; no bell for appeal senders;
  - `deleteThread` removes messages, note, thread and notifications;
  - block order (claims, revoke, doc), no `setDisabled(true)`, the no-op check with half-finished state;
  - `actorFromRequest` refuses pending, blocked and no-claim by default, honours `allow`; the guard test.
- **Emulator e2e:** `account-callables.e2e.test.ts` (PR3), `inbox.e2e.test.ts` (PR4).
- **Web:** AuthProvider forced sign-out on `blocked` and the claim retry; AccountGate (blocked: unblock listener; appeal states: none, open, answered, upheld with wait date); LoginPage notice; Inbox list filters, unread dot and badge, thread actions call the right callables, note save; FeedbackDialog validation, limit messages, toast; My feedback list and thread, closed notice; UserMenu entries; NotificationsPanel routing for both kinds.

## What Ophelia (Opus) reviews

- **PR2:** every rule against the table "What each side sees"; that `authed()` and `isBlockedAccount()` appear nowhere else; that no admin-only field is in `inbox` or `messages`; the tests cover the list-query cases, not just single gets. Ultrareview checkpoint.
- **PR3:** the guard test really fails on a new callable that reads `request.auth`; the block order; the no-op check; the forced sign-out cannot loop (one attempt per status change); `bootstrapUser` still works for pending and blocked people. Ultrareview checkpoint.
- **PR4:** every check happens inside the transaction (no read-then-write race for the open-appeal and open-feedback limits); the role comes from the callable; errors never reveal another person's thread; every Firestore access goes through `db()`; notification fan-out excludes the author and never reaches a blocked sender. Ultrareview checkpoint.
- **PR5, PR6:** text rendered as text; tokens only (Stylelint and the ESLint rule pass); listener error handling; the visual QA below; baselines updated through the workflow, never by hand.
- **PR7:** batch sizes, independence of the two purge steps.

## Visual QA and baselines

- Compare in light and dark with monday's in-app patterns: the Inbox list against monday's Inbox (notifications and update feed), the thread against monday's item updates, the feedback dialog against monday's "Give feedback" dialog, the tabs against monday's admin pages. Reference screenshots in `docs/reference/monday/` (Claude's home copy; read-only captures with Claude in Chrome if something is missing).
- Gaps go to the Roadmap's VF group.
- Baselines: new screens in PR5 and PR6, the Automation center screenshot changes in PR6. Run **Actions → Update visual baselines** on each branch, review the image diffs, and mention them in the PR description.

## Showcase, provenance, docs

- **Showcase:** no impact (no board feature or column type).
- **Provenance:** the owner's Minerva project is inspiration only; nothing is copied, so `docs/PROVENANCE.md` gets no row. If a PR does copy any of it, that PR adds a row with the owner's licence statement.
- **Docs:** `docs/architecture.md` gets a short "Inbox" subsection (collections, who writes what) in PR4; handoff notes per session; an entry in `docs/plans/owner-check-list.md` when PR6 is live.

## Owner checks (production, after PR6; second Google account as the test person)

1. With the second account signed in and on a board, block it from `/admin` → Accounts. Within a few seconds that tab goes to the login page with "Your account was blocked..."
2. Sign in again with the second account: the blocked screen shows the appeal box. Send an appeal.
3. On your account: the bell shows one Inbox notification, and `/admin` shows Inbox with an unread count. Open the appeal, add an internal note, reply.
4. The second account sees your reply on its blocked screen without reloading, and answers. Your thread is Open again, and the bell card moved to the top (still one card).
5. Click **Keep blocked**. The second account sees "not accepted" and the date it can appeal again; the box is disabled.
6. Click **Reopen**, then **Unblock**. The second account enters Atrium without reloading; the appeal shows as closed, Unblocked.
7. From the second account: profile menu → Send feedback (Bug). On your account, reply; the second account gets a bell notification and sees the reply in My feedback; it answers; you **Close**: the reply box is gone for both.
8. Try a 4th open feedback from the second account: it is refused with a clear message.

## Out of scope (v1)

- Attachments, email, web push for these kinds, priorities, feedback votes or a public feedback list.
- Pending people writing to the admins (T8).
- Editing or deleting single messages; a sender deleting their own thread (the admin deletes on request).
- A "delete everything from this person" button and account deletion (Atrium has none yet; the admin deletes threads one by one).
- Auto-closing stale open threads.
- App Check (every caller has a verified Google identity).
- Checking token revocation inside callables (an Auth lookup per call); the one-hour window stays for a modified client.

## Risks

- **Locking people out of callables (PR3).** If an approved person's token lacks the `acct` claim, every callable refuses them until the token refreshes. Mitigations: the ADMIN-1b backfill and self-heal already gave every account the claim, the web force-refreshes once per session, and the e2e test runs approved users through real callables. Rollback: revert PR3.
- **A blocked person now has a write path.** Bounded by: blocked tokens can only call `sendInboxMessage` actions `appeal` and `reply` on their own appeal; one open appeal; 10 messages a day; 2000 characters; 200 per thread; the 7-day wait. New Google accounts land as pending (approval is on), so a blocked person can't multiply appeals with new accounts.
- **The one-hour token window** for a modified client after a block (unchanged from the ADMIN spec).
- **Deploy CPU quota:** two new functions add about 1 vCPU to the deploy peak (T2 keeps it at two). If a deploy hits the quota, re-run it and raise it with the owner (a quota increase is the owner's call).
- **Personal data:** messages can hold personal details. Mitigations: private to the sender and admins, deleted 365 days after closing, deletable earlier by an admin, notifications (which copy a snippet) deleted with the thread and purged after 180 days anyway.
- **Indexes:** they deploy with PR2, well before PR5 and PR6 query them; a missing index would show in the listener error callback, not fail silently.
- **The sender can read `adminUnread`** on their thread. Harmless (it says only whether an admin has opened it), and never shown in the UI.

## Open questions

None. The owner decided T6 (the admin is shown as "Site Administrator") and accepted T7 (the daily caps) on 2026-11-07. Implementers: move `closedBy` and any other admin identity out of sender-readable documents into `inboxAudit` (admin-only; add it to the rules, the rules tests and the "What each side sees" table, and a rules test that a sender cannot read it), and add a test that no sender-readable document or notification contains an admin uid or name.
