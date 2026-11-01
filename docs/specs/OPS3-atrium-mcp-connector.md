# OPS3: Atrium MCP connector (local, stdio)

**Goal (owner request, 2026-11-01):** the easiest thing that lets Claude create and edit boards, groups, columns, items and updates in the live Atrium (`atrium-board` / `atrium-1`), so the owner can start a real project now.

## Approach

A local MCP server (stdio) in the repo: `scripts/mcp/atrium-mcp.mjs`. Nothing is deployed. It reuses what the showcase seeder already proved:

- `scripts/showcase/firestore-rest.mjs` (`createFirestoreRest`) with `gcloud auth print-access-token` (no key files, no ADC), production origin `https://firestore.googleapis.com`, project `atrium-board`, database `FIRESTORE_DATABASE_ID`.
- Documents are built with the zod schemas in `@atrium/shared` (`boardSchema`, `columnDefSchema`, `groupDefSchema`, `itemSchema`, `itemUpdateSchema`) and cell values go through `columnRegistry.validateCell` before every write, so the server cannot write data the web app would reject.
- Run through `tsx` (same as `pnpm showcase`) so it can import the TypeScript in `@atrium/shared`.

Admin-style writes bypass security rules, so the server enforces the rules itself (see Safety). The Cloud Function triggers (`onItemCreated` assigns `seq`/`boardSeq`, `onBoardColumnsWritten` maintains `derivedColumnIds` / `serverManagedColumnIds`) fire on these writes like on any other.

## Configuration (env, never committed)

| Variable              | Meaning                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATRIUM_WORKSPACE_ID` | The one workspace the server may touch (required).                                                                                                                                            |
| `ATRIUM_USER_UID`     | The Atrium user the writes are attributed to (`createdBy`, `updatedBy`, board owner). Must be a non-viewer member of the workspace; checked at startup (`workspaces/{id}` roles / `members`). |
| `ATRIUM_PROJECT`      | Default `atrium-board`.                                                                                                                                                                       |
| `ATRIUM_DATABASE`     | Default `FIRESTORE_DATABASE_ID`.                                                                                                                                                              |
| `ATRIUM_EMULATOR`     | If set (`host:port`), use the emulator with the `Bearer owner` token, for tests.                                                                                                              |

No ids in the repo (privacy rule). Registration is per machine, by the owner: `claude mcp add atrium --scope local -e ATRIUM_WORKSPACE_ID=... -e ATRIUM_USER_UID=... -- pnpm --silent --dir D:\DevProjects\Atrium\atrium-cl exec tsx scripts/mcp/atrium-mcp.mjs`. Document this in `docs/mcp-connector.md` with placeholders.

## Tools (v1)

Names use the `atrium_` prefix. Every tool returns compact JSON; columns are addressed by **id or title** (case-insensitive, must be unambiguous), groups by id or title, so Claude never needs raw slugs.

Read:

1. `atrium_list_boards`: id, name, kind, state, item count not needed. Only boards in the workspace where `accessUids` contains the configured uid and `state = active`.
2. `atrium_get_board(boardId, includeItems = true, limit = 200)`: columns (id, title, type, settings summary; status/dropdown labels listed), groups, items (id, `seq`, name, group, values keyed by column **title** in a readable form). Active items only; subitems nested under their parent.

Write (boards and structure): 3. `atrium_create_board(name, description?)`: same document as `firestore.ts` `createBoard` (default structure from `defaultBoardStructure`, access `{uid:'owner'}`, `derivedColumnIds: []`, `serverManagedColumnIds: []`), position after the last root board, **without** sample items. 4. `atrium_add_group(boardId, title, color?)`, `atrium_rename_group`, `atrium_delete_group` (refuse if it still has active items). 5. `atrium_add_column(boardId, title, type, settings?)`: allow-list of simple types only: `text`, `long_text`, `numbers`, `status` (labels array of `{label,color}`; assign `index`/`id` like the web), `dropdown`, `date`, `timeline`, `checkbox`, `link`, `people`, `tags`, `rating`. Settings start from `columnRegistry.defaultSettings(type)`. Refuse derived/server-managed types in v1. 6. `atrium_update_column_settings(boardId, column, settings)`: for adding status/dropdown labels. Never change a column's `type` and never remove a label that items use.

Write (items): 7. `atrium_create_items(boardId, items[])`: up to 50 per call; each `{name, group?, values?: {<column>: value}}`. Appends to the group (position via `fractional-indexing` `generateKeyBetween` after the last item of that group). `parentItemId` is `null`; v1 has no subitems. 8. `atrium_update_item(boardId, itemId, {name?, group?, values?})`: **field-path patch** (`values.<colId>`), never the whole `values` map (AGENTS.md). `null` clears a cell. Sets `updatedAt` / `updatedBy`. 9. `atrium_archive_item` / `atrium_delete_item` (soft delete: `state: 'deleted'`, `deletedAt`, like the web; never a hard delete). 10. `atrium_add_update(boardId, itemId, text)`: an item update in the item's feed (`boards/{b}/items/{i}/updates/{id}`), built with `itemUpdateSchema`, bumping `updatesCount`. Look at `apps/web/src/data/updates.ts` for the exact document and counter handling.

Cell value helpers (so Claude can write plain values): status accepts a label text or `{index}`; dropdown/tags accept label texts; date accepts `YYYY-MM-DD`; people accepts nothing but the configured uid or emails of workspace members (v1: may be left out if the shape is awkward, and say so in the tool description); everything else is the column type's native JSON. Convert to the stored shape, then `columnRegistry.validateCell`. Surface the validator's message on failure.

## Safety

- Reads and writes are limited to `ATRIUM_WORKSPACE_ID`: every tool first loads the board and checks `board.workspaceId`, `state = active`, and the configured uid in `board.access` with role `owner` or `editor` (structure changes need `owner`). Refuse otherwise with a plain message.
- Structure changes (columns, groups) use a commit with an `updateTime` precondition on the board doc (read, change, write; retry once on 409), matching the transaction rule in AGENTS.md.
- Never write `derivedColumnIds`, `serverManagedColumnIds`, `seq`, `boardSeq`, `descriptionImages`, notifications or `activity`. Never write to `values.<derived or server-managed column>`.
- No hard deletes anywhere. No tool touches folders, workspaces, members, roles, invites or other users' data.
- Tool inputs are zod-validated; ids must match `/^[A-Za-z0-9_-]{1,128}$/`.
- Every tool description says what it changes; write tools are additive or soft-delete only.

## Tests (no production access in tests)

`scripts/mcp/atrium-mcp.test.mjs`, run by `pnpm test` (add to the `node --import tsx --test` glob in root `package.json`):

- Unit tests on the pure builders (board doc, group/column creation, value conversion, position generation, field-path patches) with a fake `createFirestoreRest`-shaped client.
- Guard tests: wrong workspace, viewer role, non-active board, derived column write, unknown/ambiguous column title.
- One emulator end-to-end test only if it is cheap with the existing emulator scripts (`scripts/e2e-membership.mjs` is the pattern); otherwise skip and say so.

Structure the code as `scripts/mcp/lib/*.mjs` (pure logic, tested) plus a thin `atrium-mcp.mjs` that wires tools to the MCP SDK.

## Dependencies and licences

Add `@modelcontextprotocol/sdk` (MIT) and `fractional-indexing` (CC0, already used by the web app; reuse the same version) to the root `devDependencies`. Run `pnpm licenses:notices` and commit `THIRD_PARTY_NOTICES.md`; `pnpm licenses:check` must pass. `pnpm-lock.yaml` is a hot-spot file: keep the PR small.

## Docs

`docs/mcp-connector.md` (setup, env vars with placeholders, tool list, safety, how to re-register), a one-line pointer in `docs/architecture.md` or `HANDOFF.md`, and a handoff note in `docs/handoff/`.

## Acceptance

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm licenses:check` pass.
- Started with the env vars, the server lists its tools over stdio (a test spawns it with the emulator or a stub and calls `tools/list`).
- Dry-run safe: with no `ATRIUM_WORKSPACE_ID` it exits with a clear message and writes nothing.
- Branch `claude/atrium-mcp-connector`, PR to `main`, rebase merge. Roadmap item: "OPS3 Atrium MCP connector" (Agent: Claude, Branch set, Status Building).
