# ADMIN: Site admin role, with account approval and blocking

Author: Ophelia · Implementers: Sonnet 5.5 (medium effort) · Roadmap: item "Feature: site admin role, with account approval and blocking" · Origin: bug inbox request, 2026-11-05 · Status: **ADMIN-1a merged, ADMIN-2 in review (behind ACCOUNT_APPROVAL_REQUIRED, default off). ADMIN-3 in review. ADMIN-1b (the gate) in review, DO NOT MERGE until the owner approves.** Defaults confirmed by the owner on 2026-11-06 (see Decisions); the technical choices below are mine and the owner can change them.

## Goal

The owner's account becomes the site-wide admin. Every account has a state: **pending**, **approved** or **blocked**. A new sign-up waits as pending until an admin approves it; an admin can block (and unblock) anyone. A blocked or pending person can read and write nothing in Atrium.

## Decisions (owner, 2026-11-06)

1. **Existing accounts stay approved.** Only new sign-ups wait.
2. **A pending person sees a "waiting for approval" screen** after Google sign-in (sign-in is not refused).
3. **The admin gets a bell notification** for each new request, plus the admin screen.
4. **Blocking signs the person out and refuses all their reads and writes.**

## Facts this design rests on

- Every rule goes through one helper, `signedIn()` (`request.auth != null`) in `firestore.rules`, and the Storage rules have their own. That is the one choke point to tighten.
- Storage rules can't read Firestore documents (`docs/architecture.md` section 2.1), so the state has to travel in the sign-in token. A **custom auth claim** is the only thing both rule sets can read.
- `bootstrapUser` (`functions/src/callable/bootstrapUser.ts`) runs after every sign-in and creates `users/{uid}` and the personal workspace.
- Notifications are `users/{uid}/notifications/*`, written only by Functions (P4).
- The repository is public: no real emails or ids in code, docs or tests. The admin is identified by uid, kept outside the repo.

## Design

### State (server-owned)

- `users/{uid}.accountStatus: 'pending' | 'approved' | 'blocked'`, `statusChangedAt`, `statusChangedBy`. Written only by Functions: the existing `users/{uid}` update rule already lists the few client-writable keys, so these are refused to clients as is (a rules test pins it).
- Custom claims on the Auth user: `acct: 'approved' | 'blocked'` and, for admins, `admin: true`. **A missing `acct` claim means pending.** Claims are set only by Functions (Admin SDK).
- Site admins: the set of uids with `admin: true`, granted by a one-off script (`pnpm admin:grant --uid <uid>`, dry run by default), never by a client call. The owner's uid stays in `.private/project-ids.md`.

### Gate in the rules

- `signedIn()` becomes "signed in **and** `request.auth.token.acct == 'approved'`", in `firestore.rules` and `storage.rules`. Everything that used `signedIn()` is gated at once.
- Two narrow exceptions use a new `authed()` (`request.auth != null`): a person reads **their own** `users/{uid}` (so the app can show pending or blocked) and the callables run outside the rules anyway. Nothing else.
- `isSiteAdmin()` is `request.auth.token.admin == true`, for the admin screen's read of the users list (below).

### Sign-in flow

1. `bootstrapUser` creates `users/{uid}` with `accountStatus: 'pending'` for a new account (existing documents are untouched), **skips creating the personal workspace until approved**, and notifies the admin(s) (below). If the uid already has an approved claim it behaves as today.
2. The web app, after sign-in, reads `users/{uid}`: `pending` shows the waiting screen (name, "An admin needs to approve your account", Sign out), `blocked` shows a blocked screen and signs out. The app listens to the document, so approval lets the person in without reloading (it then force-refreshes the ID token so the new claim applies).
3. Approval runs a Function that sets the claim, `accountStatus: 'approved'`, and creates the personal workspace (the same code `bootstrapUser` uses today).

### Admin actions (callables, admin only; `request.auth.token.admin` checked, never the client)

- `setAccountStatus({ uid, status: 'approved' | 'blocked' })`:
  - **approve:** set claim `acct: 'approved'`, update the user document, create the personal workspace if missing, send the person an in-app notification.
  - **block:** set claim `acct: 'blocked'`, `revokeRefreshTokens(uid)` and **disable the Auth user**, so they are signed out and can't sign in again. An admin can't block themselves or the last admin.
  - **unblock:** re-enable the Auth user and set `approved`.
  - Each change appends a line to `system/accountAudit` (who, whom, what, when); admins read it, nobody writes it from a client.
- `listAccounts` (callable, admin only): the admin screen's data (display name, email, status, created, last sign-in), paged. A callable rather than a rules read, because the email must not be readable from `users` by other people.

### Admin notifications

On a new pending account, a Function writes a `users/{adminUid}/notifications` entry (kind `account_request`, with the name and a link to the admin screen) for every uid with `admin: true`. The kind is added to the notification kinds and to the preference list like the others.

### Admin screen (web)

`/admin` (route guarded by the `admin` claim, link in the profile menu only for admins): a table of accounts with a status chip, search, filter by status (Pending first), and **Approve** / **Block** / **Unblock** actions with a confirm for Block. Tokens only, Vibe components, light and dark; compared with monday's admin "Users" page for the layout.

### Migration

A dry-run-by-default script (`scripts/migrations/`, patterned on the other backfills) sets `acct: 'approved'` and `accountStatus: 'approved'` for **every existing Auth user**, so nobody is locked out when the gate ships. It must run **before** the rules deploy; the PR order and the deploy gotcha below enforce that. Not run without the owner's go-ahead.

## Honest limits

- A claim lives in the ID token, which stays valid up to **one hour**. Blocking revokes refresh tokens and disables the account, so the person can't get a new token, but a token they already hold can still read and write until it expires (at most an hour). If the owner wants zero tolerance, the alternative is a `get(users/{uid})` check in `signedIn()`; it costs one extra document access per request, and Storage can't do it at all. I recommend the claim approach for a family-and-friends app.
- Existing sessions of an approved person pick up a status change on their next token refresh (up to an hour) unless the app force-refreshes, which it does for approval.
- The MCP connector and scripts that use the Admin SDK bypass rules as before.

## Open questions for the owner (defaults in bold)

1. A person who accepts a valid invite from an approved member still waits for approval? **Yes, still waits** (alternative: an invite approves them, simpler for family).
2. How many admins? **Any number, granted by the script;** only your account at first.
3. Should a blocked person see a message or just be signed out? **A short "your account is blocked" screen,** then sign out.

## PR split

1. **ADMIN-1a shared and backfill (no gate):** `accountStatus` and claim types, `users` rules refusing client writes to the new fields, the backfill script and its test. Hot spots, small. Then the backfill is run (dry run reported first, applied with the owner's go-ahead).
2. **ADMIN-1b the gate:** the gated `signedIn()` in `firestore.rules` and `storage.rules` with emulator tests (approved, pending, blocked, no claim, admin; users self-read; Storage). Merge only after the backfill is verified.
3. **ADMIN-2 functions:** `bootstrapUser` changes, `setAccountStatus`, `listAccounts`, the notification, the audit log, `pnpm admin:grant`, tests (cannot block self or the last admin, claims and disable calls, idempotence).
4. **ADMIN-3 web:** waiting and blocked screens, the token refresh on approval, the `/admin` screen, the notification kind, showcase and visual specs, an owner check-list entry.

## The `ACCOUNT_APPROVAL_REQUIRED` switch (ADMIN-2)

ADMIN-2 changes nothing for anyone until the switch `ACCOUNT_APPROVAL_REQUIRED` is on. It is a plain environment variable (unset means **false**, read in `functions/src/lib/account-flag.ts`), set by the committed file `functions/.env.atrium-board`. It deploys when a PR that changes the file is merged to `main` (CI deploys). Rollback is a PR that sets it to `false`. Flip it only after the gate (ADMIN-1b) and the web screens (ADMIN-3) have shipped.

- **Off:** `bootstrapUser` returns what it always did. A user doc it creates also gets `accountStatus: 'approved'`, `statusChangedAt`, `statusChangedBy: 'system:bootstrap'`, and the Auth user gets `acct: 'approved'` (other claims kept), so accounts created before the gate ships are already approved. A failed claim write is logged and never breaks sign-in. Existing users are never touched.
- **On:** a new account is created `pending`, with no claim and no workspace; the result is `{ accountStatus: 'pending' }` (`workspaceId` absent); every uid with `admin: true` gets an `account_request` notification. A pending or blocked user keeps getting `{ accountStatus }` and no workspace. Approval (`setAccountStatus`) creates the workspace and sends `account_approved`.
- The admin callables `setAccountStatus` and `listAccounts` exist in both states (only admins can call them).
- The two account notification kinds have no preference switch: the prefs map and its rules are strict, so they are always delivered.
- Blocking an admin also removes their `admin` claim; unblocking does not restore it (re-grant with `pnpm admin:grant`).

## Deploy gotcha

The gate and the backfill are a pair. If the rules ship before every existing account has `acct: 'approved'`, everyone, including the owner, is locked out. So the gate ships **last and separately**: ADMIN-1a (types, claim helpers, backfill script, no gate), then the owner-approved backfill run and a check that every account has the claim, then ADMIN-1b (the gated `signedIn()` in both rule files). Until the gate ships nothing changes for anyone.

### Running the backfill

Only after ADMIN-1a is merged, and only with the owner's go-ahead. Needs `gcloud auth login` with a
user that can administer Auth and Firestore in the project. Run from the repo root:

1. **Dry run** (writes nothing; prints counts and the uids that would change, never emails or names):
   `pnpm exec tsx scripts/migrations/2026-11-backfill-account-claims.mjs --project atrium-board`
2. **Apply**, once the report looks right (every existing Auth user gets `acct: 'approved'`, other claims kept; profiles get `accountStatus: 'approved'`, `statusChangedAt`, `statusChangedBy: 'system:backfill'`; blocked accounts are left alone):
   `pnpm exec tsx scripts/migrations/2026-11-backfill-account-claims.mjs --project atrium-board --apply`
3. **Verify:** run the dry run again. It must report `to change 0`.
4. **Then** the owner's own admin claim: `pnpm admin:grant --uid <uid> --project atrium-board` (dry run), then add `--apply`. The uid stays in `.private/project-ids.md`.
5. **Only then** merge ADMIN-1b (the gate).

The scripts call the Identity Toolkit REST API (`GET /v1/projects/{project}/accounts:batchGet`, `POST /v1/projects/{project}/accounts:update`) and the Firestore REST API with a `gcloud auth print-access-token` bearer token and the `x-goog-user-project: <project>` quota header (`--no-quota-project` drops it). Without `--project` they use the local emulators. Re-running is safe.

## ADMIN-1b: what the gate PR does, rollout order and rollback

**What it changes.** `firestore.rules`: `signedIn()` is now "signed in and `request.auth.token.get('acct', '') == 'approved'`". The new `authed()` (signed in, any state) is used in exactly one place: reading your own `users/{uid}` document, so the app can show the waiting or blocked screen. Every other rule goes through `signedIn()`, and no inline `request.auth != null` is left. A pending person still cannot write their own `users/{uid}`. The admin screen itself uses callables, so these rules needed no `isSiteAdmin()` helper at the time; ADMIN-4 (`docs/specs/ADMIN-4-appeals-inbox.md`) adds one (`isSiteAdmin()`: approved and carrying the `admin` claim) for the Inbox collections, and `isBlockedAccount()` for a blocked person reading their own appeal threads. `storage.rules` stay deny-all (no client access at all, so nothing to gate; a test pins it for pending and blocked tokens too). Callables and Functions use the Admin SDK and are unaffected, as are public forms (served through callables).

**Also in the PR.** (1) The web app force-refreshes the ID token once per session when the bootstrap says approved (or reports no status) but the token has no `acct: 'approved'` claim, before data subscriptions start, so sessions that pre-date the claim keep working; a failure is logged and never blocks sign-in. (2) `bootstrapUser` heals an existing account whose token has no `acct` claim: it sets `acct: 'approved'` when the profile says approved, or has no status while the approval flag is off. It never touches pending or blocked profiles, an existing claim, or a disabled user. (3) The emulator users that visual and e2e scripts create now carry the approved claim.

**Rollout order (do not skip a step).**

1. The backfill has been applied and re-verified (`to change 0`), and the owner's account has `admin: true` (done).
2. Owner says go; merge this PR (rebase merge). CI deploys the rules and Functions.
3. Verify the deploy (the Actions run is green, the site loads).
4. The owner signs out and in once. If the app shows nothing or an error, roll back (below).
5. To test with a second Google account as pending: the flag is off, so a new sign-up would just be approved. Turn it on: set `ACCOUNT_APPROVAL_REQUIRED=true` in the committed file `functions/.env.atrium-board` and merge that to `main` (CI deploys the Functions), then sign in with the second account (it should show "Waiting for approval"), approve it from `/admin`, then block and unblock it. Set the flag back to off (or leave it on, which is the intended end state) with another PR.

**Rollback.** Revert this PR (rules and the other changes go back together) and let CI deploy. The claims on the accounts are harmless without the gate, so nothing else needs undoing. Because the rules are only the choke point, a revert takes effect immediately for new requests; clients holding a token keep working throughout.

**Remaining risks (known).** (a) An approved person whose token lacks the claim and who is offline or whose refresh fails is refused until the token refreshes (at most an hour) or they sign in again. (b) A brand-new account created while the flag is off gets its claim from `bootstrapUser` a moment after sign-in; the web app's one-time token refresh covers that gap. (c) The one-hour token window on block described under "Honest limits" is unchanged.

## Tests that must exist

- Rules (Firestore and Storage): approved reads and writes as before; pending, blocked and no-claim are refused everywhere except self-read of `users/{uid}`; admin-only paths; clients cannot write `accountStatus`.
- Functions: approve creates the workspace once; block revokes and disables; self-block and last-admin refusals; non-admin callers are refused; a second approve is a no-op.
- Web: waiting screen, blocked screen, the approval flow without reload, `/admin` actions.

## Definition of done

The five checks pass, CI is green including `visual`, the backfill ran (dry run reported first, then applied with the owner's go-ahead), a test account shows the waiting screen and is approved from `/admin` on production, the Roadmap item is In review with Actionable = Yes and an entry in `docs/plans/owner-check-list.md`.
