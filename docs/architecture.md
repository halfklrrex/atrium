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
```
Loading a board means one listener on `items where state == 'active'`, which is fine to several thousand items. Paging and virtualisation come later.

### 5.6 Later subcollections (shape reserved, built in later phases)
- `boards/{boardId}/items/{itemId}/updates/{updateId}`: rich-text updates, replies via `parentUpdateId` (P1)
- `boards/{boardId}/views/{viewId}`: `name, type (table|kanban), position, ownerId|null (null = shared view, a uid = personal), settings {filter, hiddenColumnIds, kanban?}, createdAt/By, updatedAt/By` (P3). `main` is the fixed Main table view, created lazily on its first save. `ownerId` and `type` never change ("make personal/shared" writes a copy and deletes the original). The client lists views with two queries (`ownerId == null` and `ownerId == uid`) because the rules engine refuses `ownerId in [null, uid]`. Details: `docs/specs/P3-saved-views.md`.
- `boards/{boardId}/activity/{id}`: append-only, written only by Functions (P1/P4). Rules deny every client read and write, explicitly (FW2)
- `boards/{boardId}/automations/{id}` (P5) · `dashboards/{id}` (P6) · `docs/{id}` (P7)
- `users/{uid}/notifications/{id}` (P4) · workspace `invites` and `members`: see 5.2a (P4a)

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
  item: { id; values; createdAt?; createdBy?; updatedAt?; updatedBy?; groupId? }; // plain data the client already holds
  columns: readonly ColumnDef[];  // every column def of the board, for cross-column derivations
}
type ValidationResult = { ok: true } | { ok: false; message: string };
```

- **`derived: true`** marks a type whose value is computed (formula, mirror, progress, item ID, creation log, last updated). It **requires `compute(ctx, settings)`**, which must be pure and fast. `registry.register` throws otherwise.
- **`validateValue(value, settings, ctx?)`** is optional and pure: rules beyond `valueSchema` that need the settings (for example rating <= limit). It runs only for non-empty values that already passed the schema.
- **Registry helpers:** `isDerived(type)`, `computeValue(def, ctx)` (null for unknown or non-derived types and for invalid settings), `validateCell(def, value, ctx?)` and `derivedColumnIds(columns)`. `validateCell` is the one gate for writes: it **rejects every value for a derived type, `null` included**, with "This column is calculated automatically"; otherwise it runs `valueSchema` and then `validateValue`. Empty cells are valid. Unknown types are refused with a message instead of throwing.
- **Client:** `tableActions.setCell` calls `validateCell` first and shows a refusal in an error toast without writing. Derived cells render `computeValue(...)` read-only (no editor, no toggle, Delete does nothing). New items, duplicated items and new boards never carry derived values. A future CSV or paste path must call `validateCell` per cell too.
- **Server enforcement:** `boards/{id}.derivedColumnIds` lists the derived column ids of `columns` and `subitemColumns` (sub-items share the `items` collection). The `onBoardColumnsWritten` Cloud Function (`onDocumentWritten` on `boards/{boardId}` with `database: FIRESTORE_DATABASE_ID`, function region `europe-west1`, trigger on the `eur3` database) recomputes it with the shared registry (`nextDerivedColumnIds` in `@atrium/shared`) and writes it back only when the sorted list changed, inside a transaction on the current document, so it is idempotent and its own write doesn't loop. The rules:
  - board **create** must carry `derivedColumnIds == []`;
  - board **update** can never change `derivedColumnIds` (it isn't in the editable key list);
  - item **create** may not contain any key of `derivedColumnIds` in `values`;
  - item **update** may not add, change or remove any such key (`values.diff(...)`); a stale stored value that is left alone doesn't block other edits;
  - a board without the field (created before FW1) reads as `[]`.
- **Known limits:** (1) the function lags a column change by a moment, so right after someone adds a derived column a client could still store a value in it; it's never displayed (the computed value is shown) and gets blocked as soon as the function has run. (2) A type becoming derived later (for example converting #13's computed types) doesn't update boards by itself, because the function only reacts to board writes: re-run the backfill. (3) Search, sort and footer summaries read `values.<id>`, so for a derived column they see nothing until they are taught to use `compute`.
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
  - `boards/{id}/activity/**` has an explicit `allow read, write: if false` match: Functions only (section 5.6).
- **Client:** server-managed cells never open the generic editor (no click, Enter or Delete writes) and show a "Managed by Atrium" tooltip. They render their stored value read-only until the callables (#34 time tracking and buttons, #35 files) provide real controls. `item-writes` refuses them through `validateCell`, duplicated items and groups start with those cells empty, and deleting or duplicating such a column doesn't try to clean up or copy cells (the rules would refuse it; leftover values are invisible without the column).
- **Which types are flagged:** `button` is flagged on main. **The PR that adds each of the other modules must set `serverManaged: true` on it** (or rebase on FW2 and add it): `time_tracking` (#24, owned by #34) and `files` (#26, owned by #35). Until then those boards' cells are only advisory-protected. After a type becomes server-managed, re-run the backfill (the function only reacts to board writes).
- **Known limits:** the same moment of lag as derived columns after someone adds such a column, and the backfill must be re-run when a type becomes server-managed.
- **Migration:** the same script as FW1 backfills both fields (dry run unless `--apply`): `pnpm exec tsx scripts/migrations/2026-10-backfill-derived-column-ids.mjs --project atrium-board`, then again with `--apply`. Boards that already hold `button` columns need `serverManagedColumnIds` set before the rules protect them.

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
P0: `bootstrapUser` (callable, idempotent, transaction). It creates `users/{uid}` from the auth token if missing, plus a personal workspace "<FirstName>'s workspace" with the caller as owner, sets `lastWorkspaceId`, and returns `{ workspaceId }`. The client calls it once after every sign-in.

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
