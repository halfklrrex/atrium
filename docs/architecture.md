# Atrium — Architecture (v0.1, P0)

Owner: Opus 5.5 (planning). Implementation: Sonnet 5.5 subagents. Changes to this document are logged on the monday "Decisions & Questions" board.

## 1. Goals that shape the design

1. **monday-shaped data.** Workspaces → folders → boards → groups → items → subitems, with typed columns whose values use monday's column-value JSON shapes. This makes the P8 API, the P10 Claude connector and the P11 monday importer mostly mapping work.
2. **Multi-user from day one.** Any Google user can sign in and create unlimited workspaces; workspaces are shared by invite. Firestore security rules are the enforcement layer, so every collection ships with rules and emulator tests.
3. **Realtime.** The UI subscribes with Firestore listeners and writes optimistically; there is no separate API server for the web app.
4. **Server logic only where needed.** Cloud Functions handle cross-document invariants (bootstrap, invites, mirrors, activity log, automations, integrations). Plain CRUD goes straight from client to Firestore under rules.

## 2. Platform

| Concern | Choice |
|---|---|
| Hosting | Firebase Hosting, SPA rewrite to `/index.html` |
| Auth | Firebase Auth, Google provider (Microsoft / Apple added later as extra providers) |
| Database | Cloud Firestore, **named database `atrium-1`**, location `eur3`, scheduled backups on |
| Files | Cloud Storage, bucket `atrium-board.firebasestorage.app`, `europe-west1` |
| Server code | Cloud Functions 2nd gen, Node 22, region `europe-west1` |
| Scheduling | Cloud Scheduler via `onSchedule` (P5+) |
| Secrets | Secret Manager via `defineSecret` (P9+) |
| Abuse protection | App Check with reCAPTCHA Enterprise (P4) |

### 2.1 The Firestore database (`atrium-1`)

Decision (2026-10-25, owner): Atrium uses the named database `atrium-1` (`eur3`, Europe, scheduled backups), not the project's `(default)` database, which was created in `nam5` (US) and is unused legacy. Nothing reads or writes `(default)` any more; the owner decides later what to do with it.

- **One constant.** `FIRESTORE_DATABASE_ID` (`packages/shared/src/firebase-env.ts`) is the only place the id is written in source. The web app (`getFirestore(app, FIRESTORE_DATABASE_ID)`, emulator included), the functions (`getFirestore(FIRESTORE_DATABASE_ID)` in `functions/src/lib/admin.ts`, and `database: FIRESTORE_DATABASE_ID` in the options of every Firestore trigger), the showcase and migration scripts (`--database` overrides it), the visual-test seed and the rules tests import it. `scripts/database-id.test.mjs` fails on a hard-coded id or `(default)`, on a `getFirestore`/`initializeFirestore`/`onDocument*` call without the constant, and when `firebase.json` lists another database.
- **`firebase.json`** uses the array form, `"firestore": [{ "database": "atrium-1", "rules": ..., "indexes": ... }]`, so `firebase deploy` releases the rules and indexes to `atrium-1`. Rules and indexes are per database. The emulator accepts a single-entry array and serves any database id of the project, so `pnpm dev` and `pnpm test:rules` use `atrium-1` too.
- **Triggers need `database`.** A Firestore trigger declared without it listens to `(default)` only and never fires for `atrium-1`. For a named `eur3` database firebase-tools creates the Eventarc trigger in `eur3` (the database's location) while the function runs in `europe-west1`; details in `docs/DEPLOY.md`.
- **Rules tests.** `@firebase/rules-unit-testing` 6.0 builds its contexts on the compat SDK, which can only open `(default)`. `tests/rules/src/helpers.ts` therefore wraps the contexts so `firestore()` returns a modular-SDK handle on `atrium-1` (same emulator, same mock auth tokens), and `database.test.ts` proves the data lands in `atrium-1` and the rules apply to it. The rules file is the same for every database (`match /databases/{database}/documents`).
- **Storage rules cannot read Firestore.** Cloud Storage security rules can read Firestore with `firestore.get()` / `firestore.exists()`, but Google documents that they can only access documents from the default Cloud Firestore database, and the release notes only show `/databases/(default)/documents/` paths. Atrium's data is in `atrium-1`, so **Storage rules must not depend on Firestore documents**. File access control has to come from the object path and custom metadata (`request.auth.uid` in the path, `resource.metadata`), or from files served through a Cloud Function (a callable that checks membership with the Admin SDK and returns a signed URL). Nothing in `storage.rules` changed. Sources: https://firebase.google.com/docs/storage/security/rules-conditions ("Enhance with Cloud Firestore") and https://firebase.google.com/support/release-notes/security-rules (2022-09-22, cross-service rules).

## 3. Repository layout (pnpm workspace)

```
/                      repo root = this folder, remote github.com/halfklrrex/atrium
├─ apps/web/           Vite + React + TypeScript SPA (@vibe/core UI)
├─ functions/          Cloud Functions (TypeScript, bundled with esbuild/tsup)
├─ packages/shared/    Types, zod schemas, column-type registry (pure TS, no React/Firebase SDK)
├─ firestore.rules · firestore.indexes.json · storage.rules
├─ tests/rules/        Rules unit tests (@firebase/rules-unit-testing + Vitest, run against emulator)
├─ firebase.json · .firebaserc (default: atrium-board)
├─ docs/               architecture.md and per-epic specs (docs/specs/<phase>-<slug>.md)
└─ .github/workflows/  CI
```

**Functions + pnpm workspace gotcha:** Cloud Build cannot resolve `workspace:*` dependencies. `functions` must be bundled (esbuild/tsup) so `@atrium/shared` is inlined into `functions/lib`, and the deployed `package.json` must list only real npm dependencies.

## 4. Frontend

- **React 18 or 19:** use whichever `@vibe/core`'s peer dependencies support (check before installing).
- **UI:** `@vibe/core` components + `@vibe/icons`; Vibe's ThemeProvider with light / dark / black themes. Font: Figtree (Google Fonts). Never use monday's logo, name or marketing art. Atrium has its own wordmark.
- **Routing:** React Router (library mode). Routes: `/login`, `/` (redirects to last workspace), `/workspaces/:workspaceId`, `/boards/:boardId`, `/boards/:boardId/views/:viewId[/items/:itemId]` (P3; `/boards/:boardId` opens the last view used, `atrium.lastView.<boardId>` in localStorage).
- **Data access:** thin hooks over `onSnapshot` (`useWorkspaces`, `useBoard`, `useItems`) in `apps/web/src/data/`. All Firestore paths and converters live in one module so components never build paths by hand.
- **UI state:** Zustand for local UI state (selection, open item card, sidebar). No Redux.
- **Large lists:** `@tanstack/react-virtual` for the board table. **Drag & drop:** `@dnd-kit`.
- **Ordering:** `fractional-indexing` string keys (`position`) for groups, items and columns, so a reorder writes only one document.
- **Emoji font:** every emoji is drawn by a self-hosted colour font, `Atrium Emoji` (`apps/web/public/fonts/atrium-emoji.woff2`, a COLRv0 font built from the Twemoji graphics; script and pins in `scripts/emoji-font/`), so an emoji looks the same on Windows, Mac and phones, including inside inputs and the TipTap editors. `apps/web/src/theme/emoji-tokens.css` declares the `@font-face` (limited by `unicode-range`, so it is only fetched once a page contains an emoji, `font-display: swap`) and puts `'Atrium Emoji'` first in Vibe's `--font-family` and `--title-font-family` (Vibe sets both once, on `:root`). **No third-party request is made for emoji** (the earlier jsDelivr flag pictures and the canvas detection are gone). Known differences: keycap emoji stay native (their base characters are plain digits, which must stay in the text font), and symbols that are text by default but have an emoji form (heart, check mark, play triangle) render in colour. Evidence and limits: `docs/plans/2026-11-07-twemoji-font-spike.md`. Credit: `docs/PROVENANCE.md`.
- **Firebase init:** `apps/web/src/lib/firebase.ts` uses the committed public config. When `VITE_USE_EMULATORS=true` (default in `pnpm dev`) it connects Auth, Firestore, Functions and Storage to the local emulators.

## 5. Data model (Firestore)

Timestamps use server time. Every user-editable document carries `createdAt`, `createdBy`, `updatedAt`.

### 5.1 `users/{uid}`
`displayName, email, photoURL, timezone, locale, lastWorkspaceId, theme ('light'|'dark'|'black'|'system'), createdAt`
Readable by any signed-in user who shares a workspace with this user (P4; in P0 readable by self only), writable by self (restricted fields).

### 5.2 `workspaces/{workspaceId}`
```
name, description, icon (emoji or letter), color,
ownerId,
memberIds: string[]                       // for array-contains queries + rules
roles: { [uid]: 'owner'|'admin'|'member'|'viewer' }
kind: 'open'|'closed'                     // monday parity; closed = invite-only even within account
createdAt, createdBy, updatedAt
```
Query "my workspaces": `where('memberIds','array-contains',uid)`.
Invariant: `memberIds` equals `keys(roles)`. Clients may **create** a workspace only with themselves as sole owner. Membership changes go through callable functions (P4a, below) to keep the invariant.

### 5.2a `workspaces/{workspaceId}/members/{uid}` and `.../invites/{inviteId}` (P4a)
```
members/{uid}:  displayName, photoURL|null, email, role (display copy), joinedAt, updatedAt
invites/{id}:   email (lowercased), role 'admin'|'member'|'viewer', invitedBy, invitedByName,
                workspaceName, createdAt, expiresAt (+14 days), status 'pending'|'accepted'|'declined'|'revoked'
```
- **Member profiles are denormalised** so every member sees the others' names and photos while `users/{uid}` stays self-only. Functions only write them (rules: read for any member, write `false`). The authoritative role stays in `workspace.roles`; `members.role` is a display copy.
- **Who writes them:** `bootstrapUser` (the owner's doc on a new workspace, and a refresh of the caller's name, photo and email on up to 20 of their workspaces, which also creates a missing doc for workspaces created in the browser), `createInvite` (heals the inviter's own doc), `acceptInvite`, `changeMemberRole`, `removeMember` / `leaveWorkspace`. Run `scripts/backfill-members.mjs` once for workspaces that existed before P4a.
- **Invites** are accepted by **verified** Google email, compared lowercased. Only Functions write them; owners and admins read them. No email is sent: the inviter copies the link `/invite/{workspaceId}/{inviteId}`, which never grants access by itself. Invitees use the `listMyInvites` and `getInviteStatus` callables (a collection-group query on `invites`, indexed by `email` + `status`).
- **Callables** (`functions/src/callable/`, logic in `functions/src/lib/membership.ts`): `createInvite`, `revokeInvite`, `listMyInvites`, `getInviteStatus`, `acceptInvite`, `declineInvite`, `changeMemberRole` (also ownership transfer), `removeMember`, `leaveWorkspace`. Each runs in a transaction that changes `roles`, `memberIds` and the member docs together. Removal then strips the uid from `access` / `accessUids` on the workspace's boards in follow-up batches (housekeeping: rules already deny a removed member through `isWsMember`).
- **Web:** `useWorkspaceMembers(wsId)` (one cached listener per open workspace) and `useUserLookup(wsId?)` (`uid -> {name, photoURL}`, defaulting to the workspace the shell shows) feed avatars, people cells, filters and group-by. The Members dialog (`components/membership/`) and the `/invite/:workspaceId/:inviteId` page call the callables.

### 5.3 `workspaces/{workspaceId}/folders/{folderId}`
`name, parentFolderId|null, color, position`

### 5.4 `boards/{boardId}` (top-level collection)
```
workspaceId, folderId|null,
name, description,
kind: 'main'|'private'|'shareable'        // main = all workspace members
access: { [uid]: 'owner'|'editor'|'viewer' }  // explicit board members (required for private/shareable, owners for main)
accessUids: string[]                       // always equals keys(access); rule-enforced; lets private boards be listed
position: string                           // fractional index within its folder (or the workspace root)
icon: string|null                          // reserved, null for now
columns: ColumnDef[]                       // ordered by position
subitemColumns: ColumnDef[]
groups: GroupDef[]                         // { id, title, color, position, collapsed? }
itemTerminology: string                    // "item", "task", ...
derivedColumnIds: string[]                 // ids of derived columns (columns + subitemColumns). Written ONLY by the onBoardColumnsWritten function; clients create boards with [] and can never change it. Older boards may lack it (reads as [])
serverManagedColumnIds: string[]           // FW2: ids of server-managed columns (time tracking, files, buttons), written only by Cloud Functions. Same rules and same writer as derivedColumnIds
state: 'active'|'archived'|'deleted', deletedAt|null
createdAt, createdBy, updatedAt
updatedBy?: uid                            // P4: who made the last client edit. Rules force `== uid()` on every client update (optional on create); the setBoardAccess / setBoardKind / leaveBoard / changeColumnType / revertColumnType callables set it too. The activity trigger attributes board changes to it (`updatedBy ?? createdBy`). Absent on older boards
```
Listing boards of a workspace runs two queries and merges them by id: `kind == 'main'`, and `accessUids array-contains me` (both with `workspaceId == X`; explicit access only counts while the user is still a workspace member).
`ColumnDef = { id, type, title, description?, width?, position, settings }`. Column ids are short random slugs, stable forever.
Columns and groups live inside the board document. They're small, change together, and one listener delivers the whole board structure. A board must stay well under 1 MB, which is fine for hundreds of columns and groups.

### 5.5 `boards/{boardId}/items/{itemId}`
```
name, groupId, position,
parentItemId: string|null                  // non-null ⇒ subitem (uses board.subitemColumns)
values: { [columnId]: ColumnValue }        // monday-compatible JSON per column type
state: 'active'|'archived'|'deleted', deletedAt|null
createdAt, createdBy, updatedAt, updatedBy
seq?: int                                  // account-wide item number (1, 2, 3, ...; never reused). Server-assigned by onItemCreated; clients can't write it. Drives the Item ID column
boardSeq?: int                             // per-board creation number (subitems have their own sequence). Server-assigned; drives the Auto number column
assigneeUids?: string[]                    // sorted unique uids of the `person` entries across the board's People columns (subitemColumns for subitems). Server-maintained index for My Work; clients can't write it
nameTokens?: string[]                      // search tokens of `name` (decision 4 below). Server-maintained; clients can't write it
description?: { doc, text } | null         // rich-text description (ProseMirror JSON plus capped plain text for search)
descriptionImages?: { [fileId]: { name, size, mimeType, uploadedAt, uploadedBy } }   // images used in the description. Functions-only
```
`seq` and `boardSeq` are absent until the `onItemCreated` function has run (about a second), and the cells stay empty meanwhile. They come from two Functions-only counter documents: `counters/items` (`{ next }`, one for the whole project, so ids stay unique when a board moves between workspaces) and `boards/{boardId}/counters/items` (`{ nextItem, nextSubitem }`). Despite the names each field holds the last number handed out, so an absent counter reads as 0. Firestore rules deny every client read and write of both counters, and refuse `seq` / `boardSeq` on item create and update (they are in neither editable key list). Duplicating items never copies them: the copy is a new document and gets new numbers. Details: `docs/specs/P2-numeric-item-ids.md`.

**Description images (P1 editor pass 2).** The description doc stores an image as `{ type: 'image', attrs: { fileId, alt, width } }`, never a URL. The files column pipeline is column-bound, so images have a parallel, description-scoped path that reuses the `lib/file-storage.ts` helpers (board access check, bucket adapter, signed URLs):

- Storage objects live at `boards/{b}/items/{i}/description/{fileId}` (PNG, JPEG, GIF or WebP, at most 10 MB, at most 50 per item). `storage.rules` still denies every client access, and Storage rules can't read Firestore, so all access goes through three callables with signed URLs.
- `requestDescriptionImageUpload({ boardId, itemId, fileName, contentType, size })`: board editors only, active item. Returns a signed PUT URL (10 minutes, size capped by the signed `x-goog-content-length-range` header).
- `finalizeDescriptionImage({ boardId, itemId, fileId, fileName })`: reads the object's real size and type from Storage, deletes it on rejection (after the transaction), and otherwise sets `descriptionImages.<fileId>` with a field path (Admin SDK, in the transaction).
- `getDescriptionImageUrl({ boardId, itemId, fileId })`: board readers only, and only for a fileId listed in `descriptionImages`. Returns a signed GET URL valid for 1 hour. The web app caches it per fileId until about 5 minutes before expiry and refreshes once on an `<img>` error.
- `descriptionImages` is in neither editable key list of the item rules, so clients can't create, change or remove it (rules tests in `tests/rules/src/description-images.test.ts`).
- `purgeOrphanUploads` also sweeps `.../description/{fileId}` objects older than an hour that are not in `descriptionImages` (uploads that were never finalized).
- **Known limit:** an image deleted from the doc stays in Storage and in `descriptionImages` until a later cleanup pass; nothing removes it yet. The cap of 50 counts those leftovers.

**Update attachments (P4).** Updates and replies carry an optional `attachments: Attachment[]` (at most 10, the Files column's attachment shape, `packages/shared/src/schemas/update-attachments.ts`). Spec: `docs/specs/P4-update-attachments.md`.

- **Server-managed:** `attachments` is in neither the create nor the update key list of the `updates` and `replies` rules, so no client can write, change or remove it; only the finalize callable (Admin SDK, in a transaction) does. A client-created post starts without it. `ItemUpdateWrite` and `UpdateReplyWrite` omit it. Rules tests: `tests/rules/src/update-attachments.test.ts`.
- **Layout:** `boards/{b}/items/{i}/updates/{u}/{fileId}` and, for a reply, `boards/{b}/items/{i}/updates/{u}/replies/{r}/{fileId}`. At most 25 MB per file, the Files column's `isFileAllowed` with no type list. `storage.rules` still deny every client access.
- **Flow:** the post exists first (the client writes it as today), then `requestUpdateAttachmentUpload` (the post's author only, with edit access, active item, fewer than 10 files; signed PUT URL, 10 minutes, `x-goog-content-length-range`), the browser PUTs the file, then `finalizeUpdateAttachment` (author only; reads the object's real size, type and created time; appends in one transaction; a repeat for a listed fileId is a no-op; a rejected object is deleted after the transaction). `getUpdateAttachmentUrl` (any board reader, only for a listed fileId; 5 minute signed GET with `Content-Disposition` from the stored name) and `deleteUpdateAttachment` (the author or a board owner; the object is deleted after the commit). Logic in `functions/src/lib/update-attachments.ts` with injected stores.
- **Cleanup:** there is no trigger on update or reply deletion (client deletes don't cascade, and a deleted update leaves its replies behind). `purgeOrphanUploads` (daily, 03:00 UTC) deletes `updates/**` objects older than an hour unless the update or reply document lists the fileId; a reply under a deleted update counts as unreferenced. `purgeTrash` deletes the Storage prefix `boards/{b}/items/{i}/` (files, description images and update attachments) and recursively deletes the item's documents (updates and replies) when it purges an item, and `boards/{b}/` when it purges a board.

**Item index fields (P3 My Work and global search).** Firestore cannot find "items assigned to me" from `values.<colId>.personsAndTeams[]` (column ids differ per board and the uid is nested in an array of maps), nor search names. So the `onItemPeopleAssigned` trigger (name kept to avoid a delete and recreate on deploy) maintains two flat arrays on every item through the Admin SDK, as metadata: no `updatedAt` / `updatedBy`. Spec: `docs/specs/P3-my-work-global-search.md`.

- **`assigneeUids`**: sorted unique uids of the `kind: 'person'` entries across the board's People columns (`subitemColumns` for subitems). **`nameTokens`**: lowercase, diacritics stripped (NFKD), split on anything that is not a letter or digit, every prefix of each word from 2 to 15 characters, unique, at most 100. The pure functions are in `packages/shared/src/item-index.ts` (`assigneeUidsOf`, `nameTokensOf`, `searchWordsOf`, `itemIndexFields`, `ITEM_INDEX_LIMITS`).
- **Server-managed, not derived:** the fields are real stored values written only by Functions. They are in neither item key list of `firestore.rules`, so clients can't create, change or remove them (no rules change; `tests/rules/src/item-index.test.ts`). Duplicating items never copies them: new items are built from explicit keys. They read as `[]` while absent.
- **Maintenance** (`syncItemIndexFields`, `functions/src/lib/item-index.ts`): returns early unless `name` or `values` changed or a field is missing; reads the board only when `values` changed (or `assigneeUids` is missing), sharing that single read with the assigned notifications (`withSharedBoardRead`); writes both fields with one `update` only when either differs, with a `lastUpdateTime` precondition so a late event can't overwrite the index of a newer write (that write has its own event). Its own write retriggers the function and finds nothing to do. Deleted items are skipped (restoring one heals it).
- **Index hint, not authority:** the web recomputes `assigneeUids` from the item's values and the board's current columns and drops rows that no longer match. A deleted People column leaves a stale hint until the item's next write.
- **Queries (decisions 2 and 4):** My Work runs `boards/{b}/items where assigneeUids array-contains me and state == 'active'` on each board the user can list; search runs `where nameTokens array-contains <longest word of the term> and state == 'active'` per board. Both are per-board queries, authorised by the existing `canReadBoard` rule, so private boards, removed members and lost shares are enforced by the rules as on the board page. There is deliberately **no collection-group `items` rule**: a rule can't prove board access for every result. Two composite indexes in `firestore.indexes.json` (`assigneeUids` CONTAINS + `state`, `nameTokens` CONTAINS + `state`, `COLLECTION` scope) build for a few minutes after deploy; the web PRs that query them merge after they are `READY` (`gcloud firestore indexes composite list --database=atrium-1`).
- **Rejected:** a client-written field (rules can't verify a union over dynamic column ids); a `users/{uid}/assignments` fan-out (copies of item data that outlive a lost board access); a function that scans items per search; an external search service.
- **Migration:** `scripts/migrations/2026-11-backfill-item-index.mjs` fills existing items (dry run unless `--apply`; `pnpm exec tsx scripts/migrations/2026-11-backfill-item-index.mjs --project atrium-board` to preview, then with `--apply`; without `--project` it targets the emulator). It commits batches of 400 with an `updateTime` precondition per item, writes only items whose fields differ and never touches `updatedAt`, so it is idempotent and safe to run while the function is live.

Loading a board means one listener on `items where state == 'active'`, which is fine to several thousand items. Paging and virtualisation come later.

### 5.6 Later subcollections (shape reserved, built in later phases)
- `boards/{boardId}/items/{itemId}/updates/{updateId}`: rich-text updates, replies via `parentUpdateId` (P1)
  - **`contentDoc` (P1d).** An update and a reply (`.../updates/{updateId}/replies/{replyId}`) keep `content` (50000 characters max) as the plain-text mirror and may also carry `contentDoc`, the ProseMirror JSON document (`{ type: 'doc', content: [...] }`) written by the editor. Posts without it stay valid and render as plain text; there is no migration. The mirror is derived from the doc and is never empty when `contentDoc` is set, so snippets, the activity log and the MCP connector keep reading `content`. Rules: create may include `contentDoc` (a map whose `type` is `'doc'`; its size is bounded by the shared schema, `UPDATE_CONTENT_DOC_MAX_BYTES`, and the 1 MiB document limit); a content edit by the author or a board manager changes `content` and `contentDoc` together or neither (it may drop `contentDoc` while setting plain `content`). **Mentions** come from the document: `notifyUpdateMentions` and `notifyReply` use `mentionedUidsOf(contentDoc)` when it is present and ignore the client-sent `mentions` array (which the rules still bound to 20 unique ids); without `contentDoc` they use the array as before. Spec: `docs/specs/P1d-update-composer-rich-text.md`.
- `boards/{boardId}/views/{viewId}`: `name, type (table|kanban|calendar|timeline), position, ownerId|null (null = shared view, a uid = personal), settings {filter, hiddenColumnIds, kanban?, calendar?, timeline?}, createdAt/By, updatedAt/By` (P3). `main` is the fixed Main table view, created lazily on its first save. `ownerId` and `type` never change ("make personal/shared" writes a copy and deletes the original). The client lists views with two queries (`ownerId == null` and `ownerId == uid`) because the rules engine refuses `ownerId in [null, uid]`. Details: `docs/specs/P3-saved-views.md`.
- `boards/{boardId}/activity/{id}`: the audit log (P4, `docs/specs/P4-activity-audit-log.md`). Append-only, written only by Cloud Functions; **board readers read it** (`allow read: if signedIn() && canReadBoard(boardId)`, so private boards stay private; owner, editor and viewer alike), clients never write (`allow write: if false`, explicit, FW2). Shape (`activityEventSchema` in `packages/shared/src/schemas/activity.ts`):
  ```
  kind, createdAt (server ts), expiresAt (createdAt + 90 days, Firestore TTL),
  actorId, actorName, actorPhotoUrl|null          // from workspaces/{ws}/members/{uid}; "Someone" if missing
  itemId|null, itemName|null, parentItemId|null   // names as they were at the time (denormalised)
  columnId|null, columnTitle|null, columnType|null, groupId|null, groupTitle|null
  data: { fromText?, toText? (<= 200 chars; People as member names, "+n"), fromValue?, toValue? (raw, only when <= 2 KB),
          fromRole?, toRole?, targetUid?, targetName?, fromKind?, toKind?, snippet?, more?, fromGroupId?, fromGroupTitle?, columnColor? }
  ```
  Kinds: `item_created`, `item_renamed`, `item_moved`, `item_archived`, `item_deleted`, `item_restored`, `value_changed`, `column_added`, `column_renamed`, `column_deleted`, `column_type_changed`, `column_type_reverted`, `group_added`, `group_renamed`, `group_deleted`, `board_renamed`, `board_kind_changed`, `board_access_changed`, `board_left`, `update_posted`, `button_clicked`. Not logged: description edits, replies, reactions, positions, `seq` / `boardSeq` / `descriptionImages` / `updatesCount`, derived columns, view changes, presence.
  - **Who writes what.** A change made by a callable is logged inside that callable's transaction (`setBoardAccess` -> one `board_access_changed` per call, `setBoardKind`, `leaveBoard`, `changeColumnType` and `revertColumnType` in the finishing board transaction, `clickButton`). A change made by a client write is logged by a trigger that diffs before and after: `onItemWrittenActivity` (items) and `onBoardWrittenActivity` (board `name`, and the id sets and titles of `columns` and `groups`), and `onUpdateCreated` adds `update_posted` (top-level updates, 120-character snippet). The board trigger ignores column `type` / `settings` / `migrating` / `lastTypeChange`, `kind`, `access`, `accessUids`, `derivedColumnIds` and `serverManagedColumnIds`, so nothing is logged twice and `onBoardColumnsWritten`'s own write logs nothing.
  - **Only user edits count.** The item trigger logs an update only when `updatedAt` moved (client writes and the time-tracking and files callables always bump it). The type-change migration writes `values.<id>` without it, and `onItemCreated` writes `seq`, so a conversion of thousands of cells does not flood the log.
  - **No loops, bounded amplification.** The activity triggers never write the item or the board, and writes to the `activity` subcollection fire no trigger on `boards/{id}` or `items/{id}`. One write produces at most 20 entries (the 20th is a summary `value_changed` with `data.more = n`). The entries of one trigger event get the deterministic ids `${event.id}-${n}` and are created in one batch, so a retried event writes nothing twice (`ALREADY_EXISTS` is ignored). The triggers set `retry: true`.
  - **Retention.** 90 days by a Firestore TTL policy on `expiresAt` (`fieldOverrides` in `firestore.indexes.json`, like presence); deletion lags up to about a day, so the web hides entries past `expiresAt`. Legacy pre-P4 `button_clicked` docs have no `expiresAt` and are removed once by `scripts/migrations/2026-11-delete-legacy-activity.mjs` (dry run unless `--apply`).
  - **Indexes.** Composites on `activity` (`COLLECTION`): `itemId asc, createdAt desc`; `actorId asc, createdAt desc`; `columnId asc, createdAt desc`. Person plus column together relies on index merging; if production names a missing composite, add it then.
- `boards/{boardId}/columnSnapshots/{snapshotId}` (+ `chunks/{n}`): the backup of a column type change (old column def and every old value), Functions-only (`changeColumnType`, `revertColumnType`, the daily purge); rules deny every client read and write. Expires after 30 days. Details: `docs/specs/P2-change-column-type.md`
- `boards/{boardId}/automations/{id}` (P5) · `docs/{id}` (P7)
- `dashboards/{dashboardId}` (P6): a page of widgets (numbers, battery, chart, table, workload) that read live from up to 50 boards and store no item data. Same access model as boards (`kind`, `access`, `accessUids`); owners trash and restore it with direct writes the rules allow; `kind`, `access` and `accessUids` are written only by the `setDashboardAccess` callable (workspace membership and role cap checked on the server, as `setBoardAccess` does for boards), and the rules refuse client writes of those fields. Spec: `docs/specs/P6-dashboards.md`.
- `users/{uid}/notifications/{id}` (P4) · workspace `invites` and `members`: see 5.2a (P4a)
- `boards/{boardId}/automations/{id}`, `automationRuns/{automationId}-{eventId}` and `counters/automations` (P5a, `docs/specs/P5a-automations-backend.md`): recipes (written by board owners; `enabled`, `disabledReason` and the server-written `consecutiveFailures`), the run history (Functions-only, board owners read, 30-day TTL on `expiresAt`) and the hourly run counter `{ hourBucket, runs }` (Functions-only, 100 runs per hour per board). **Loop marker:** an automation's item write sets `updatedVia: 'automation:<id>'`, `automationDepth` (the chain depth, at most 3) and `automationRunId`; `onItemWrittenActivity` credits a write to the automation only when `automationRunId` changed, stamping `data.depth` on its entries, so a human edit afterwards is logged as the human. A recipe never reacts to its own writes, and an event at depth 3 only records a `skipped` "loop limit" run. Clients cannot write any marker field.

## 6. Column-type registry (`packages/shared/src/columns/`)

Each column type is one module exporting:
```ts
interface ColumnType<Settings, Value> {
  type: string;                    // 'text' | 'status' | 'people' | 'date' | ...
  settingsSchema: ZodType<Settings>;
  valueSchema: ZodType<Value>;     // monday column-value JSON shape
  defaultSettings(): Settings;
  toText(value, settings): string; // search, CSV, API "text" field
  compare(a, b, settings): number; // sorting
  summaries?: SummaryKind[];       // group footer aggregations
  aggregate?(values, settings): AggregateResult | null; // the footer summary itself (P1b)
  derived?: boolean;               // value is computed, never stored (see 6.2)
  serverManaged?: boolean;         // only Cloud Functions write the cell: time tracking, files, buttons (see 6.2)
  compute?(ctx: ColumnContext, settings): Value | null; // derived types: the display value
  validateValue?(value, settings, ctx?): ValidationResult; // settings-dependent rules beyond valueSchema
}
```
`aggregate` returns plain data (`distribution` for status, `sum` for numbers, `range` for dates, `ratio` for checkboxes), so the web app decides how to draw it and Functions can reuse it. `columnRegistry.aggregate(type, rawValues, settings)` validates each cell first and counts invalid ones as empty.

The web app registers a renderer and editor per type separately (`apps/web/src/columns/`). Functions reuse the shared module for validation, formulas and the API. All nine core types ship (P1b); the web half is described next.

### 6.1 Web half: cells and editors (`apps/web/src/columns/`)

Every column type has a second, web-only module that says how it is drawn and edited in the board table. It registers itself in `columns/registry.ts`:
```ts
interface ColumnUi<Value, Settings> {
  type: string;                    // same slug as the shared ColumnType
  icon: SubIcon; tone: TileTone;   // tile in the "+" add-column picker
  editor: 'inline' | 'popover' | 'toggle' | 'none';
  Cell: ComponentType<CellProps>;       // display; keep it light: boards render thousands
  Editor?: ComponentType<EditorProps>;  // inline: replaces the cell; popover: opens under it
  toggle?(current): Value | null;       // 'toggle' types (checkbox): what a click produces
}
```
- `CellProps` carries the validated `value` (`null` when empty), the validated `settings`, the column def, a `CellContext` (search term to highlight, whether the row's first status is "done", whether the viewer can edit) and `onChange(value | null)`. `null` clears the cell (the table then deletes `values.<columnId>`).
- `EditorProps` adds `onClose`, the cell `anchor` element (popovers use the shared `AnchoredPopup`: a portal panel that follows the cell) and `saveSettings(settings)`, which replaces the column's settings (status and dropdown labels) in a transaction.
- To add a column type: write the shared `ColumnType`, then `columns/<type>.tsx` with `defineColumnUi({...})`, then add it to the list in `columns/registry.ts` (and to `ADD_COLUMN_ORDER` to offer it in the picker). The table itself needs no change.
- Only one editor is open at a time (`useTableStore().editing`); viewers never open one.

Cell edits are field-path writes (`values.<columnId>`) with `updatedAt` and `updatedBy`, applied optimistically by the Firestore cache and rolled back with an error toast when the server refuses. Board `columns` and `groups` are replaced inside a transaction (`updateBoardStructure`) so two people changing different columns cannot overwrite each other.

### 6.2 Derived and server-managed columns, and cell validation (FW1, FW2)

Decisions (2026-10-24): derived column types **store no value** (their value is computed from item metadata or other cells), **clients can't write them, enforced by Firestore rules**, and every type may add a `validateValue` hook. One canonical, monday-compatible value shape per type still applies.

```ts
interface ColumnContext {
  boardId: string;
  item: { id; values; createdAt?; createdBy?; updatedAt?; updatedBy?; groupId?; seq?; boardSeq? }; // plain data the client already holds
  columns: readonly ColumnDef[];  // every column def of the board, for cross-column derivations
}
type ValidationResult = { ok: true } | { ok: false; message: string };
```

- **`derived: true`** marks a type whose value is computed (formula, mirror, progress, item ID, auto number, creation log, last updated). Item ID and auto number are derived from the server-assigned `item.seq` and `item.boardSeq` (section 5.5): `item_id` computes `String(seq)` (the custom key prefix is applied at display time by `formatItemId`, so sorting stays numeric) and `auto_number` computes `{ auto_number: boardSeq }`; both are `null` until the numbers exist, and any stored `values.<id>` is ignored. It **requires `compute(ctx, settings)`**, which must be pure and fast. `registry.register` throws otherwise.
- **`validateValue(value, settings, ctx?)`** is optional and pure: rules beyond `valueSchema` that need the settings (for example rating <= limit). It runs only for non-empty values that already passed the schema.
- **Registry helpers:** `isDerived(type)`, `computeValue(def, ctx)` (null for unknown or non-derived types and for invalid settings), `validateCell(def, value, ctx?)` and `derivedColumnIds(columns)`. `validateCell` is the one gate for writes: it **rejects every value for a derived type, `null` included**, with "This column is calculated automatically"; otherwise it runs `valueSchema` and then `validateValue`. Empty cells are valid. Unknown types are refused with a message instead of throwing.
- **Client:** `tableActions.setCell` calls `validateCell` first and shows a refusal in an error toast without writing. Derived cells render `computeValue(...)` read-only (no editor, no toggle, Delete does nothing). New items, duplicated items and new boards never carry derived values. A future CSV or paste path must call `validateCell` per cell too.
- **Server enforcement:** `boards/{id}.derivedColumnIds` lists the derived column ids of `columns` and `subitemColumns` (sub-items share the `items` collection). The `onBoardColumnsWritten` Cloud Function (`onDocumentWritten` on `boards/{boardId}` with `database: FIRESTORE_DATABASE_ID`, function region `europe-west1`, trigger on the `eur3` database) recomputes it with the shared registry (`nextDerivedColumnIds` in `@atrium/shared`) and writes it back only when the sorted list changed, inside a transaction on the current document, so it is idempotent and its own write doesn't loop. The rules:
  - board **create** must carry `derivedColumnIds == []`;
  - board **update** can never change `derivedColumnIds` (it isn't in the editable key list);
  - item **create** may not contain any key of `derivedColumnIds` in `values`;
  - item **update** may not add, change or remove any such key (`values.diff(...)`); a stale stored value that is left alone doesn't block other edits;
  - a board without the field (created before FW1) reads as `[]`.
- **Known limits:** (1) the function lags a column change by a moment, so right after someone adds a derived column a client could still store a value in it; it's never displayed (the computed value is shown) and gets blocked as soon as the function has run. (2) A type becoming derived later (for example converting #13's computed types) doesn't update boards by itself, because the function only reacts to board writes: re-run the backfill. (3) ~~Search, sort and footer summaries read `values.<id>`~~ (fixed for every derived type with the numeric item IDs work): search, filter conditions and sort in `packages/shared/src/filters/engine.ts`, the table's search text and the group footer all go through `computeValue` for derived columns. Grouping by a derived column still reads the stored value.
- **Mirror columns (async derived):** `mirror` is `derived: true` (so clients can never write it and `derivedColumnIds` lists it), but its `compute()` returns `null`: the value needs the linked items' values, which live on other boards and are read asynchronously. The web cell computes it with `useMirrorValue` (`apps/web/src/columns/mirror.tsx`), which reads the linked items in full and the target boards' columns through the session cache in `columns/board-relation.tsx` and calls `computeMirror`. **Live-update limits (v1):** linked items are read once per session; a Mirror cell that mounts again (navigating back to the board) re-reads items older than 60 seconds; there are no per-item listeners, because a board full of Mirror cells would open one listener per linked item. So an edit on the linked board shows in the Mirror after a re-mount, not instantly. Because the stored value is empty, search, filter, sort, group-by and footer summaries see nothing for a Mirror, and the sort, filter and group-by menus leave it out.
- **Migration:** `scripts/migrations/2026-10-backfill-derived-column-ids.mjs` sets the field on existing boards. It is idempotent and a dry run unless `--apply` is given: `pnpm exec tsx scripts/migrations/2026-10-backfill-derived-column-ids.mjs --project atrium-board` to preview, then the same with `--apply`. Authenticates with `gcloud auth print-access-token` (run `gcloud auth login` first); without `--project` it targets the emulator.
- **Deploy:** the first Firestore-triggered function needs Eventarc project setup by the owner before the merge. See `docs/DEPLOY.md`, "Roles to add later".

#### Server-managed columns (FW2)

Decision (2026-10-25): some column types are written **only by Cloud Functions**, through the Admin SDK, which bypasses rules: **`time_tracking`** (start and stop through a callable that stamps server time and uid), **`files`** (upload and delete through callables that write trusted metadata) and **`button`** (no stored value; a click appends to `boards/{id}/activity` through a callable). Without enforcement a board editor could write those `values.<colId>` cells directly and the callables' guarantees would be advisory. FW2 closes the gap with the same mechanism as `derivedColumnIds`.

- **`serverManaged: true`** on a `ColumnType` marks such a type. Unlike `derived` it stores a value and clients still read it, but they can never write it. Registry helpers: `isServerManaged(type)` and `serverManagedColumnIds(columns)`. `validateCell` rejects every value for a server-managed type, `null` included, with "This column is updated by Atrium automatically" (derived types keep "This column is calculated automatically"). Server-managed and derived types also can't carry a column `defaultValue`.
- **Server enforcement:** `boards/{id}.serverManagedColumnIds` is maintained by the **same** `onBoardColumnsWritten` function as `derivedColumnIds`. It computes both lists with `nextColumnIdLists` in `@atrium/shared` (columns plus `subitemColumns`, sorted), and writes both fields in one transaction on the current document only when either one differs, so it stays idempotent and its own write doesn't loop. The rules:
  - board **create** must carry `serverManagedColumnIds == []`;
  - board **update** can never change `serverManagedColumnIds` (not in the editable key list);
  - item **create** and **update** refuse any key of `derivedColumnIds` **or** `serverManagedColumnIds` in `values` (`blockedColumnIds()`, one board `get()` per evaluation, the one `canEditBoard()` already did); a stale or server-written value that is left alone doesn't block other edits;
  - a board without the field reads as `[]`;
  - `boards/{id}/activity/**` has an explicit `allow write: if false` match: only Functions write it (section 5.6; board readers read it since P4).
- **Client:** server-managed cells never open the generic editor (no click, Enter or Delete writes) and show a "Managed by Atrium" tooltip. They render their stored value read-only until the callables (#34 time tracking and buttons, #35 files) provide real controls. `item-writes` refuses them through `validateCell`, duplicated items and groups start with those cells empty, and deleting or duplicating such a column doesn't try to clean up or copy cells (the rules would refuse it; leftover values are invisible without the column).
- **Button actions (2026-11-03):** `button.settings.actions` holds 0 to 5 plain-data steps (`set_value`, `rename_item`, `move_to_group`, `archive_item`, and `notify`, which sends a `button` notification to up to 10 people after the commit, with a 2-second repeat guard on the same button and item). `clickButton` validates them all with `validateButtonActions` (target columns writable and not locked for the clicker, groups exist, values pass `columnRegistry.validateCell`), merges them in order into one field-path patch and writes it with the `button_clicked` entry in the same transaction (all or nothing; refusals are `failed-precondition` naming the action). The click's changes are logged by the item activity trigger with the clicker as actor. `move_to_group` changes `groupId` only: the item keeps its position key (the end-of-group key needs `fractional-indexing`, a web-only dependency). The action shape is reusable by P5 automations.
- **Forms (P7, backend):** a `form` view type with `settings.form` (`docs/specs/P7-forms.md`). The `getForm` and `submitForm` callables (logic in `functions/src/lib/forms.ts`) serve any signed-in user through the Admin SDK, so a visitor needs no board access. `submitForm` rate-limits in its transaction (10 per person and 200 per form per hour, counter docs `boards/{id}/counters/form_<viewId>_<hour>[_<uid>]` with `expiresAt`), validates through `columnRegistry.validateCell`, and creates the item with `createdBy` = submitter and `updatedVia: 'form'`; `onItemCreated` numbers it and `onItemWrittenActivity` logs `item_created` with `data.source: 'form'`. No rule grants anything to an item's `createdBy`.
- **Which types are flagged:** `button` is flagged on main. **The PR that adds each of the other modules must set `serverManaged: true` on it** (or rebase on FW2 and add it): `time_tracking` (#24, owned by #34) and `files` (#26, owned by #35). Until then those boards' cells are only advisory-protected. After a type becomes server-managed, re-run the backfill (the function only reacts to board writes).
- **Known limits:** the same moment of lag as derived columns after someone adds such a column, and the backfill must be re-run when a type becomes server-managed.
- **Migration:** the same script as FW1 backfills both fields (dry run unless `--apply`): `pnpm exec tsx scripts/migrations/2026-10-backfill-derived-column-ids.mjs --project atrium-board`, then again with `--apply`. Boards that already hold `button` columns need `serverManagedColumnIds` set before the rules protect them.

#### Required columns as a hard rule (REQ)

Spec: `docs/specs/REQ-required-columns-hard-rule.md`. `boards.requiredColumnIds` is maintained by `onBoardColumnsWritten` (REQ-1), and Firestore rules refuse emptying a required `values.<id>` (cap `REQUIRED_COLUMN_RULE_CAP`). Rule 2 (a Status moved into a done label while another required cell is empty) can't live in rules, so it is enforced in two places (REQ-2):

- **`onItemRequiredRevert`** (`onDocumentUpdated` on `boards/{boardId}/items/{itemId}`): when a write moved a Status into a label with `isDone` and any other required cell is empty (`findRequiredViolation` in `@atrium/shared`, using `isColumnValueEmpty`), it restores the previous Status value in a transaction, **only if the cell still holds what was just written**, and appends a `required_reverted` activity entry (actor "Atrium"). The revert is **eventual, not atomic**: the item shows Done for a moment, and the original write's own `value_changed` entry still exists. It writes only `values.<id>` (no `updatedAt`), and its own event is a move out of done, so it can't loop. Items already Done are never reverted for unrelated edits; boards without `requiredColumnIds` are never touched; creates are exempt.
- **Server-side writers:** button actions and automations (`runActionsInTransaction`) judge their `set_value` patch with the same helper and fail the run with a `failed-precondition` message, writing nothing. Forms already refuse empty required answers. No MCP connector exists in this repository yet; when one does, it writes through rules like any client, so rule 1 applies and rule 2 is caught by the revert trigger.

## 7. Security model

Helper functions in `firestore.rules`:
- `signedIn()`, `uid()`
- `wsRole(wsId)`: `get(/workspaces/$(wsId)).data.roles[uid()]`
- `isWsMember(wsId)`: `uid() in get(...).data.memberIds`
- `boardRole(board)`: explicit `board.access[uid]`, else for `kind=='main'`, derived from the workspace role (`owner`/`admin`→owner, `member`→editor, `viewer`→viewer)
- `canReadBoard(boardId)`, `canEditBoard(boardId)`, `canManageBoard(boardId)`

Item and subcollection rules authorise via the parent board (`boardId` is in the path, so list queries pass rule evaluation). Rules use at most 3 `get()`s per request.

P0 rule scope: `users` (self), `workspaces` (read if member; create as sole owner; update name/icon/color/description if owner/admin; no client delete), `folders` (member read, admin+ write), `boards` and `items` with the helpers above. Everything else is denied by default. Every rule has emulator tests covering at least: an outsider is denied, a member is allowed, a viewer can't write, and a create with a forged `ownerId`/`roles` is denied.

## 8. Cloud Functions (region `europe-west1`)

```
functions/src/
  index.ts             exports only
  callable/            onCall handlers (validated with zod from @atrium/shared)
  triggers/            Firestore onDocumentWritten etc.
  scheduled/           onSchedule (P5)
  http/                API + webhooks (P8+)
  lib/                 admin init, auth helpers
```
P2: `onItemCreated` (`onDocumentCreated` on `boards/{boardId}/items/{itemId}`, `database: FIRESTORE_DATABASE_ID`, `retry: true`) assigns `seq` and `boardSeq` to every new item in one transaction (read the item and both counters, write the item fields and the counters; `allocateItemNumbers` in `functions/src/lib/item-seq.ts`). It is idempotent under retries (it stops when the item is gone or already numbered) and doesn't touch `updatedAt` / `updatedBy`. Known limit: the single global counter document handles roughly one write per second sustained, which is fine at family scale; a bulk create just queues transaction retries. Existing items are numbered once by `scripts/migrations/2026-10-backfill-item-seq.mjs` (dry run by default; counters and items are committed with preconditions, so it can run while the function is live).

P4 activity log: `onItemWrittenActivity` (`onDocumentWritten` on `boards/{boardId}/items/{itemId}`) and `onBoardWrittenActivity` (on `boards/{boardId}`), both `database: FIRESTORE_DATABASE_ID`, `retry: true`, plus `update_posted` from `onUpdateCreated`. Pure logic and the injected `ActivityStore` are in `functions/src/lib/activity.ts` (`diffItemActivity`, `diffBoardActivity`, `recordItemActivity`, `recordBoardActivity`, `recordUpdatePosted`, `activityDoc`), the Admin adapter and the transaction helpers (`appendActivityTx`, `getMemberProfilesTx`, `newActivityId`) in `functions/src/lib/admin-activity.ts`. See section 5.6.

P5a automations engine: `onActivityCreated` (`onDocumentCreated` on `boards/{boardId}/activity/{activityId}`, `database: FIRESTORE_DATABASE_ID`, `retry: true`) offers every new activity entry to the board's enabled automations (at most 20, loaded once per event). Logic in `functions/src/lib/automations/` (`limits.ts`, `match.ts`, `run.ts`; spec `docs/specs/P5a-automations-backend.md`), Admin adapter in `functions/src/lib/admin-automations.ts`. Triggers: `item_created`, `status_changed` (`toLabelId` is the status label index), `button_clicked`. One transaction per run as the recipe's `runAs`, deterministic run id `${automationId}-${eventId}` for idempotency; a failed run is recorded in a second transaction and counts toward the circuit breaker (10 in a row switches the recipe off and sends one `automation_disabled` notice). Notifications go out after the commit (`deliverAutomationNotifications`). See section 5.6.

P5d time-based automations (Functions side, `docs/specs/P5d-time-based-automations.md`): `runTimeAutomations` (`onSchedule`, every 5 minutes, logic in `functions/src/lib/automations/schedule.ts`, Admin adapter `admin-scheduler.ts`) keeps its state in `system/automationScheduler` (`lastTickAt`) and goes through the same `runAutomation` as event triggers (rate limit, depth 0, circuit breaker, `skipped` records). `recurring`: due recipes (`enabled`, `nextRunAt <= now`) are claimed in the run transaction, which moves `nextRunAt` on together with the run record (id `recurring:<automationId>:<scheduledForISO>`); several missed occurrences run once, for the latest one, and one older than 24 hours is only recorded `skipped`. `date_arrives`: items are found by `dateKeys array-contains "<columnId>:<date>"` for each local day of the window `(lastTickAt, now]` (at most 24 hours back) once the recipe's time of day has come; run id `date:<automationId>:<itemId>:<date>`, so a date fires once per item. `nextRunAt` is kept by `onAutomationWritten`, and `dateKeys` by `onItemPeopleAssigned` next to `assigneeUids` and `nameTokens`; clients write neither.

P1 editor pass 2: `requestDescriptionImageUpload`, `finalizeDescriptionImage` and `getDescriptionImageUrl` (callables, logic in `functions/src/lib/description-images.ts`; see section 5.5) serve the description images. Their request and result schemas are in `packages/shared/src/schemas/description-images.ts`.

P0: `bootstrapUser` (callable, idempotent, transaction). It creates `users/{uid}` from the auth token if missing, plus a personal workspace "<FirstName>'s workspace" with the caller as owner, sets `lastWorkspaceId`, and returns `{ workspaceId }`. The client calls it once after every sign-in.

ADMIN-2 (site admin, `docs/specs/ADMIN-site-admin-role.md`): callables `setAccountStatus` (approve, block, unblock; admins only, the `admin` claim in the verified token) and `listAccounts` (paged Auth users merged with `users/{uid}.accountStatus`), logic in `functions/src/lib/account-admin.ts` behind injected Auth and store interfaces (adapters in `admin-account.ts`), schemas in `packages/shared/src/account-admin.ts`. Every status change appends to `system/accountAudit/entries` (Admin SDK only; uids, no emails). `bootstrapUser` reads the environment variable `ACCOUNT_APPROVAL_REQUIRED` (unset means **false**; not a `defineBoolean` param, which made the non-interactive deploy fail, `functions/src/lib/account-flag.ts`; set by the committed, non-secret file `functions/.env.atrium-board`, so a merge to `main` deploys it and rollback is a PR setting it to `false`): off, nothing changes for users except that a newly created account is stored as approved and given the `acct: approved` claim; on, a new account is `pending` with no workspace and the admins get an `account_request` notification. The gate in the rules ships separately (ADMIN-1b).

## 9. Local development & testing

- `pnpm dev` runs the Vite dev server and the Firebase Emulator Suite (auth 9099, firestore 8080, functions 5001, storage 9199, UI 4000), with emulator data persisted in `.emulator-data/` (gitignored).
- `pnpm test` runs unit tests (Vitest) across packages. `pnpm test:rules` starts the Firestore emulator and runs `tests/rules`.
- `pnpm typecheck`, `pnpm lint` (ESLint flat config + Prettier).
- CI (GitHub Actions): install, lint, typecheck, unit tests, rules tests (setup-java 21). Deploy workflows come once the user adds a deploy credential as a GitHub secret.

## 10. Phase-specific design notes (to be expanded by Opus before each phase)

- **P5 automations:** an event document per change (written by a Firestore trigger) feeds the rule matcher; idempotency key = eventId + automationId; depth counter on writes caused by automations to stop loops.
- **P8 API:** GraphQL modelled on monday's schema subset (`boards`, `items`, `column_values`, `create_item`, `change_column_value`). Personal tokens, then OAuth 2.1 + PKCE.
- **P10 MCP:** a remote MCP server (Streamable HTTP) on Cloud Run that calls the P8 API with the user's OAuth token.
- **P11 import:** maps monday column types 1:1 onto the registry; unsupported settings are reported, never silently dropped.
