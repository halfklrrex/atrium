# P7-docs-editor: workspace docs

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: P7 · Docs & forms ("Docs editor"; Opus creates or updates the item) · Builds on: `docs/specs/P1-description-editor-pass1.md` to `pass3-mentions.md`, `docs/specs/P6-dashboards.md` (the top-level object model this copies), `docs/specs/P4b-board-sharing.md`, `docs/specs/P1c-undo-archive-trash.md` · Status: spec, nothing built

## Goal

monday has Docs: a page in the workspace, next to boards and dashboards, for writing things down (meeting notes, a packing list, the family recipe, house rules). Atrium already has a capable TipTap editor (the item description: headings, lists, checklists, tables, links, colors, emoji, @mentions, images, a "/" menu), but it is tied to an item. Add a **Doc**: a workspace object created from the "+" menu, listed in the sidebar, opened at `/docs/:docId`, edited by the people who can edit it, with autosave, a safe answer to two people editing at once, sharing like dashboards, trash and restore, and (later PRs) images and mention notifications.

Firestore, rules, Cloud Functions and web only. **No secret, no paid provider, no IAM change, no new dependency** (TipTap is already installed).

## Decisions this spec makes (the owner can overrule them)

- **Top-level collection `docs/{docId}`**, shaped like `dashboards/{id}` (`workspaceId`, `folderId`, `kind`, `access`, `accessUids`, `position`, `state`). The body lives in a separate document, `docs/{docId}/content/body`, so listing docs in the sidebar never downloads their text.
- **No real-time co-editing in v1.** Saves are **revision-checked**: every save writes `rev + 1`, and the rules refuse a save whose `rev` is not exactly the stored one plus one. Two people can never silently overwrite each other; the one who saves second sees "Avery changed this doc" and chooses. Presence avatars ("Avery is here") make a clash rare. Live co-editing (Yjs) is a possible later epic; it needs a sync server or a Firestore CRDT adapter, which is a much bigger change.
- **Same roles as boards and dashboards:** a `main` doc is open to every workspace member with their workspace role (owner/admin → owner, member → editor, viewer → viewer); `private` and `shareable` docs list people in `access`. Owners delete and restore; owners and editors write; viewers read.
- **One editor component.** The description editor is refactored into a reusable `RichDocEditor` with injected image and mention adapters; the item description becomes a thin wrapper with no visible change. No second copy of the toolbar, slash menu, tables or emoji.
- **Body size cap 500 KB** of ProseMirror JSON (`DOC_BODY_MAX_BYTES`), 50,000 characters of plain-text mirror. A family note never gets near it; the cap keeps a doc far below Firestore's 1 MiB limit.
- **Docs are not on boards**, so they don't appear in board views, My Work or global search in v1. The plain-text mirror (`text`) is stored now so search can come later without a migration.

## Facts this design rests on (checked against `origin/main` at `de83912`)

- **Editor:** `apps/web/src/components/item-view/DescriptionEditor.tsx` (props `boardId`, `itemId`, `initial`, `readOnly`, `onSave`, `toolbar`, `scrollable`), `editor-extensions.ts` (`createEditorExtensions`), `DescriptionToolbar.tsx`, `slash-menu/`, `mention/`, `TableControls.tsx`, `EmojiPicker.tsx`, `ImageNodeView.tsx`, `description-image-upload.ts` and `description-image-url.ts` (item-scoped callables). `description.ts` has `buildDescription` (doc plus capped text), `createDebouncer` and `DESCRIPTION_SAVE_DELAY = 800`. Shared caps: `ITEM_DESCRIPTION_DOC_MAX_BYTES = 200_000`, `ITEM_DESCRIPTION_TEXT_MAX = 10_000` (`packages/shared/src/schemas/item.ts`).
- **Dashboards as the model:** rules `match /dashboards/{dashboardId}` (create with `access == {uid: 'owner'}`, `accessUids == [uid]`, `state == 'active'`; owners and editors update content and position; only owners change `state`/`deletedAt`; `kind`/`access`/`accessUids` only through the `setDashboardAccess` callable; `allow delete: if false`; list by `kind == 'main'` or `uid in accessUids`). Web: `apps/web/src/data/dashboards.ts` (`dashboardQueries.mainInWorkspace` / `mineInWorkspace`, `mergeDashboards`, `deletedDashboards`, `dashboardWrites`), `components/dashboard/ShareDashboardDialog.tsx`, `DashboardMenu.tsx`; sidebar `components/Sidebar/SidebarTree.tsx` (dashboards sit among boards), `AddMenu.tsx`, `pages/TrashPage.tsx`; `lib/paths.ts` (`dashboardPath`, `dashboardParam`); Functions `functions/src/lib/dashboard-sharing.ts`, `callable/setDashboardAccess.ts`. Equality plus `array-contains` listing needs no composite index (dashboards have none).
- **Presence:** `boards/{boardId}/presence/{uid}` (rules around line 737; `apps/web/src/data/presence.ts`, 30 s heartbeat, 60 s active threshold).
- **Purge:** `functions/src/lib/purge.ts` purges deleted boards and items after 30 days (`THIRTY_DAYS_MS`); `purgeOrphanUploads` sweeps unfinalized uploads.
- **Storage rules can't read Firestore** (named database `atrium-1`; `docs/architecture.md` 2.1), so doc images go through signed-URL callables, as description images do.
- **Add menu reference:** `docs/reference/monday-ui-reference.md` ("Add menu", `03`): "Board ›, Doc ›, Dashboard, Folder, Template center, More ›". There is no section for the doc page itself. Opus captures monday's doc page (title, width, toolbar placement, presence, top bar) with Claude in Chrome (read-only, owner-approved 2026-10-23) and adds a `## Docs` section before PR 2's visual QA. Until then the layout below is the target.

## Scope

- Data, rules and rules tests for docs, the body and doc presence.
- The editor refactor (`RichDocEditor`), the doc page, create, rename, move, delete and restore, the sidebar and workspace Content tab entries, the "+" menu entry.
- Revision-checked autosave, the conflict banner, presence.
- Sharing (`setDocAccess`) and purge.
- Images in docs (PR 5) and @mention notifications (PR 6).
- Showcase: a doc in the showcase workspace.

## Non-goals

- Live co-editing (cursors, simultaneous typing), comments in the margin, suggestions, version history.
- Embedding boards, views or items in a doc; doc templates; a doc cover image or icon picker (the `icon` field is reserved as `null`, like dashboards).
- Global search over docs, docs in My Work, MCP connector tools for docs (a later MCP gap batch).
- Export to PDF, Word or Markdown (the browser's print works on the page; a print stylesheet is a nice-to-have, not required).
- Public (signed-out) doc links.

## Data model

### `docs/{docId}` (metadata, listed in the sidebar)

```
workspaceId, folderId|null, name (1..80), kind: 'main'|'private'|'shareable',
access: { [uid]: 'owner'|'editor'|'viewer' }, accessUids: string[],
position: string, icon: null,
state: 'active'|'deleted', deletedAt|null,
createdAt, createdBy, updatedAt, updatedBy?
```

Exactly the dashboard shape minus `boardIds`/`widgets`. Shared schema `packages/shared/src/schemas/doc.ts`: `docMetaSchema`, `DOC_LIMITS = { name: 80, bodyBytes: 500_000, text: 50_000, images: 100 }`, `DOC_BODY_MAX_BYTES`.

### `docs/{docId}/content/body` (the text)

```
doc: { type: 'doc', content: [...] }   // ProseMirror JSON, at most DOC_BODY_MAX_BYTES serialized (client-enforced)
text: string                           // plain-text mirror, at most 50,000 characters
rev: int                               // 1 on create, +1 on every save
updatedAt, updatedBy
```

A new doc has no body until the first save; the page renders an empty editor when the body is missing. `buildDescription` is generalized to `buildRichDoc(json, { textMax })` in the editor module and reused.

### `docs/{docId}/content/images` (PR 5, Functions-only)

`{ [fileId]: { name, size, mimeType, uploadedAt, uploadedBy } }`, at most 100 entries.

### `docs/{docId}/presence/{uid}`

Same shape and heartbeat as board presence (`displayName`, `photoURL`, `lastActiveAt`).

## Security rules

- **`match /docs/{docId}`:** a copy of the dashboard rules with the doc key lists (create: `canCreateInWs`, folder in the workspace, `access == {uid: 'owner'}`, `accessUids == [uid]`, `icon == null`, `state == 'active'`, audit fields; update: owners and editors change `folderId`, `position`, `name`, `updatedAt`, `updatedBy`; only owners change `state`/`deletedAt`; nobody changes `kind`/`access`/`accessUids`/`workspaceId` from a client; `get` for any role from `boardRole(resource.data)`; `list` for `kind == 'main'` or `uid in accessUids` within a workspace the caller is a member of; `delete: false`). Factor nothing out of the dashboard rules in this PR: copy, so the dashboard rules diff is zero.
- **`match /docs/{docId}/content/{part}`:**
  - read: `part in ['body', 'images']` and the caller has a role on the parent (`boardRole(get(/docs/$(docId)).data)`).
  - `body` create: owner or editor, parent `state == 'active'`, keys exactly `doc, text, rev, updatedAt, updatedBy`, `doc is map && doc.type == 'doc'`, `text is string && text.size() <= 50000`, `rev == 1`, `updatedAt == request.time`, `updatedBy == uid()`.
  - `body` update: same checks, plus **`request.resource.data.rev == resource.data.rev + 1`**.
  - `images`: `write: if false`. Delete of either: `false`.
- **`match /docs/{docId}/presence/{presenceUid}`:** the board presence rules with the doc role.
- `get()` budget: the parent doc plus the workspace (via `boardRole`); within the limit.
- New `tests/rules/src/docs.test.ts`: outsider denied everything; member lists and reads a `main` doc; a private doc is invisible to a member not in `access`; create with forged `access`, `createdBy`, a foreign folder or `state: 'deleted'` refused; editor renames and moves, can't delete or reshare; viewer can't write the body; body create needs `rev == 1`; **an update with a stale `rev` (same as stored, or +2) is refused**; a `text` over the cap and a non-`doc` type refused; a body write on a deleted doc refused; `images` is read-only for clients; presence follows the board presence tests.

## Cloud Functions

- **`setDocAccess`** (PR 4): extract the role and cap logic of `dashboard-sharing.ts` into `functions/src/lib/entity-sharing.ts` (parameterized by collection and limits), keep `setDashboardAccess` on it with its tests unchanged and green, and add `callable/setDocAccess.ts`. Request and result schemas next to the dashboard ones in `packages/shared`.
- **Purge** (PR 4): `purgeTrash` also deletes docs with `state == 'deleted'` and `deletedAt` older than 30 days: recursive delete of `docs/{id}` (body, images map, presence) and the Storage prefix `docs/{id}/`. Tests in `purge.test.ts`.
- **Images** (PR 5): `requestDocImageUpload`, `finalizeDocImage`, `getDocImageUrl`, copies of the description image callables scoped to a doc (path `docs/{docId}/images/{fileId}`, PNG, JPEG, GIF or WebP, 10 MB, 100 per doc; the role check uses the doc's `boardRole` through the shared resolver). `purgeOrphanUploads` sweeps unfinalized `docs/*/images/*` older than an hour. Region `europe-west1`, default memory, no `minInstances` (owner decision 2026-11-16). After deploy, check each new callable has its public invoker binding (deploy gotcha in `AGENTS.md`).
- **Mention notifications** (PR 6): `onDocBodyWritten` (`onDocumentWritten` on `docs/{docId}/content/body`, `database: FIRESTORE_DATABASE_ID`, `retry: true`) diffs `mentionedUidsOf(doc)` before and after and sends a `mention` notification (`target: { docId }`) to newly mentioned people who can read the doc, the actor excluded, at most 20 per save, deterministic ids from the event id. `notificationSchema` gains an optional `docId`/`docName`; the notification card links to `/docs/:docId`. The existing `mention` preference and push switch apply.

## Web

### Editor refactor (PR 2, no visible change to descriptions)

- Move the body of `DescriptionEditor.tsx` into `components/rich-doc/RichDocEditor.tsx` with props `initial`, `readOnly`, `onSave`, `toolbar`, `scrollable`, `images?: ImageAdapter` (`upload(files) → fileIds`, `url(fileId) → Promise<string>`; absent means the image button and paste are hidden) and `mentions?: MentionSource`. `DescriptionEditor` becomes a wrapper that passes the item-scoped adapters. Every existing `DescriptionEditor*.test.tsx` stays green unchanged; the `item-description-*`, `item-slash-menu-*`, `item-mention-list-*` and `item-emoji-picker-*` baselines must not change.

### The doc page (`/docs/:docId`, `pages/DocPage.tsx`)

```
| Family > Docs            (A)(B)  [Share]  [⋯]                     |  page header
|-------------------------------------------------------------------|
|        Summer trip packing list                                   |  title (Poppins, inline edit)
|        Last edited by Avery · 5 min ago        Saved              |  meta line
|        [¶ B I U S A ...  toolbar, sticky]                         |
|        ...body, max width ~ 800 px, centered...                   |
```

- Route added next to `dashboards/:dashboardId`, with `docPath`/`docParam` in `lib/paths.ts` (readable slug like the others).
- Header: breadcrumb (workspace, folder), presence avatars, Share (owners), `⋯` menu (Rename, Move to folder, Duplicate is out of scope, Delete for owners; "Copy link").
- Title: inline edit, writes `name` (same as renaming in the sidebar).
- Meta line: "Last edited by <name> · <relative time>" from the body's `updatedBy`/`updatedAt`; the save state ("Saving…", "Saved") as in descriptions.
- Body: `RichDocEditor` with `toolbar="always"`, sticky under the header, centered column (`--atrium-doc-max-width`). Viewers get `readOnly` and no toolbar.
- Not found or no access: the existing `NotFoundPage` copy ("This doc doesn't exist or you don't have access").
- Deleted doc: a banner "This doc is in the trash" with Restore (owners); the editor is read-only.

### Autosave and conflicts (`data/docs.ts`, `components/rich-doc/use-doc-body.ts`)

- One listener on the body. Local state: `baseRev` (the rev the editor content is based on) and `dirty`.
- **Save** (debounced, `DESCRIPTION_SAVE_DELAY`; also on blur and before unload): `setDoc` on create (`rev: 1`) or `updateDoc` with `rev: baseRev + 1` and the new `doc`/`text`. Success sets `baseRev` to the written rev. No transaction is needed: the rules are the check.
- **Remote change, nothing unsaved:** a snapshot with `rev > baseRev` replaces the content (`editor.commands.setContent`, keeping the selection where possible) and sets `baseRev`.
- **Remote change while dirty, or a save refused with `permission-denied` because of `rev`:** stop autosaving and show a banner: "Avery changed this doc while you were editing." with two buttons: **Load their version** (discard mine) and **Keep mine** (save my content as `remote rev + 1`, overwriting theirs; confirm "Their changes will be lost."). A third, quiet link "Copy my text" copies my plain text to the clipboard first. No automatic merge.
- Size: before saving, if the JSON exceeds `DOC_BODY_MAX_BYTES`, refuse with "This doc is too long to save. Split it into two docs." and keep the content in the editor.
- Offline: Firestore's cache queues the write; a refusal on reconnect leads to the banner, never to silent loss.

### Presence

`usePresence` is generalized to take a collection path (`boards/{id}` or `docs/{id}`); the doc page heartbeats while open and shows the active avatars in the header with "Avery is editing" in the tooltip.

### Sidebar, "+" menu, workspace page, trash

- **"+" menu** (`AddMenu.tsx`): "Doc" after "Board" (monday's order), Vibe doc icon (use the `@vibe/icons` doc glyph; check the exact export name), disabled with "You can't add docs to this workspace" for viewers. Opens `NewDocDialog`: name (default "New doc") and Main/Private, as the new dashboard dialog. Create writes the meta doc and navigates to it with the title focused.
- **Sidebar tree:** docs sit among boards and dashboards in their folder, sorted by `position`, draggable (reuse `treeDnd`), with the doc icon (a lock variant for private), rename and the `⋯` menu (`DocMenu.tsx`, modeled on `DashboardMenu.tsx`). `useWorkspaceDocs` mirrors `useWorkspaceDashboards` (two queries merged).
- **Workspace page, Content tab:** docs listed with boards and dashboards.
- **Trash page:** deleted docs listed with Restore, using `deletedDocs` like `deletedDashboards`.
- **Share dialog** (PR 4): generalize `ShareDashboardDialog` into `ShareEntityDialog` with a `kind: 'dashboard' | 'doc'` prop and the matching callable; the dashboard dialog looks the same (its baseline must not change).

## Tokens

New `apps/web/src/theme/docs-tokens.css` (imported in `main.tsx`; **not** `tokens.css`): `--atrium-doc-max-width` (about 800 px, adjust to the monday capture), `--atrium-doc-page-padding`, `--atrium-doc-title-font` (Poppins, the size from the capture), `--atrium-doc-meta-gap`, `--atrium-doc-banner-bg` (a Vibe warning surface), with dark values where Vibe doesn't already switch.

## PR breakdown (small, shippable, in order)

Each PR starts from fresh `origin/main` in its own worktree (`/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>`, own `ATRIUM_PORT_OFFSET`).

| #   | Branch                      | Offset | Depends on | Hot spots touched                                                                                         |
| --- | --------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------- |
| 1   | `claude/docs-1-data`        | 10     | none       | `packages/shared/**`, `firestore.rules`, `tests/rules/**`                                                 |
| 2   | `claude/docs-2-page`        | 20     | PR 1       | `tests/visual/__screenshots__/**` (`add-menu-*` changes; new doc screens)                                 |
| 3   | `claude/docs-3-conflicts`   | 40     | PR 2       | `firestore.rules`, `tests/rules/**` (doc presence), `tests/visual/__screenshots__/**` (new banner screen) |
| 4   | `claude/docs-4-share-purge` | 50     | PR 2       | `packages/shared/**` (callable schemas)                                                                   |
| 5   | `claude/docs-5-images`      | 60     | PR 4       | `packages/shared/**` (image schemas)                                                                      |
| 6   | `claude/docs-6-mentions`    | 70     | PR 3       | `packages/shared/**` (notification fields), `tests/rules/**` if the notification shape needs a rules test |

Not touched by any: `apps/web/src/theme/tokens.css`, `firebase.json` (no new rewrite: `/docs/**` is served by the existing SPA rewrite; check it isn't shadowed by a Functions rewrite), `pnpm-lock.yaml` (no new dependency), `storage.rules` (signed URLs only). PRs 1 and 3 touch `firestore.rules`: merge in order and rebase; if another open PR edits `firestore.rules`, merge in order with it too.

### PR 1: data and rules

1. `schemas/doc.ts` (meta, body, limits) with tests; export.
2. The `docs`, `content` and (empty for now) presence-less rules; `tests/rules/src/docs.test.ts` including the stale-`rev` cases.
3. `data/docs.ts`: refs, converters, queries, `mergeDocs`, `deletedDocs`, `docWrites` (create, rename, move, delete, restore, save body); unit tests. No UI.

### PR 2: editor refactor, the page, sidebar and menu

1. `RichDocEditor` extraction; `DescriptionEditor` wrapper; all description tests green, no description baseline change.
2. `DocPage`, route, paths, `NewDocDialog`, "+" menu entry, sidebar rows and `DocMenu`, Content tab, Trash entries, tokens. Autosave with `rev` (simple path: no banner yet; a refused save shows a toast "This doc changed. Reload to see the latest version.").
3. Showcase: the seeder creates a "Showcase notes" doc in the showcase workspace (`scripts/showcase/data.mjs`, `docs/showcase.md`).
4. Tests: `DocPage.test.tsx` (create, rename, viewer read-only, deleted banner, not found), `AddMenu` and `SidebarTree` tests.
5. Visual: seed one doc; new screens `doc-page-{theme}` and `new-doc-dialog-{theme}`; `add-menu-*` changes on purpose (re-run the workflow and show the diff). The sidebar screens change only if the seeded doc is in the seeded workspace's tree: put it in a folder that is collapsed in those screens, or accept and explain the diff.

### PR 3: conflicts and presence

1. `use-doc-body.ts` with `baseRev`/`dirty`, the remote-replace path and the conflict banner (Load theirs, Keep mine, Copy my text); the size refusal.
2. Doc presence rules and tests; `usePresence` generalized; header avatars.
3. Tests: two simulated clients (stale save refused, banner shown, Keep mine writes `remote + 1`, Load theirs replaces), size cap.
4. Visual: `doc-conflict-banner-{theme}` (new).

### PR 4: sharing and purge

1. `entity-sharing.ts` extraction (dashboard tests unchanged), `setDocAccess` with tests, export.
2. `ShareEntityDialog` (dashboard dialog visually identical), Share button on the doc page.
3. `purgeTrash` for docs, tests.

### PR 5: images in docs

1. The three doc image callables, schemas and emulator tests; `purgeOrphanUploads` sweep.
2. The doc `ImageAdapter`; paste, drop and the toolbar image button in docs.
3. Tests; no new visual screen needed (the emulator run has no Storage, so images show their fallback; skip).

### PR 6: mention notifications

1. `onDocBodyWritten`, notification fields, card link; tests.
2. Check the trigger deploys on the `eur3` database like the other Firestore triggers (no Eventarc setup needed: it already exists).

Each PR description: what changed, the Roadmap item, light and dark screenshots for UI work, the baseline diffs, and the model that wrote the code.

## Acceptance checks

1. "+" → Doc creates a doc that appears in the sidebar for every member (Main) or only for me (Private), opens at `/docs/<slug>`, and survives a reload.
2. Typing autosaves ("Saved"); another member sees the change on their open page within a few seconds when they have no unsaved edits.
3. Two people editing at once never lose work silently: the second save is refused by the rules and the banner offers Load theirs, Keep mine and Copy my text.
4. A viewer reads but can't edit; a non-member gets the not-found page; a private doc is invisible to members not in `access`.
5. Rename and move from the sidebar and the page; delete sends it to Trash; Restore brings it back; after 30 days `purgeTrash` removes it with its body and images.
6. The item description editor behaves and looks exactly as before (tests and baselines unchanged).
7. (PR 4) Share sets Main/Private/Shareable and per-person roles through `setDocAccess`.
8. (PR 5) Pasted images upload and render in docs; viewers see them.
9. (PR 6) @mentioning someone in a doc sends them one notification that opens the doc.
10. No change to `tokens.css`, `firebase.json`, `storage.rules` or `pnpm-lock.yaml`; no secret, provider or IAM change; tokens only (`pnpm lint`); light and dark compared with the monday capture, gaps fixed or logged in VF.

## What Ophelia (Opus) reviews

- The `rev` rule is present on body updates and tested with stale and skipped revisions.
- The editor refactor moved code without changing it (diff reads as a move plus adapter wiring); description baselines unchanged.
- The dashboard rules and dashboard sharing behave identically after the extraction.
- No signed URL lands in Firestore, logs or `localStorage`.

## Risks

- **Editor refactor regressions.** The description editor is heavily tested; PR 2 must not change a test expectation. If the extraction gets large, split it into its own PR (2a) before the page (2b).
- **Conflicts on a busy doc.** Without co-editing, two people typing in the same doc for a long time will hit the banner often. Presence makes it visible; if the family uses docs that way, live co-editing is the follow-up epic.
- **Lost keystrokes on close.** A save pending in the debounce when the tab closes is flushed on `beforeunload` and `visibilitychange`; Firestore's offline queue covers the rest. Test the flush.
- **Rules cost.** Each body read or write evaluates the parent doc and the workspace; at family scale this is negligible.

## What needs the owner

- Confirm or overrule the decisions above (especially: no live co-editing in v1, the conflict banner instead).
- Check live after PR 2 and PR 3 (Roadmap item to In review with Actionable = Yes): create a doc, edit it from two accounts at once, try both banner choices.
- Nothing else: no secret, no paid service, no IAM role, no production backfill.
