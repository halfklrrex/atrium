# MCP batch 2 PR 1: read fixes, teams in People cells, foundations

Branch `claude/mcp-2-1-foundations`. Implements PR 1 of `docs/specs/MCP-gap-batch-2.md` (46 tools). No changes to rules, indexes, `packages/shared`, `firebase.json`, the lockfile or visual baselines.

## What changed

- **Calculated columns in reads.** `readableCell(column, value, ctx)` computes derived types with `columnRegistry.computeValue` (as `cellValue` in the filter engine) and shows `toText`. Used by `atrium_get_board`, `atrium_find_items` (`where` matches the computed text) and `atrium_list_subitems`. Mirror stays empty and, like server-managed columns, can't be used in `where`.
- **Teams in People cells.** Input `"team:<name or id>"` or `{ team }` (case-insensitive; unknown team lists the names; duplicate names need the id). Written as `{ id, kind: 'team' }`. A `singlePerson` column holds one entry of either kind (two entries are refused). Reads show `[{ id, kind, name }]`; a deleted team reads "Deleted team", a person without a member doc `name: null`. `find_items` `equals` matches an id or a name. New tool `atrium_list_teams`.
- **Members from member docs.** `workspaces/{ws}/members/{uid}` (one list read per call) replaces `users/{uid}` for other people; only the actor's author profile and `verify()` read `users/{actor}`. `list_members` and `find_member` add `title`, `location`, `timeZone` when set.
- **Module split.** `tools/<domain>.mjs` (boards, items, updates, members) listed in `DOMAINS` in `tools.mjs`; `service/<domain>.mjs` receive the helpers object built in `createService`. The original 45 tools keep their order through `LEGACY_ORDER` (domain arrays can't be concatenated into the old interleaved order); new tools follow in `DOMAINS` order. `tools-snapshot.json` + `tools-parity.test.mjs` pin names, order, scope, annotations, descriptions and schemas (only the `cellValues` description changed, deliberately).
- **Count tests read the catalogue** (`toolNamesByDomain`); the parity test asserts one name list per domain file.
- **`runQuery(collectionPath, where, options)`**: nested paths, `arrayContainsAny` (1 to 30), `limit`, `orderBy` without filters. Admin adapter, REST client, fake client, `index.d.mts`.
- **Audit target.** `auditTarget()` records `targetKind` and `targetId` (first of `boardId`, `docId`, `dashboardId`, `teamId`, `viewId`); `boardId` is kept.

## For the next PRs

- Add a tools file and a service file, one import line each (`DOMAINS`, `createService`), and the new names to `DOMAIN_TOOLS` in `tools-parity.test.mjs`. Regenerate nothing in the snapshot unless an existing tool changes on purpose.
- Helpers available to service modules: `loadBoard`, `membership`, `roleOn`, `memberProfiles(ws)`, `teamsOf(ws)`, `memberName`, `sharedProfile`, `readContext`, `readCell`, `readValues`, `itemsOf`, `loadItem`, `iso`.
- The consent page copy (`ConnectPage.tsx`, `SCOPE_COPY`) is still the old text; spec assigns it to PR 2.
- Emulator test: `tests/rules/src/mcp-teams.e2e.test.ts` (PR 5 adds a case).
