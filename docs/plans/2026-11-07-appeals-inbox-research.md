# Appeals and feedback inbox: research and proposed design

Author: Ophelia (research for WP-D, item 3b of `2026-11-07-owner-feedback-round-2.md`). Date: 2026-11-07. Status: research only, no code. The spec (`docs/specs/ADMIN-2-appeals-inbox.md`) is written after the owner answers the questions in section 4.

Source: the owner's Minerva project (Vite, React, Firebase, Cloud Functions 2nd gen in JavaScript). The owner calls it **inspiration only**. Nothing below copies its code; if a later PR does copy any, it gets a `docs/PROVENANCE.md` row with the owner's licence statement.

## 1. What the owner's Minerva project has

Minerva has **no blocking and no appeals**. Its "messenger" is two related systems, shown to users together on one page ("My inbox", two tabs) and to admins in the admin panel:

1. **Error reports** ("incidencias"): a person flags a wrong question or flashcard; the admin and the reporter(s) talk in a thread on the report.
2. **Suggestions box**: a person sends feedback (category, title, description); the admin sets a status and priority and writes a team answer.

Both feed a shared **bell notification** system with optional web push.

### 1.1 Relevant files

| File                                                         | What it does                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firestore.rules`                                            | Rules for `reports`, `suggestions`, `suggestionReactions`, `user_notifications`.                                                                                                                                                                      |
| `functions/index.js`                                         | Callables `submitReport`, `replyToReport`, `editMyReportComment`; helpers `notifyAdminsOfNewReport`, `notifyAdminsOfUserReportReply`, `getAdminUids`; trigger `deliverNotificationPush` (push on each new notification); push subscription callables. |
| `src/services/reportService.js`                              | Client side of reports: calls the callables, admin reads (all reports, live), admin status, notes, comments and delete (direct writes).                                                                                                               |
| `src/services/suggestionsService.js`                         | Suggestions: direct `addDoc` by the user, email to the admin through a browser email service, bell notification to admins, admin update and delete, thumbs up and down reactions.                                                                     |
| `src/services/notificationService.js`                        | Bell notifications: send to one or many users, live subscription (last 20), mark read, clear all, `notifyAdmins`.                                                                                                                                     |
| `src/utils/adminReportNotifications.js`                      | Works out "unread per report" from unread bell notifications that point at the report.                                                                                                                                                                |
| `src/services/offlineActionService.js`                       | Queues a report, a reply or a suggestion while offline and sends it later.                                                                                                                                                                            |
| `src/components/common/ReportDialog.jsx`, `ReportButton.jsx` | The "report an error" dialog: fixed error types, optional description (300 characters).                                                                                                                                                               |
| `src/components/incidencias/MisIncidenciasPage.jsx`          | The reporter's view: their reports, status, the thread, reply and edit own comments, "new reply" badge.                                                                                                                                               |
| `src/components/admin/IncidencesManager.jsx`                 | Admin view of reports: status tabs with counts, 20 per page, mobile cards, internal notes, public reply, edit the content in place, delete.                                                                                                           |
| `src/components/suggestions/SuggestionsPage.jsx`             | Submit form, "my suggestions", a public list with votes, and the admin review tab (filters by status and category, priority, notes, delete).                                                                                                          |
| `src/components/buzon/BuzonPage.jsx`                         | The "My inbox" page joining the two tabs.                                                                                                                                                                                                             |
| `src/components/common/NotificationBell.jsx`                 | Bell with unread badge.                                                                                                                                                                                                                               |
| `CHANGELOG.md`, `MUSTREAD_PROJECTINSTRUCTIONS.md`            | History and lessons (section 1.6). `PHASE6_IMPLEMENTATION.md` and `README.md` have nothing on messaging.                                                                                                                                              |

### 1.2 Data model

**`reports/{hash}`**: one document per reported item (the id is a hash of the item key), so several reporters share one ticket.

- `reportTargetType` (question or flashcard), `compositeKey`, a copy of the item text, subject and chapter.
- `status`: `nuevo` (new), `en_revision` (in review), `por_verificar` (fixed, waiting for the reporter to confirm), `resuelto` (resolved), `rechazado` (rejected).
- `reportCount`, `reporterUids[]`, `submissions[]` (uid, name, error type, description, date).
- `comments[]`: an **array inside the document** (id, uid, name, `isAdmin`, message, `createdAt`, `editedAt`).
- `adminNotes` (internal, one text field), `createdAt`, `updatedAt`.

**`suggestions/{id}`**: `uid`, `displayName`, `email`, `category` (Feature, Design, Content, Performance, Other), `title` (120), `description` (1000), `status` (New, Considered, In development, Implemented, Rejected), `priority` (Low, Medium, High, admin only), `adminNotes` (shown to everyone as "the team's answer"), timestamps. Votes live in `suggestionReactions/{suggestionId}__{uid}`.

**`user_notifications/{id}`**: a flat collection: `userId`, `title`, `message`, `type`, `category` (general, goals, announcements, tickets, comments, suggestions, admin), `url`, `relatedReportId`, `isAdminReply`, `senderName`, `read`, `createdAt`.

### 1.3 Who can read and write (rules)

- `reports`: **any signed-in user can read every report**; any signed-in user can create; admins update and delete. In practice reporters create and reply through callables (the client-side update was refused by the rules, see 1.6).
- `suggestions`: **any signed-in user can read every suggestion, including the sender's email field**; a user creates their own; admins update and delete.
- `user_notifications`: a user creates notifications only for themselves (admins for anyone); the recipient reads, updates and deletes.
- Admin is `users/{uid}.role == 'admin'`, checked with a `get()` in the rules.

### 1.4 How people reach it

- Only **signed-in** people. There is no public form, no logged-out path and no token or link flow.
- Reports start from a small button on every question or flashcard; suggestions from a form on the inbox page.
- Offline submissions are queued and sent when back online.

### 1.5 Admin side, notifications, limits

- **Two-way threads on reports:** the admin replies in the thread; reporters reply and edit their own comments through callables. A `resuelto` or `rechazado` report is locked (no more comments). If the reporter replies while the report is `por_verificar`, it goes back to `en_revision` automatically.
- **Suggestions are one-way plus an answer:** the admin sets status and priority and writes "the team's answer", which also goes to the sender as a bell notification. No thread.
- **Admin list:** status tabs with counts, 20 per page, expandable rows (cards on mobile), internal notes next to the public reply, a sidebar badge with the number of new reports. Suggestions have filters by status and category.
- **Unread:** derived from unread bell notifications that point at a report, plus a "new reply" badge for the reporter. Opening the item marks those notifications read.
- **Notifications:** a bell notification to every admin on a new report, on each reporter reply and (attempted, see 1.6) on a new suggestion; to every reporter on each admin comment and status change; to the sender on a suggestion status change or answer. A Firestore trigger turns every new notification into a web push (per-category switches). New suggestions also send an **email** to the admin from the browser through a third-party email service.
- **Spam and abuse:** one report per person per item (`already-exists` otherwise), required fields and short length caps. No rate limit, no captcha, no App Check.
- **Attachments:** none. **Priorities:** admin-only on suggestions. **Categories:** fixed lists on both.
- **Retention:** none; the admin deletes by hand. Account deletion removes the person's notifications but leaves their reports and suggestions.

### 1.6 Lessons and bugs recorded or visible

From the owner's CHANGELOG and from reading the code:

1. **Client writes broke under the rules.** The reporter's replies were first written straight to `reports`, which the rules refuse for non-admins; they were moved to callables (CHANGELOG, "user replies through the backend"). Lesson: anything a non-admin sends goes through a Function.
2. **Admin notification for new suggestions most likely never arrives.** It runs in the sender's browser: it lists users with `role == 'admin'` (the rules let a user read only their own profile) and writes notifications for other people (the rules allow only your own). Both should be refused, and the error is swallowed. The browser email was the channel that worked. Lesson: notify admins from the server.
3. **Privacy:** every signed-in user can read every report (with the reporters' names and uids) and every suggestion (with the sender's email). Atrium must keep threads private to the sender and the admins.
4. **Notifications missing because of an index:** a `where` plus `orderBy` query needed a composite index that did not exist and failed silently (CHANGELOG). Lesson: declare indexes and handle listener errors.
5. **Thread as an array in one document:** editing a comment rewrites the whole array; it races with a concurrent reply and grows towards the 1 MB document limit. Lesson: one document per message.
6. **Unread state tied to notifications:** "Clear all" in the bell deletes the notifications, and with them the unread marker on the report. Lesson: keep read state on the thread itself.
7. **A notification per message** (and to every reporter) was noisy; the owner later added push per category to control it.
8. **Email from the browser** needs the email service's keys in the web bundle. Atrium should send any email from a Function with a secret, or not at all.
9. **Good ideas to keep:** status that flips back to "open" when the sender replies to an answered thread; locking closed threads; internal admin notes kept apart from the reply; a badge with the open count; one open ticket per subject (deduplication); 20 per page with cards on mobile; offline-friendly submit.

## 2. Atrium today (what this builds on)

- **Account state** (`docs/specs/ADMIN-site-admin-role.md`): `users/{uid}.accountStatus` pending, approved or blocked, plus the custom claims `acct` and `admin`. `signedIn()` in `firestore.rules` requires `acct == 'approved'`; `authed()` (any state) is used only to read your own `users/{uid}`. Storage rules are deny-all.
- **Blocking** (`functions/src/callable/setAccountStatus.ts`, `lib/account-admin.ts`): sets `acct: 'blocked'`, revokes refresh tokens and **disables the Auth user**, so a blocked person cannot sign in again and holds no token (except one already issued, for up to an hour). Unblock re-enables and approves. Changes are logged in `system/accountAudit`.
- **Sign-in error** (item 3a): a disabled user gets `auth/user-disabled`, today shown as "Sign-in failed. Please try again." WP-C changes it to "Your account has been disabled. If you think this is an error, you can submit an appeal."
- **AccountGate** (`apps/web/src/auth/AccountGate.tsx`): full-page "Waiting for approval" (listens to the user doc, refreshes the token on approval) and "Your account is blocked" (sign out only).
- **Admin screen** (`apps/web/src/pages/admin/AdminPage.tsx`): accounts table from the `listAccounts` callable, status tabs, search, approve, block, unblock. Guarded by the `admin` claim.
- **Notifications** (`packages/shared/src/schemas/notification.ts`): `users/{uid}/notifications/{id}`, written only by Functions, deterministic ids (`${kind}-${eventId}-${uid}`), `readAt` set by the recipient, purged after 180 days. Kinds include `account_request` and `account_approved`, which use a sentinel for the required `workspaceId` and `boardId` fields (`ACCOUNT_NOTIFICATION_REF`).
- **Functions:** 2nd gen, `europe-west1` through `lib/global-options.ts`; inputs parsed with zod schemas from `packages/shared`; `actorFromRequest` checks only that the caller is signed in. There is **no email sending, no rate limiting and no App Check** in Atrium yet.
- **Side finding (worth a fix with or before WP-D):** `actorFromRequest` does not check the `acct` claim, so a pending person, or a blocked person whose old token is still valid, can call callables such as `submitForm`, `createInvite` or `acceptInvite`. The rules still refuse their reads and writes, and most callables check membership, but a central "approved only" check (with an explicit opt-out for `bootstrapUser` and the inbox callables) would close it. This matters more if option B below is chosen.

## 3. Proposed design for Atrium

### 3.1 How a blocked person reaches the inbox (the main choice)

A blocked person has a disabled Auth user, so they cannot get a Firebase token and cannot be identified the usual way. Three options:

- **Option B (recommended): block without disabling the Auth user.** Blocking keeps `acct: 'blocked'` and revokes tokens but leaves the Auth user enabled. A blocked person can sign in with Google; the rules already refuse them everything (`signedIn()` needs approved), and `AccountGate` shows the blocked screen, now with an **appeal box** and the replies. Identity is proven by Google sign-in, there is no public endpoint to spam, and two-way replies just work. Cost: it changes the 2026-11-06 decision "blocking signs the person out and they can't sign in again" (they are still signed out at block time, but can sign back in to see the blocked screen), and it requires the central approved-only check in callables (section 2), so a blocked token can call only `bootstrapUser` and the inbox callables. Unblock no longer needs to re-enable the Auth user. Existing blocked accounts would be re-enabled by a one-off script.
- **Option A2: keep disabling, verify with Google on the login page.** After `auth/user-disabled`, the login page offers "Appeal": a separate Google sign-in through Google Identity Services gives a Google ID token (not a Firebase one); a public callable `submitAppeal` verifies it (audience is Atrium's web OAuth client id), looks up the Auth user by email, and accepts the appeal only if that user exists and is blocked. Strong identity and no change to blocking, but new plumbing (a Google script on the login page, ID token verification in Functions) and replies can only be shown the same way (verify again to view). Needs a short spike to confirm the flow on the custom auth domain.
- **Option A1: an open public form** (name, email, message). Simplest UI, but anyone can send anything under any email; needs App Check (reCAPTCHA) plus per-IP and per-email limits, and the admin can never be sure who wrote. Not recommended.

Pending people (waiting for approval) can use the same box as blocked people under any option where they hold a token (they already do), for a short "who I am" note. Optional.

### 3.2 Data (named database `atrium-1`; zod schemas in `packages/shared`)

- **`inbox/{threadId}`** (one thread per appeal or feedback item):
  - `kind`: `appeal` or `feedback`
  - `category` (feedback only): `bug`, `idea`, `question`, `other`
  - `subject` (1 to 120 characters; appeals get a fixed "Appeal")
  - `senderUid`, `senderName`, `senderPhotoURL` (denormalised at write time). The email is **not** stored; the admin screen already has it through `listAccounts`.
  - `status`: `open`, `answered`, `closed`. A sender reply on `answered` sets `open` again (Minerva's good idea). `closed` locks the thread.
  - `outcome` (appeals only): `null`, `unblocked` or `upheld`, set when an admin closes it.
  - `messageCount`, `lastMessageAt`, `lastMessageBy` (`sender` or `admin`), `lastSnippet` (200).
  - `adminReadAt`, `senderReadAt`: read markers on the thread (not in notifications). Unread for a side means `lastMessageAt` is later than its marker and the last message came from the other side.
  - `adminNote` (internal, 2000, never shown to the sender) or, cleaner, a separate `inboxNotes/{threadId}` document only admins can read. Recommended: the separate document, so one rule can let the sender read the whole thread document.
  - `createdAt`, `updatedAt`, `closedAt`, `closedBy`.
- **`inbox/{threadId}/messages/{messageId}`**: `authorUid`, `authorRole` (`sender` or `admin`), `authorName`, `text` (1 to 2000), `createdAt`. No edits in v1 (an honest record; Minerva's edits are where the array race came from). Admin replies are signed as "Atrium admin" to the sender, with the admin's name only in the admin view (to decide).
- **`inboxLimits/{uid}`**: Functions-only counters for rate limits (day window start, threads today, messages today).
- **Indexes:** `inbox` by `status` plus `lastMessageAt` desc, and by `kind` plus `status` plus `lastMessageAt`; `inbox` by `senderUid` plus `lastMessageAt`. Declared in `firestore.indexes.json`.

### 3.3 Rules (with emulator tests in `tests/rules/`)

- A new helper `isSiteAdmin()` = `signedIn() && request.auth.token.get('admin', false) == true`.
- `inbox/{id}` and `messages`: **create, update, delete: false for clients** (Functions only), except the read markers:
  - read: `isSiteAdmin()`, or `signedIn() && resource.data.senderUid == uid()` for approved senders. Blocked and pending senders read through a callable (option B keeps `authed()` limited to the user document, as the ADMIN spec requires) or, if the owner prefers live updates on the blocked screen, a second narrow `authed()` exception for `kind == 'appeal'` threads they sent. Recommended: the callable, to keep the gate rule simple.
  - update: admin may change `adminReadAt` only (equal to `request.time`); the approved sender may change `senderReadAt` only.
- `inboxNotes/{id}`: read and write `isSiteAdmin()` only (small, so a rules write is fine), or Functions-only for consistency.
- `inboxLimits/{uid}`: no client access.
- Tests: sender sees only their own threads; another approved user sees nothing; pending and blocked tokens are refused; admins read all; nobody writes `status`, `messageCount` or messages from a client; read-marker updates are limited to the one key.

### 3.4 Functions (2nd gen, `europe-west1`, zod input, Admin SDK on `atrium-1`)

- `submitFeedback({ category, subject, text })`: approved callers only. Creates the thread and its first message in one transaction, applies the rate limit, notifies admins.
- `submitAppeal({ text })`: option B: caller's token must be `acct == 'blocked'` (or pending, if allowed); one open appeal per account (a second call adds a message to it instead); after an `upheld` outcome, a new appeal only after a waiting period. Option A2: takes a Google ID token instead and verifies it.
- `replyToInboxThread({ threadId, text })`: the sender (not on a closed thread) or an admin. Updates status (`answered` after an admin reply, `open` after a sender reply), counters, the snippet, and notifies the other side.
- `setInboxThreadStatus({ threadId, status, outcome? })`: admins only; close or reopen.
- `getMyAppeal()` (option B): returns the caller's appeal thread and messages for the blocked screen, since the rules refuse blocked tokens.
- **Unblock from the appeal:** the admin presses Unblock on the thread; the web calls the existing `setAccountStatus` and then `setInboxThreadStatus(closed, unblocked)`, or `setAccountStatus` closes any open appeal itself (one place, preferred).
- `purgeClosedInboxThreads` (scheduled, daily, like `purgeOldNotifications`): deletes threads closed more than the retention period ago, with their messages.

### 3.5 Notifications

- New kinds: `inbox_new` (to every admin: a new appeal or feedback, or a sender reply) and `inbox_reply` (to the sender: an admin replied). Both use the `ACCOUNT_NOTIFICATION_REF` sentinel for `workspaceId` and `boardId`, like the account kinds; the snippet carries the first 200 characters.
- **One notification per thread per recipient**, with a deterministic id (`inbox_new-${threadId}-${uid}`) that is rewritten with the newest snippet and `readAt: null`, so a long exchange does not flood the bell (Minerva lesson 7).
- Admin kinds always delivered; a preference switch for `inbox_reply` is optional (strict prefs map, so adding a key is a rules change).
- A blocked sender cannot see the bell (rules); they see replies on the blocked screen.
- **Email:** none in v1. If wanted later: a Function with an SMTP or provider secret in Secret Manager (never in the web bundle), or the Firebase "Trigger Email" extension, sending one daily digest to the admins.

### 3.6 Web UI (Vibe components, tokens only, light and dark)

- **Admin:** `/admin` gets tabs **Accounts** and **Inbox** (with an unread count badge, also on the profile menu's "Site admin" entry). Inbox: filter chips Open, Answered, Closed, All and a kind filter (Appeals, Feedback), list rows with sender avatar and name, kind and category label, snippet, time, unread dot. Opening a row shows the thread (messages like Atrium's item updates), a reply box, Close or Reopen, the internal note, and for appeals the account's status with **Unblock** and **Keep blocked** (closes with `upheld`). 20 per page.
- **Feedback entry point:** "Send feedback" in the profile menu (this is the "Give feedback" header icon P5e left out); a small dialog with category, subject and text. "My feedback" list with the threads and replies, reachable from the same menu and from `inbox_reply` notifications.
- **Blocked screen (option B):** the existing "Your account is blocked" page gets an appeal box (2000 characters), then shows the thread and any admin reply, with Sign out. **Login page:** WP-C's message says "Sign in to see your account's status and send an appeal." (option B) or offers "Appeal" (option A2).
- Visual QA against monday's in-app patterns (inbox and update threads) in both themes; showcase board unaffected.

### 3.7 Rate limits and anti-spam (enforced in the Functions)

- Feedback: at most 5 new threads per person per day, at most 3 open threads at once, 30 messages per day.
- Appeals: one open appeal per account; after `upheld`, a new appeal only after 7 days; 10 messages per day.
- Text 1 to 2000 characters, subject 1 to 120; plain text only (rendered as text, never HTML).
- No App Check needed under option B (every caller has a verified Google identity). Option A1 would need App Check with reCAPTCHA plus per-IP limits.

### 3.8 PR split (small, hot spots in order)

1. Spec `ADMIN-2-appeals-inbox.md` (Opus, after the answers).
2. Shared schemas and limits, rules, indexes, rules tests (hot spots: `packages/shared`, `firestore.rules`, `tests/rules`).
3. The central approved-only check in `actorFromRequest` with opt-outs, and option B's blocking change plus the re-enable script (if chosen).
4. Functions: callables, notifications, purge, tests.
5. Web: admin Inbox tab, feedback dialog and list, blocked-screen appeal, visual specs.

## 4. Questions for the owner (with recommended defaults)

1. **How does a blocked person send an appeal?** Default: **option B**, blocked people can still sign in with Google and see the blocked screen with an appeal box. Reason: their identity is proven, there is no public form to spam, and they can read your reply.
2. **Two-way or one-way?** Default: **two-way threads** (you reply, they can answer back) until you close the thread, which locks it. Reason: an appeal often needs one question and one answer.
3. **Is feedback routed to the same inbox?** Default: **yes**, one Inbox tab with an Appeals or Feedback filter, and "Send feedback" in the profile menu for signed-in people. Reason: one place to read, and it gives the missing "Give feedback" button a home.
4. **Feedback categories and priority?** Default: **Bug, Idea, Question, Other; no priority** for now. Reason: enough to sort, and you are the only reader.
5. **Attachments (screenshots)?** Default: **none in v1**. Reason: Storage rules are deny-all and the upload plumbing is a separate job; can be added later with the update-attachment code.
6. **Email to you on a new message?** Default: **no, bell notification only** (one per thread, not per message). Reason: Atrium sends no email today, and adding it needs a provider and a secret.
7. **How long are closed threads kept?** Default: **365 days after closing, then deleted automatically**; you can delete earlier. Reason: enough history for repeat appeals without keeping personal messages forever.
8. **Limits?** Default: **one open appeal per account (7 days' wait after a refused one); feedback 5 new threads a day, 3 open at once, 2000 characters a message.** Reason: stops loops and floods without getting in the way of family and friends.
