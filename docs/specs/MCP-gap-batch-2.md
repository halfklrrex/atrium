# MCP gap batch 2 (and 3, 4): docs, teams, my work, views, column types, files, sharing, dashboards, automations

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: 3346811892 (MCP to full working order) and OPS4 3350740685 · Follows `MCP-gap-batch-1c.md` (45 tools) and OPS4 section 14 · Status: spec, nothing built

## Plan summary

The owner wants the connected AIs "to be able to do pretty much anything in the Atrium workspaces and boards" (2026-11-16). The connector has 45 tools and covers boards, groups, columns, items, subitems, descriptions, updates, votes and templates. It can't touch anything Atrium gained since: Docs, Teams, profiles, views (including forms and the Files gallery), dashboards, automations, files, notifications and My Work. It also reads some things wrong today: calculated columns come back empty, and a team in a People cell looks like an unknown person.

The plan is 11 small PRs in three batches. Each adds tools to `@atrium/mcp-core`, so the local stdio server and the hosted connector both get them, except the tools that need Cloud Storage or callable logic, which are hosted-only (batch 3).

| Batch | PRs      | What an assistant can do afterwards                                                                                                                                                                                                                 | Tools after |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **2** | 1 to 6   | Read calculated columns correctly; assign teams; read, write and create Docs; "what's on my plate", search everything, read and clear notifications; use, create and change views and forms; manage teams; create every column type and edit labels | 66          |
| **3** | 7 to 9   | Download and upload files; share docs, dashboards and boards inside the workspace; change a column's type; click buttons; start and stop time tracking                                                                                              | 76          |
| **4** | 10 to 11 | Build and change dashboards; read, create and switch automations                                                                                                                                                                                    | 88          |

Order: PR 1 first (it fixes reads and makes later PRs conflict-free). After that, two agents can work at once (pairs: 2+3, 4+5, 6+7, then 8+10, 9+11). No PR changes `firestore.rules`, `firebase.json`, `packages/shared/**` or the visual baselines. Batch 3 needs no new secret, paid provider or IAM role (checked: every function runs as the same default runtime service account, which already signs URLs for the file callables). The owner decides the nine questions in "What needs the owner"; each has a recommended default, so building can start on PRs 1 to 6 before the answers.

## Gap audit (checked against `origin/main` at `f9d5134`)

What was checked: `packages/mcp-core/src/tools.mjs` (45 tools), `service.mjs`, `values.mjs`, `index.d.mts` (the `FirestoreClient` interface: `getDoc`, `getDocMeta`, `listAllDocs`, `runQuery` on a **top-level collection with equality and array-contains only**, `commit`), the Admin SDK adapter `functions/src/mcp/admin-client.ts`, the REST client `scripts/showcase/firestore-rest.mjs`, `functions/src/mcp/server.ts` (scope check, limits, audit), `limits.ts` (60 a minute, 2,000 a day, 500 writes a day), `audit-tools.ts` (records `boardId` only), `firestore.rules`, the shared schemas and the web data layer (`apps/web/src/data/*.ts`).

### Defects in what exists (fix first, PR 1)

1. **Calculated columns read as empty.** `readableCell` only looks at stored values, and derived columns (formula, progress, item ID, auto number, creation log, last updated, mirror) store nothing. `atrium_get_board`, `atrium_find_items`, `atrium_list_subitems` and the move report all show `null` for them. The web computes them with `columnRegistry.computeValue` (see `cellValue` in `packages/shared/src/filters/engine.ts`).
2. **Teams in People cells are invisible.** `readableCell` returns bare ids for People, so a team id looks like an unknown uid. `values.mjs` `people()` always writes `kind: 'person'`, so the connector can't assign a team, although the value schema, the item index (`assigneeTeamIds`) and the team notifications (`functions/src/lib/notifications.ts`) all support teams.
3. **Member names are read from private user docs.** `profileOf` reads `users/{uid}` for other people. The rules make `users/{uid}` self-read only. Members are meant to be read from `workspaces/{ws}/members/{uid}` (any member may read it, and it carries the shared profile). The output is the same today (name and email), but the connector should mirror the rules. That doc is also one read per member instead of a private-doc read.
4. **Stale docs.** `docs/mcp-connector.md` "Not yet possible" still lists likes, reordering, restore, move, board delete and emails, which are all done. The consent page copy (`apps/web/src/pages/connect/ConnectPage.tsx`, `SCOPE_COPY`) mentions only boards, items and updates.
5. **The audit records only `boardId`.** Tools on docs, dashboards, teams and notifications would leave no target in `system/mcpAudit/entries`.

### Gaps: what the web app can do and the connector can't, ranked by value to an assistant in a family workspace

| Rank | Gap                                                                                                                                                                                                                                                                                   | Why it matters                                                                                          | Data path                                                                                                                                         | PR  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 1    | **Docs:** list, read, create, write (replace or append), rename, trash, restore; @mentions; tables                                                                                                                                                                                    | Recipes, packing lists, house rules, meeting notes: the most natural thing to ask an assistant to write | `docs/{id}` + `docs/{id}/content/body` (`rev` +1 check); client-writable, so Firestore only                                                       | 2   |
| 2    | **Read correctness:** calculated columns, teams in People cells, member names                                                                                                                                                                                                         | Wrong answers today ("the budget total is empty")                                                       | Shared `computeValue`; member docs                                                                                                                | 1   |
| 3    | **Teams in People cells** (assign, read) and list teams                                                                                                                                                                                                                               | "Assign the Kids to the chores"                                                                         | `personsAndTeams` `kind: 'team'`; `workspaces/{ws}/teams`                                                                                         | 1   |
| 4    | **My Work, search, notifications**                                                                                                                                                                                                                                                    | "What's on my plate this week?", "find the dentist item", "what did I miss?"                            | Item index fields `assigneeUids`, `assigneeTeamIds`, `nameTokens` (Function-maintained); `users/{uid}/notifications` (self read, `readAt` update) | 3   |
| 5    | **Views and forms:** list, read items through a view, create, change, delete; form view questions                                                                                                                                                                                     | "Show me the 'This week' view", "make a Kanban by status", "set up a sign-up form"                      | `boards/{id}/views/{viewId}`; shared filter engine; `formSettingsSchema`                                                                          | 4   |
| 6    | **Team management:** create, rename, recolor, change members, delete                                                                                                                                                                                                                  | Setting up a family workspace                                                                           | `workspaces/{ws}/teams/{id}` (workspace owner or admin)                                                                                           | 5   |
| 7    | **Every column type** (email, phone, country, location, hour, week, world clock, color, vote, progress, formula, item ID, auto number, creation log, last updated, connect boards, mirror, dependency, files, time tracking) and **label editing** (rename, recolor, reorder, remove) | Only 12 types can be created; labels can only be added                                                  | Board `columns` (owner), registry `settingsSchema` and `validateValue`                                                                            | 6   |
| 8    | **Files:** list, download link, upload, delete (Files column and update attachments)                                                                                                                                                                                                  | "Attach the scan of the permission slip", "what's in the receipts column?"                              | Cloud Storage via the file callables' logic (signed URLs)                                                                                         | 7   |
| 9    | **Sharing** docs, dashboards and boards (kind, per-person role) inside the workspace                                                                                                                                                                                                  | "Make this doc private to me and Sam"                                                                   | `setDocAccess`, `setDashboardAccess`, `setBoardAccess` logic                                                                                      | 8   |
| 10   | **Column type change** (with undo), **button clicks**, **time tracking** start and stop                                                                                                                                                                                               | Restructuring a board; "start my timer"                                                                 | `changeColumnType`, `revertColumnType`, `clickButton`, `startTimeTracking`, `stopTimeTracking` logic                                              | 9   |
| 11   | **Dashboards:** list, read, create, change widgets, trash, restore                                                                                                                                                                                                                    | Less common in a family workspace, but asked for                                                        | `dashboards/{id}` (client-writable)                                                                                                               | 10  |
| 12   | **Automations:** list, run history, create, change, enable, disable, delete                                                                                                                                                                                                           | Powerful, but riskier (they act later, as the creator)                                                  | `boards/{id}/automations`, `automationRuns` (owner reads); shared `validateAutomation`                                                            | 11  |

**Not planned** (each needs an owner request first): workspace membership, invites and roles (`createInvite`, `changeMemberRole`, `removeMember`: account-level and sensitive); folders (create, move into); board duplicate and the "faithful move" (batch 1c amendment 2); moving items across workspaces (deferred 2026-11-16); setting another person's profile; `setMyProfile` (low value); CSV and Excel export (the AI reads the data directly); the site-admin inbox and account approval; permanent deletion (the scheduled purge keeps doing it).

## Design rules for every PR

- **Mirror the rules, reuse the code.** Every write is one the rules (or, for hosted-only tools, the callable) allow to the same person. Values and documents are validated with the same shared schemas and helpers the web uses (`@atrium/shared`). Where the logic lives only in `functions/src/lib/*` (Storage, sharing, column type change, buttons, time tracking), the hosted connector calls **that same function** through an injected adapter (PR 7), never a copy.
- **Same actor model.** One user per call; anything outside their memberships reads as "not found". A doc or dashboard's role is computed like a board's (`roleOn` generalized to any `{ workspaceId, kind, access }` entity, as the rules' `boardRole()` does for all three).
- **Untrusted content.** Tools that return doc text, notification text, view names or file names end with the `UNTRUSTED` sentence.
- **Data-loss guard pattern** (from `atrium_move_item_to_board`): anything that would drop or overwrite content people wrote takes `dryRun?: boolean` (report only, never writes) and refuses unless `allowDataLoss: true`, with an error that lists what would be lost. The dry run report and the real run come from the same function.
- **Hard deletes the web allows** (views, teams, files, automations) are `destructiveHint: true`, and the result returns the full deleted definition so it can be recreated.
- **Never written by the connector:** `derivedColumnIds`, `serverManagedColumnIds`, `requiredColumnIds`, `voteColumnIds`, `seq`, `boardSeq`, the item index fields (`assigneeUids`, `assigneeTeamIds`, `nameTokens`, `dateKeys`), `descriptionImages`, `content/images`, activity, notifications (except `readAt`), `automationRuns`, sharing fields outside the PR 8 adapter.
- **Scopes:** read tools are `read(...)`, writes `add`, `addOnce` or `change`. There are no new OAuth scopes: `atrium:write` covers everything new (owner question 9).
- **Ports:** Claude worktrees use offsets 10, 20, 40, 50, 60, 70, 80, 90 (never 30, never 100 or above, which belong to Antigravity). An offset can be reused once its PR has merged.

## PR 1: read fixes, teams in People cells, foundations (46 tools)

Branch `claude/mcp-2-1-foundations`, offset 10, depends on nothing. **Blocks every other PR.**

**Tools:** `atrium_list_teams` (read; any workspace member): `{ workspaceId? }` returns `[{ id, name, color, members: [{ uid, name }] }]` sorted by name.

**Changes:**

1. **Calculated columns in reads.** `readableCell(column, value, ctx)` gets the item context. For a derived type it calls `columnRegistry.computeValue(column, { boardId, item: { id, values, createdAt, createdBy, updatedAt, updatedBy, groupId, seq, boardSeq }, columns })` exactly as `cellValue` in `packages/shared/src/filters/engine.ts` does, then `toText`. Mirror stays `null` until PR 6 (it needs linked boards). `find_items` `where` matches the computed text.
2. **People cells.** Input entries may also be `"team:<name or id>"` or `{ team: "<name or id>" }`, matched case-insensitively against the workspace's teams (an unknown team: an error listing the team names). Written as `{ id, kind: 'team' }`; `singlePerson` columns accept one team, as the web does. The readable form becomes `[{ id, kind, name }]` (a deleted team reads `name: "Deleted team"`). `find_items` `equals` on a People column matches an id or a name. The `cellValues` description in `tools.mjs` says so. The existing Functions (`onItemPeopleAssigned`) notify the team's members and fill `assigneeTeamIds`; nothing new server-side.
3. **Members from member docs.** `profileOf(uid)` for another person reads `workspaces/{ws}/members/{uid}` (displayName, email, shared profile); only the actor's own author profile still reads `users/{actor}`. `atrium_list_members` and `atrium_find_member` add the shared profile fields that are set (`title`, `location`, `timeZone` when `showLocalTime`), nothing else.
4. **Module split, so later PRs don't collide.** Move the catalogue into `packages/mcp-core/src/tools/<domain>.mjs` arrays (boards, items, updates, members) concatenated by `tools.mjs`, and new service code into `src/service/<domain>.mjs` modules that receive the shared helpers (`loadBoard`, `membership`, `roleOn`, ...) from `createService`. Pure refactor, same names and order; every existing test stays green unchanged. Later PRs add one file each and one import line.
5. **Count tests read the catalogue.** `scripts/mcp/stdio.test.mjs` and `functions/src/mcp/app.test.ts` compare with `defineTools(...).length` (as `tests/rules/src/mcp-function.e2e.test.ts` already does) plus one asserted list of names per domain file. No later PR edits a literal count.
6. **Client queries for PRs 3 to 5.** `FirestoreClient.runQuery(collectionPath, where, options?)`: `collectionPath` may be nested (`boards/{id}/items`); `where` adds `{ arrayContainsAny: [...] }` (at most 30 values); `options` `{ limit?, orderBy?: { field, direction } }` (`orderBy` only without filters, so no composite index is ever needed). Implement in the Admin adapter, the REST client (`parent` = the document path, `collectionId` = the last segment) and `fake-client.mjs`; update `index.d.mts`. Existing callers are unchanged.
7. **Audit target.** `audit-tools.ts` records the first of `boardId`, `docId`, `dashboardId`, `teamId`, `viewId` it finds as `targetKind` and `targetId` (64 characters), and keeps `boardId` as today. Update the audit entry type in `functions/src/mcp/oauth/store.ts`. No content is logged.

**Tests:** mcp-core: computed formula, progress, item ID, last updated in `get_board` and `find_items`; team input by name, id and object, unknown team, single-person column with a team, readable team name, deleted team; members from member docs (a fake `users/{other}` doc must not be read: assert with a client spy); refactor parity (the tool names, order, schemas and annotations snapshot equals the pre-refactor list); `runQuery` nested path, `arrayContainsAny`, `limit`, `orderBy` in the fake client and the REST client (request body), and an Admin adapter case in `functions/src/mcp/admin-client.test.ts`. Emulator: new file `tests/rules/src/mcp-teams.e2e.test.ts`, one case: assign a team through `atrium_update_item`, then the trigger fills `assigneeTeamIds`.

**Docs:** `docs/mcp-connector.md`: People and teams, calculated columns, the "Not yet possible" list rewritten to the real remaining gaps (point at this spec).

**Hot spots:** `tests/rules/**` (new file only).

## PR 2: Docs (53 tools)

Branch `claude/mcp-2-2-docs`, offset 20, depends on PR 1. Parallel with PR 3.

| Tool                 | Scope                         | Role                                                          | Input                                                                                              |
| -------------------- | ----------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `atrium_list_docs`   | read                          | any role on the doc                                           | `workspaceId?, state?: 'active' \| 'deleted'` (default active)                                     |
| `atrium_get_doc`     | read                          | any role                                                      | `docId`                                                                                            |
| `atrium_create_doc`  | write (`add`)                 | workspace owner, admin or member (the rules' `canCreateInWs`) | `name, workspaceId?, kind?: 'main' \| 'private' \| 'shareable'` (default `main`), `markdown?`      |
| `atrium_write_doc`   | write (`change`)              | doc owner or editor                                           | `docId, markdown, mode?: 'replace' \| 'append'` (default replace), `baseRev?, allowOverwriteRich?` |
| `atrium_rename_doc`  | write (`addOnce`)             | owner or editor                                               | `docId, name` (1 to 80 after trim)                                                                 |
| `atrium_delete_doc`  | write (`change`, destructive) | doc owner                                                     | `docId` (to the trash; purged after 30 days)                                                       |
| `atrium_restore_doc` | write (`addOnce`)             | doc owner                                                     | `docId`                                                                                            |

**Behavior:**

- **Listing** mirrors the rules' list shapes: docs of the workspace with `kind == 'main'` or the actor in `accessUids`, then `roleOn` must give a role. Returns `{ id, name, kind, role, state, updatedAt }` by position.
- **Reading** returns `{ id, name, kind, role, rev, updatedAt, updatedBy (name), markdown, text, richNodes }`. `markdown` comes from `docToMarkdown`, extended in this PR: tables become GFM pipe tables (a cell holding more than inline text is listed in `richNodes`), mentions become `@[Name]`, images become `![image](atrium-doc-image:<fileId>)` placeholders and are listed in `richNodes`. A doc without a body reads as empty with `rev: 0`.
- **Creating** mirrors `docWrites.createDoc` in `apps/web/src/data/docs.ts` field for field (`access: { me: 'owner' }`, `accessUids: [me]`, `icon: null`, `state: 'active'`, `folderId: null`) at the end of the workspace root: the position comes after the last root position among boards, dashboards and docs (check how the sidebar orders them and use the same comparison). With `markdown`, the body (`rev: 1`) is in the same `commit`.
- **Writing** builds the ProseMirror doc with `markdownToDoc`, extended here with GFM tables (to the editor's `table` / `tableRow` / `tableHeader` / `tableCell` nodes: check the node names and required attributes in `apps/web/src/components/item-view/editor-extensions.ts`) and `@[Name]` mentions (the `updates.mjs` resolver, limited to members who can read the doc; mentions notify through the existing `onDocBodyWritten` trigger). `text` comes from the shared `docToText` and is cut to 50,000 characters; a body over `DOC_BODY_MAX_BYTES` is refused ("This doc is too long"). Writes `{ doc, text, rev: stored + 1, updatedAt, updatedBy }` with an `updateTime` precondition (or `exists: false` for the first body), which is the connector's version of the rules' `rev` check. `append` adds after the existing content and keeps it untouched.
- **Conflict guard:** with `baseRev`, a stored `rev` that differs refuses: "The doc changed since you read it (rev N). Read it again." Without `baseRev`, a replace still refuses when the body was saved in the last 2 minutes by someone else (someone may be typing), unless `allowOverwriteRich` is true. A person with the doc open sees the web's conflict banner (P7 PR 3), as with two browsers.
- **Rich guard:** `replace` refuses when the stored doc holds content the markdown can't write back (images, emoji, text color or highlight, table cells with blocks, any node outside the round-trip set) unless `allowOverwriteRich: true`. The error names them. Replacing images leaves their files in `content/images` (Functions-only; the purge removes them with the doc).
- **Item descriptions** share the converter, so `atrium_set_item_description` also gains tables and `@[Name]` mentions (the description mention notifications already exist). Its rich guard moves tables and mentions to the round-trip set; tests cover both tools.
- Rename, delete and restore mirror `docWrites.renameDoc`, `deleteDoc` and `restoreDoc` (`state`, `deletedAt`, `updatedAt`, `updatedBy`, `updateTime` precondition). Every other doc tool refuses a doc in the trash ("Doc X is in the trash.").
- Sharing changes are PR 8; images in docs need Storage (PR 7 adds `atrium_upload_file` for files columns; doc images are a later option, not in this plan).

**Web:** consent copy in `ConnectPage.tsx`: Read "See your workspaces, boards, docs, items and updates."; Write "Create and change boards, docs, items and updates you can edit." (not in the visual baselines; update `ConnectPage.test.tsx`).

**Tests:** list visibility (main, private not in access, shareable with access, deleted state); get with tables, mentions and images; create with and without markdown, viewer workspace role refused; write replace and append, table round trip, mention to a non-reader refused with the members error, `baseRev` mismatch, recent-edit guard, rich guard and override, size cap, trashed doc refused; rename limits; delete and restore owner-only (editor refused). Emulator file `tests/rules/src/mcp-docs.e2e.test.ts`: create with a body, then a second write gets `rev: 2`, and the doc reads back in the web shape (`docBodySchema.parse`).

**Docs:** `docs/mcp-connector.md` "Docs" section and the scope table.

**Hot spots:** `tests/rules/**` (new file).

## PR 3: My Work, search, notifications (57 tools)

Branch `claude/mcp-2-3-my-work`, offset 40, depends on PR 1. Parallel with PR 2.

| Tool                             | Scope             | Input                                                                                                                                             |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atrium_my_work`                 | read              | `workspaceId?, includeTeams? = true, dateColumn?` (title), `due?: 'overdue' \| 'today' \| 'this_week' \| 'next_week' \| 'no_date'`, `limit? = 50` |
| `atrium_search`                  | read              | `query` (2 to 200 characters), `workspaceId?, kinds?: ('items' \| 'boards' \| 'docs')[]` (default all), `includeDocText? = false, limit? = 25`    |
| `atrium_list_notifications`      | read              | `unreadOnly? = false, limit? = 30` (max 100)                                                                                                      |
| `atrium_mark_notifications_read` | write (`addOnce`) | `ids?: string[]` (max 100) or `all?: true`                                                                                                        |

**Behavior:**

- **My Work** mirrors `apps/web/src/data/my-work.ts`: the boards the actor can read (all workspaces, or one), the 100 most recently visited first (`users/{me}/recents`, then name), per board `items where assigneeUids array-contains me`, plus `assigneeTeamIds array-contains-any <my teams in that workspace, at most 30>` when `includeTeams`; active items only (filtered in memory, so no composite index); each re-checked with `assigneeUidsOf` / `assigneeTeamIdsOf` against the board's current columns. Returns `[{ boardId, boardName, itemId, name, group, via: 'me' | <team name>, values }]` sorted by the first date column (or `dateColumn`), then name. `due` uses the actor's time zone (`users/{me}.timezone`, default UTC). Says so when the board cap cut the list.
- **Search** mirrors `apps/web/src/data/search.ts` for items (`nameTokens array-contains <longest word>` per readable board, at most 10 per board, every word must match, 10 boards at a time) and matches board and doc names case-insensitively. `includeDocText` also reads the `text` of up to 100 readable active docs and returns a 160-character snippet around the first hit. Results: `[{ kind, id, name, boardId?, boardName?, snippet? }]`.
- **Notifications** read `users/{me}/notifications` newest first (`orderBy createdAt desc`, `limit`); each `{ id, kind, actor (name), boardId, itemId, docId, text, createdAt, read }`. Mark read writes only `readAt: now` on unread ones the actor owns (the rules allow exactly that); never deletes.

**Tests:** fake client: direct and team assignment, team outside the workspace ignored, stale index hint filtered out, archived item excluded, board cap message, due buckets across a time-zone edge; search tokens, multi-word, unreadable board skipped, doc text snippet, kinds filter; notifications order, unread filter, mark read by ids and all, another user's id ignored (it is not in the actor's collection). Emulator file `tests/rules/src/mcp-my-work.e2e.test.ts`: an item assigned through the web shape shows up after the index trigger runs.

**Docs:** `docs/mcp-connector.md` "My work, search and notifications".

**Hot spots:** `tests/rules/**` (new file).

## PR 4: views and forms (62 tools)

Branch `claude/mcp-2-4-views`, offset 50, depends on PR 1 (and rebases on PR 2 or 3 if they merge first). Parallel with PR 5.

| Tool                    | Scope                         | Role                                | Input                                                                                         |
| ----------------------- | ----------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `atrium_list_views`     | read                          | any                                 | `boardId`                                                                                     |
| `atrium_get_view_items` | read                          | any                                 | `boardId, view` (id or name), `limit? = 50, offset?`                                          |
| `atrium_create_view`    | write (`add`)                 | shared: editor; personal: any role  | `boardId, name, type, personal? = false, filter?, sort?, groupBy?, hiddenColumns?, settings?` |
| `atrium_update_view`    | write (`change`)              | shared: editor; personal: its owner | `boardId, view, name?, filter?, sort?, groupBy?, hiddenColumns?, settings?`                   |
| `atrium_delete_view`    | write (`change`, destructive) | same                                | `boardId, view`                                                                               |

- `type` is one of `viewTypeSchema` (table, kanban, calendar, timeline, gantt, workload, chart, files, form).
- `filter` is `{ conjunction: 'and' | 'or', conditions: [{ column, operator, value? }] }` (column by id or title, or `name`), `sort` is `[{ column, direction }]`, `groupBy` a column, `hiddenColumns` columns, `personIds` people or teams (PR 1 input forms). Values are converted to the form the web's filter builder stores (`apps/web/src/components/board-filters/AdvancedFilterPopover.tsx` and `filter-store.ts`; for example status by label text): the implementer reads those and writes a converter with one test per column type the builder supports.
- `settings` is the type's own block (`kanban`, `calendar`, ...), starting from the web's defaults for that type (the `default*Settings` helpers in `packages/shared/src/schemas/view.ts` or where the web creates a view: `apps/web/src/data/view-writes.ts`) with column references by title converted to ids. The whole document is checked with `boardViewSchema` before writing, then with the rules' shape (keys, limits) mirrored as in `viewSettingsOk`.
- **Forms:** a `form` view's `settings.form` takes `{ title, description?, questions: [{ column, label?, help?, required? }], thankYou? }`, validated with `formSettingsSchema` (question types limited to `FORM_QUESTION_TYPES`; the name question as the web adds it). The form's link and submissions work as in the web (`getForm`, `submitForm`); submissions are items, read with the item tools. Returns the form's URL path.
- **Reading through a view** applies `personIds`, `filterGroup` and `sortConditions` with the shared `matchesFilter` and `sortItems`, computed columns included (PR 1). Returns items like `atrium_find_items`, plus the view summary.
- **Listing** returns shared views and the actor's own personal views (never another person's), each with a readable summary (condition column titles and value text).
- `main` can't be renamed, moved or deleted (as the rules). The personal or shared state never changes (the rules forbid `ownerId` changes; "make personal" is create plus delete).
- **Delete** returns the deleted view's full definition (readable form) so it can be recreated; the description says so.

**Tests:** create each type with defaults, every filter operator with a converted value per supported type, sort and group, hidden columns by title, personal by a viewer, shared by a viewer refused, another person's personal view invisible and untouchable, main rules, update fields, delete returns the definition; form questions (unknown column, unsupported type, too many); get_view_items matches the web engine on a fixture (same items, same order). Emulator file `tests/rules/src/mcp-views.e2e.test.ts`: a created view passes the real rules when read back by the web client SDK as that user.

**Docs:** `docs/mcp-connector.md` "Views and forms".

**Hot spots:** `tests/rules/**` (new file).

## PR 5: team management (65 tools)

Branch `claude/mcp-2-5-teams`, offset 60, depends on PR 1 (and PR 3 for the queries it reuses). Parallel with PR 4.

| Tool                 | Scope                         | Role                     | Input                                                                           |
| -------------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `atrium_create_team` | write (`add`)                 | workspace owner or admin | `workspaceId?, name, color?, members?` (uids, emails or `"me"`)                 |
| `atrium_update_team` | write (`change`)              | owner or admin           | `workspaceId?, team` (id or name), `name?, color?, addMembers?, removeMembers?` |
| `atrium_delete_team` | write (`change`, destructive) | owner or admin           | `workspaceId?, team, dryRun?, allowDataLoss?`                                   |

- Mirrors `apps/web/src/data/teams-firestore.ts` and the rules' `validTeam`: name 1 to 60, unique in the workspace (case-insensitive, as the dialog checks), color `#RRGGBB` (or a palette name mapped to hex; default the first team palette color the web uses), at most 100 members, only current workspace members. Audit fields as the rules require.
- **Delete guard:** counts active items referencing the team (`assigneeTeamIds array-contains` per board of the workspace). With any, refuses unless `allowDataLoss` ("Team Kids is assigned on 12 items in 3 boards; they would show 'Deleted team'"). `dryRun` returns the counts. The web leaves those cells as "Deleted team" too; the connector doesn't clean them.

**Tests:** role checks (member refused, admin allowed), name uniqueness, limits, non-member uid refused, email members, add and remove, delete guard, dry run, deleted team reads "Deleted team" in a cell. Emulator: add a case to `tests/rules/src/mcp-teams.e2e.test.ts` (PR 1's file).

**Docs:** `docs/mcp-connector.md` "Teams".

**Hot spots:** `tests/rules/**`.

## PR 6: every column type, mirrors in reads, label editing (66 tools)

Branch `claude/mcp-2-6-columns`, offset 70, depends on PR 1.

- **`CREATABLE_COLUMN_TYPES`** adds every registered type except `button` (its actions belong with automations, PR 11): `email, phone, country, location, hour, week, world_clock, color_picker, vote, progress, formula, item_id, auto_number, creation_log, last_updated, board_relation, mirror, dependency, files, time_tracking`. Settings go through the type's `settingsSchema` and the shared validators the web column settings use (`packages/shared/src/columns/column-validation.ts`: formula parse, relation boards, mirror source, the vote cap). `board_relation` boards must be boards the actor can read in the same workspace; `mirror` must name an existing relation column and a column on its linked board. The `onBoardColumnsWritten` trigger maintains the id lists, as for the web.
- **Cell input** for the writable new types: email (`"a@example.com"` or `{ email, text }`), phone (text, country optional), country (ISO code or English name), location (an address text; check the stored shape and refuse coordinates it can't make), hour (`"14:30"`), week (`"2026-W47"` or a date in it), world clock (an IANA zone), color (`#RRGGBB`), connect boards (item ids or exact item names on the linked boards, permission-checked), dependency (item ids or names on the same board, refused when it would make a cycle: the shared `dependency-graph.ts`). Each runs through `toValidCell`.
- **Mirror in reads:** `computeMirror` (`packages/shared/src/columns/mirror.ts`) over linked items, reading only boards the actor can read (a linked board they can't read contributes nothing, as in the web), at most 10 linked boards per call (more: a note in the answer).
- **`atrium_edit_labels`** (write, `change`; board owner): `boardId, column, rename?: [{ from, to }], recolor?: [{ label, color }], order?: [labels], remove?: [labels], dryRun?, allowDataLoss?` for status, dropdown and tags. Colors: palette names or `#RRGGBB` (custom colors, as the web's color wheel stores them). Mirror the web's label editor (`apps/web/src/columns/LabelEditors.tsx`) for ids, indexes, the empty label and what happens to cells holding a removed label. **Guard:** removing a label used by any item refuses unless `allowDataLoss` (the error gives the count per label); `dryRun` reports.

**Tests:** create each new type with its settings (and one invalid settings case each), cell input per type, cycle refusal, relation to an unreadable board refused, mirror read with a hidden linked board, labels rename, recolor, reorder and remove with the guard. Emulator: one case in a new `tests/rules/src/mcp-columns.e2e.test.ts` (create a formula column, then `serverManagedColumnIds` / `derivedColumnIds` are filled by the trigger).

**Docs:** `docs/mcp-connector.md` column list and cell values.

**Hot spots:** `tests/rules/**` (new file).

## PR 7: hosted-only server operations, and files (70 tools)

Branch `claude/mcp-3-1-files`, offset 80, depends on PR 1. Parallel with PR 6.

**Server operations adapter.** `createService({ client, actor, now, serverOps? })`. A tool marked `requires: 'server'` is only registered when `serverOps` is given: the hosted Function passes it, and the stdio server doesn't, so local mode simply doesn't list those tools (owner question 4). `serverOps` is implemented in `functions/src/mcp/server-ops.ts` by calling the **existing** library functions of the callables with their existing Admin store and bucket adapters (`functions/src/lib/file-storage.ts`, `update-files.ts`, `update-attachments.ts`), passing the actor's uid as the caller. No logic is copied; the callables' own tests cover it, and new tests cover the adapter. No new IAM: the `mcp` function runs as the same default runtime service account as the file callables, which already signs URLs (the implementer confirms with `gcloud run services describe mcp --region europe-west1 --format='value(spec.template.spec.serviceAccountName)'` against a file callable and stops to ask the owner if they differ).

| Tool                   | Scope                         | Mode                           | Input                                                         |
| ---------------------- | ----------------------------- | ------------------------------ | ------------------------------------------------------------- |
| `atrium_list_files`    | read                          | both (Firestore metadata only) | `boardId, itemId?, column?, includeUpdates? = true`           |
| `atrium_get_file_link` | read                          | hosted                         | `boardId, itemId, fileId` (Files column or update attachment) |
| `atrium_upload_file`   | write (`add`)                 | hosted                         | `boardId, itemId, column?, name, contentType, dataBase64`     |
| `atrium_delete_file`   | write (`change`, destructive) | hosted                         | `boardId, itemId, column?, fileId`                            |

- `atrium_list_files`: names, sizes, types, who and when, item, column or update; like the Files gallery view.
- `atrium_get_file_link`: a signed GET link from `getSignedDownloadUrl`, valid 5 minutes (the callable's lifetime), with the same role check (`getFileDownloadUrl` / `getUpdateAttachmentUrl` logic). The description says the link expires and is private.
- `atrium_upload_file`: decoded size up to 512 KB (the `/mcp` body limit is 1 MB of JSON; owner question 3), the type and size checks of the column (`isFileAllowed`, `maxFileSizeMb`), the lock check, then the same save path as `requestFileUpload` + `finalizeFileUpload` (the server writes the object directly instead of handing out an upload URL, then runs the finalize logic). File bytes are never logged or audited.
- `atrium_delete_file`: the `deleteFileAttachment` logic. Returns the deleted file's metadata.
- Update attachments can be read and downloaded; posting an update with an attachment is not in this plan.

**Tests:** adapter unit tests with the callables' fakes; tool registration with and without `serverOps` (stdio lists 67 tools at this point, hosted 70: assert both against the catalogue); upload too large, wrong type, locked column, viewer refused; link for an item the actor can't read is "not found". Emulator: upload and link need Storage, which the rules emulator run doesn't start; cover them with the Function's unit tests and an owner check in production instead.

**Docs:** `docs/mcp-connector.md` "Files" and a "Hosted-only tools" note in the comparison table.

**Hot spots:** none.

## PR 8: sharing (71 tools)

Branch `claude/mcp-3-2-sharing`, offset 90, depends on PR 7 (adapter) and PR 2 (docs). **Needs owner question 2 answered first.**

- `atrium_set_access` (write, `change`; hosted): `target: 'board' | 'doc' | 'dashboard', id, kind?: 'main' | 'private' | 'shareable', person?: { who (uid, email or "me"), role: 'owner' | 'editor' | 'viewer' | null }`. Calls the `setBoardAccess`, `setDocAccess` or `setDashboardAccess` library logic (`board-sharing.ts`, `entity-sharing.ts`, `dashboard-sharing.ts`) in its transaction: workspace members only, the role cap from the workspace role, a live owner kept. `dryRun?` returns who would gain or lose access. Removing the actor's own owner role needs `allowDataLoss` (they would lose the object). The read tools gain `access: [{ uid, name, role }]` on boards, docs and dashboards (from the doc itself, no extra rights).

**Tests:** adapter tests for each target, dry run, last-owner refusal message passes through, non-member refused, self-demotion guard.

**Hot spots:** none.

## PR 9: column type change, buttons, time tracking (76 tools)

Branch `claude/mcp-3-3-callables`, offset 10 (reused after PR 1), depends on PR 7.

| Tool                         | Scope             | Role                            | Input                                                         |
| ---------------------------- | ----------------- | ------------------------------- | ------------------------------------------------------------- |
| `atrium_change_column_type`  | write (`change`)  | board owner                     | `boardId, column, toType, settings?, dryRun?, allowDataLoss?` |
| `atrium_revert_column_type`  | write (`change`)  | board owner                     | `boardId, column`                                             |
| `atrium_click_button`        | write (`change`)  | editor (the button's own rules) | `boardId, itemId, column?`                                    |
| `atrium_start_time_tracking` | write (`addOnce`) | editor                          | `boardId, itemId, column?`                                    |
| `atrium_stop_time_tracking`  | write (`addOnce`) | editor                          | `boardId, itemId, column?`                                    |

- Each calls the library behind the callable (`column-type-change.ts`, `column-actions.ts`, the time tracking logic) with the actor's uid.
- **Type change guard:** the dry run uses the shared conversion (`packages/shared/src/columns/convert.ts`) to report how many cells convert, become empty or are lost; the real run refuses on any loss without `allowDataLoss`. The snapshot and revert work as in the web (undo available while the snapshot exists).
- A button's actions run as in the web (automations and notifications included); the description says so.

**Tests:** adapter tests per tool, guard and dry run against a fixture, revert without a snapshot refused, locked column refused, viewer refused.

**Hot spots:** none.

## PR 10: dashboards (82 tools)

Branch `claude/mcp-4-1-dashboards`, offset 20 (reused after PR 2), depends on PR 1 (PR 8 adds sharing). Firestore only, both modes.

| Tool                       | Scope                         | Role                                    | Input                                                                      |
| -------------------------- | ----------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `atrium_list_dashboards`   | read                          | any                                     | `workspaceId?, state?`                                                     |
| `atrium_get_dashboard`     | read                          | any                                     | `dashboardId`                                                              |
| `atrium_create_dashboard`  | write (`add`)                 | owner, admin or member of the workspace | `name, workspaceId?, kind?, boards?, widgets?`                             |
| `atrium_update_dashboard`  | write (`change`)              | owner or editor                         | `dashboardId, name?, boards?, addWidgets?, updateWidgets?, removeWidgets?` |
| `atrium_delete_dashboard`  | write (`change`, destructive) | dashboard owner                         | `dashboardId`                                                              |
| `atrium_restore_dashboard` | write (`addOnce`)             | dashboard owner                         | `dashboardId`                                                              |

- Mirrors `apps/web/src/data/dashboards.ts`: create shape as the rules' `validDashboardCreate`; widgets validated with `dashboardWidgetsSchema` (types chart, numbers, battery, table, workload), column references by title converted to ids per board, layout placed like the web's "add widget" (`DEFAULT_WIDGET_SIZE`, next free row). `boards` are boards the actor can read in the workspace (at most 50). Widgets beyond 24 are refused.
- **Reading** returns the configuration in readable form and, for numbers and battery widgets, the computed value from the boards the actor can read (the shared aggregate helpers the web widgets use; `packages/shared/src/columns/aggregate.test.ts` covers them), so "what's our total spend?" works.
- `removeWidgets` returns the removed widget definitions.

**Tests:** create, each widget type, invalid column, unreadable board refused, update add, update and remove, computed numbers, delete and restore owner-only. Emulator file `tests/rules/src/mcp-dashboards.e2e.test.ts`: a created dashboard reads back through the web client as valid.

**Hot spots:** `tests/rules/**` (new file).

## PR 11: automations (88 tools)

Branch `claude/mcp-4-2-automations`, offset 40 (reused after PR 3), depends on PR 1 and PR 6 (button-style actions). **Needs owner question 1 answered first.**

| Tool                            | Scope                         | Role                  | Input                                                                       |
| ------------------------------- | ----------------------------- | --------------------- | --------------------------------------------------------------------------- |
| `atrium_list_automations`       | read                          | any role on the board | `boardId`                                                                   |
| `atrium_list_automation_runs`   | read                          | board owner (rules)   | `boardId, automation?, limit? = 20`                                         |
| `atrium_create_automation`      | write (`add`)                 | board owner           | `boardId, name, trigger, conditions?, actions, enabled? = false, timezone?` |
| `atrium_update_automation`      | write (`change`)              | board owner           | `boardId, automation, name?, trigger?, conditions?, actions?, timezone?`    |
| `atrium_set_automation_enabled` | write (`addOnce`)             | board owner           | `boardId, automation, enabled`                                              |
| `atrium_delete_automation`      | write (`change`, destructive) | board owner           | `boardId, automation`                                                       |

- Triggers, conditions and actions are taken in a readable form (columns, groups, labels and people by title, name or email) and converted to `automationTriggerSchema`, `automationConditionSchema` and `buttonActionSchema`, then checked with the shared `validateAutomation` (20 per board, 5 scheduled, 3 conditions, the action limits). `runAs` is the actor (the rules allow nothing else on create); an update by another owner keeps `runAs` unless `takeOver: true`.
- Created **disabled** unless `enabled: true` (owner question 1). The description tells the assistant to confirm with the person before enabling one.
- Listing returns each recipe as a readable sentence ("When Status changes to Done, notify Avery") plus its structure; runs return status, reason and time.
- Delete returns the full recipe.

**Tests:** every trigger and action type round trip, limits, invalid references, viewer and editor refused, runAs rules, takeOver, scheduled `nextRunAt` filled by `onAutomationWritten` (emulator file `tests/rules/src/mcp-automations.e2e.test.ts`).

**Hot spots:** `tests/rules/**` (new file).

## Task breakdown (Sonnet-ready)

Each PR starts from fresh `origin/main` in its own worktree (`/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>`, own `ATRIUM_PORT_OFFSET` in `.env.local`), rebases before merging, and resolves the one-line catalogue import conflict if a sibling merged first.

| #   | Branch                       | Offset | Depends on     | Can run beside | Tools after | Hot spots                   | Functions                           | Web          |
| --- | ---------------------------- | ------ | -------------- | -------------- | ----------- | --------------------------- | ----------------------------------- | ------------ |
| 1   | `claude/mcp-2-1-foundations` | 10     | none           | UI work only   | 46          | `tests/rules/**` (new file) | audit target                        | none         |
| 2   | `claude/mcp-2-2-docs`        | 20     | 1              | 3              | 53          | `tests/rules/**` (new file) | none                                | consent copy |
| 3   | `claude/mcp-2-3-my-work`     | 40     | 1              | 2              | 57          | `tests/rules/**` (new file) | none                                | none         |
| 4   | `claude/mcp-2-4-views`       | 50     | 1              | 5              | 62          | `tests/rules/**` (new file) | none                                | none         |
| 5   | `claude/mcp-2-5-teams`       | 60     | 1, 3           | 4              | 65          | `tests/rules/**`            | none                                | none         |
| 6   | `claude/mcp-2-6-columns`     | 70     | 1              | 7              | 66          | `tests/rules/**` (new file) | none                                | none         |
| 7   | `claude/mcp-3-1-files`       | 80     | 1              | 6              | 70          | none                        | `mcp/server-ops.ts`, `mcp/index.ts` | none         |
| 8   | `claude/mcp-3-2-sharing`     | 90     | 2, 7; owner Q2 | 10             | 71          | none                        | `mcp/server-ops.ts`                 | none         |
| 9   | `claude/mcp-3-3-callables`   | 10     | 7              | 11             | 76          | none                        | `mcp/server-ops.ts`                 | none         |
| 10  | `claude/mcp-4-1-dashboards`  | 20     | 1              | 8              | 82          | `tests/rules/**` (new file) | none                                | none         |
| 11  | `claude/mcp-4-2-automations` | 40     | 1, 6; owner Q1 | 9              | 88          | `tests/rules/**` (new file) | none                                | none         |

The "Tools after" column assumes merge order 1 to 11; the counts are informative only (tests read the catalogue). At most two test-heavy agents at once (each runs `pnpm test:rules` with the emulators); a third only for a PR without emulator tests (7, 8, 9).

None touches `firestore.rules`, `firestore.indexes.json`, `packages/shared/**`, `apps/web/src/theme/tokens.css`, `firebase.json`, `pnpm-lock.yaml` or `tests/visual/__screenshots__/**`. If an implementer finds a shared helper must change (for example an export the web keeps private), stop and ask Opus: that becomes its own small `packages/shared` PR merged first.

Each PR: tests first, then the code, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` (needs `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH`; mcp tests run with `--import tsx`), `pnpm build`. The PR description lists the new tools, the Roadmap item, the model that wrote the code and which owner check (below) applies. Update `docs/mcp-connector.md` (tool table, count, the relevant section) in the same PR, and `HANDOFF.md` after the merge.

## What needs the owner

Each question has a recommended default. PRs 1 to 7 and 9 to 10 can be built on the defaults; PRs 8 and 11 wait for answers to questions 2 and 1.

1. **Automations made by an assistant.** May a connected AI create and change board automations (they then run later as you)? **Recommended:** yes, for board owners only, created switched off unless the call says `enabled: true`, and the tool tells the assistant to confirm with you before switching one on.
2. **Sharing.** May a connected AI change who can see or edit a doc, dashboard or board (private, shareable, per-person roles), always limited to people already in the workspace? **Recommended:** yes, with the same checks as the Share dialog (owners only, at least one owner kept). Never invites, workspace roles or removing members.
3. **File size for uploads.** The connector accepts up to 1 MB per request. **Recommended:** uploads up to 512 KB through the connector (photos of a permission slip, a receipt); larger files are uploaded in the app. Raising the limit later is a one-line change, but it lets every request be larger.
4. **Hosted-only tools.** Files links and uploads, sharing, column type change, buttons and time tracking need server logic that only the hosted connector has. **Recommended:** the local stdio server simply doesn't offer them (it's for development); no extra work to bring them there.
5. **Notifications.** **Recommended:** the AI may read your notifications and mark them read, never delete them.
6. **Teams.** **Recommended:** workspace owners and admins may create, change and delete teams through the AI (the same rule as the app). Deleting a team that is assigned anywhere needs an explicit confirmation.
7. **Hard deletes the app allows** (a view, a team, a file, an automation). **Recommended:** allowed, marked destructive, and each answer returns the full deleted definition so it can be recreated (files: metadata only; the bytes are gone).
8. **Order.** OPS4 section 14 planned column types, then files, then views, dashboards and automations. **Recommended:** the order above instead: docs, teams and the read fixes first (what a family asks for most), then views, then the rest.
9. **Scopes and limits.** **Recommended:** keep the two scopes (Read, Write) and the limits (60 a minute, 2,000 calls and 500 writes a day). No reconnect is needed; the consent page wording gets updated.

Opus puts these on the Roadmap item as one update with Actionable = Yes.

## Acceptance checklist

- [ ] PR 1: calculated columns show their values in `atrium_get_board`; a team can be assigned by name and reads back with its name; member names come from member docs; the catalogue split changes no tool; count tests read the catalogue.
- [ ] PR 2: "Write a packing list doc with a table and mention Sam" creates a doc that opens in the web, with the table and a mention chip, and Sam gets one notification; a second write bumps `rev`; editing over images is refused without `allowOverwriteRich`.
- [ ] PR 3: "What's on my plate this week?" lists items assigned to me and to my teams; search finds an item, a board and a doc; notifications list and mark read.
- [ ] PR 4: a view created by the AI shows in the web with the same filter, sort and grouping; `atrium_get_view_items` returns the same items as the web view; a form created by the AI accepts a submission.
- [ ] PR 5: teams can be created and changed by an admin, refused for a member; deleting an assigned team needs `allowDataLoss`.
- [ ] PR 6: every column type can be created and holds a value; mirror columns read; labels rename, recolor, reorder, and removing a used one needs `allowDataLoss`.
- [ ] PR 7: hosted lists 4 file tools, stdio lists only `atrium_list_files`; a 300 KB image uploads into a Files column and its link opens; a 600 KB upload is refused with a clear message.
- [ ] PR 8: a doc is made private to two people with a dry run first; removing the last owner is refused.
- [ ] PR 9: a type change previews its losses, refuses without `allowDataLoss`, and can be reverted; a button click runs its actions; a timer starts and stops.
- [ ] PR 10: a dashboard with a numbers widget is created and shows the same total in the web.
- [ ] PR 11: an automation is created switched off, switched on after confirmation, and its run shows in the run history.
- [ ] After every PR: `docs/mcp-connector.md` matches the catalogue, `HANDOFF.md` and the Roadmap item are current, and no tool writes a field listed under "Never written by the connector".

## What Ophelia (Opus) reviews

- Every write is one the rules (or the callable) allow to that role, and the role check is the same function the reads use.
- Shared helpers are reused, not copied; hosted-only tools call the callables' library functions.
- Every guard's dry run equals the real run's report; nothing is dropped silently.
- Untrusted text is marked; no file bytes, doc text or tokens in logs or the audit.

## Owner checks (production, through Claude)

1. "Write a doc called Packing list with a table of what each of us brings, and mention Sam." Open it in Atrium.
2. "Assign the Kids team to Take out the trash." The cell shows the team and its members get a notification.
3. "What's on my plate this week?" and "Mark my notifications as read."
4. "Make a Kanban view of the Chores board grouped by status, only items for the Kids."
5. (Batch 3) "Attach this photo to the Permission slips item." Then "Give me a link to it."
6. (Batch 4) "Make a dashboard with the total of the Budget column." and "Add an automation that notifies me when a chore is done", which is created switched off and switched on after you confirm.

## Risks

- **Many tools.** 88 tools make a long list for the assistant. Descriptions stay short. If tool choice gets worse, a later PR can merge pairs (for example archive, delete and restore into one lifecycle tool per object) without changing behavior.
- **Markdown round trip.** Docs can hold things markdown can't (images, colors, emoji); the rich guard and `append` keep them safe, and `allowOverwriteRich` is explicit.
- **Concurrent editing.** The connector can't merge with someone typing in the doc; the `rev` precondition and the recent-edit guard make that a refusal instead of a silent overwrite.
- **Web drift.** Several PRs mirror web code that mcp-core can't import (doc creation, view defaults, filter values, widget layout). Each has a test that builds the connector's document and checks it with the shared schema and the rules' shape, so a web change that breaks the mirror fails loudly. Where possible the implementer moves such a helper into `@atrium/shared` in a separate small PR rather than copying it.
- **Server operations widen the hosted function.** It now writes Storage objects. Same service account and same library code as the callables; uploads are capped; bytes are never logged.
- **Reads per call.** My Work and search read up to 100 boards per call (as the web does). The per-call Firestore cost is bounded by the board cap; the usage limits are per call.
