# MCP gap batch 1c: votes, board lifecycle, templates, move an item to another board

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Part of OPS4 spec section 14, step 1, and the last slice of batch 1 after `MCP-gap-batch-1.md` (1a, 31 tools) and `MCP-gap-batch-1b.md` (1b, 37 tools) · Status: spec, nothing built

New tools are written once in `@atrium/mcp-core` (`tools.mjs`, `service.mjs`, `builders.mjs`, `values.mjs`), so the stdio server and the hosted Function both get them. Same actor model: one user per call, a board outside their workspaces reads as "not found", roles mirror the rules. No activity or notification documents are written (Functions only).

## What is left of batch 1, and where each part lands

| Gap (OPS4 section 14, step 1)     | Status after 1b                                          | This batch                                                                           |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Restore, move, reorder            | done (1a, 1b)                                            | none                                                                                 |
| Likes                             | done (1a)                                                | none                                                                                 |
| People by email                   | `atrium_find_member` done (1a)                           | people cells also accept a member's email (small, PR 1)                              |
| REQ-1 in `updateItem`             | done                                                     | none                                                                                 |
| Column update, delete, lock       | done (1b)                                                | none                                                                                 |
| `atrium_find_items`               | done (1b)                                                | none                                                                                 |
| **Votes**                         | open; `update_item` passes vote values through untouched | vote and unvote tools; `update_item` refuses raw vote values (PR 1)                  |
| **Board lifecycle**               | create only                                              | rename, archive, trash, restore; list by state (PR 1); create from a template (PR 2) |
| **Move an item to another board** | open                                                     | copy and retire, same workspace, with a dry run and a data-loss guard (PR 3)         |

## Safe without rules or schema changes, and what needs an amendment

Everything below uses writes the rules already allow to the same role, so none of the three PRs touches `firestore.rules`, `packages/shared`, `firebase.json`, `tokens.css` or the visual baselines.

| Tool or behaviour                       | Why it is safe today                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vote and unvote                         | Editors write `values.<voteColumnId>` (the web's `VoteCell` does exactly this). The tools only add or remove the caller's own uid.                         |
| Rename board                            | `validBoardUpdate` lets editors change `name` and `description`.                                                                                           |
| Archive, trash, restore board           | `state` and `deletedAt` are owner-only in the rules; the tools need the owner role. Same fields as the web's `setBoardState`. Purge stays server-side.     |
| Create from a template                  | Board create and item create rules as for `atrium_create_board` and `atrium_create_items`; template reads are member reads of `workspaces/{ws}/templates`. |
| Move to another board (copy and retire) | An item create on the target (editor) and an item `state` change on the source (editor), as `duplicate_item` and `delete_item` already do.                 |

**Needs a spec amendment or another PR first (not in this batch):**

1. **Vote integrity in the rules.** The rules don't check that a write to a vote column only adds or removes the writer's own uid, so any editor (web or connector) could rewrite `votersIds`. The MCP tools never do, but the fix belongs in `firestore.rules` and `tests/rules/**` (a SEC item; hot spots). Opus logs it on the Roadmap.
2. **A faithful move.** Keeping `createdAt`, `createdBy` and the item number (`seq`), copying the updates and replies, and copying the Storage objects of files columns all need a Cloud Function (the rules require `createdAt == request.time`, and files columns are server-managed). That is a web feature too (monday's "Move to board"), so it should be specced once as a callable that both the web and the connector call. Until then the MCP move is "copy and retire".
3. **Moving across workspaces: deferred.** The owner is fine with it in principle but sees no use case yet (2026-11-16), so don't build it by default. It would need: an editor check on both workspaces' boards (already the rule); people values filtered to members of the target workspace (others reported as dropped); vote `votersIds` filtered the same way; connect-boards and mirror values dropped (their links are workspace-scoped); and a test per case. No rules change. Add it only when the owner asks, as a `crossWorkspace` path in the same tool.
4. **Permanent board deletion** stays with the scheduled purge (30 days in the trash).
5. **Duplicating a board** (the web's `duplicateBoard`) is a natural next tool but wasn't in the gap list; add it in batch 2 if wanted.

## Tools

Count: 37 now, 45 after PR 3 (PR 1: 43, PR 2: 44).

| Tool                            | Scope | Role on the board                      | Input                                                                          | PR  |
| ------------------------------- | ----- | -------------------------------------- | ------------------------------------------------------------------------------ | --- |
| `atrium_vote_item`              | write | editor                                 | `boardId, itemId, column?`                                                     | 1   |
| `atrium_unvote_item`            | write | editor                                 | `boardId, itemId, column?`                                                     | 1   |
| `atrium_rename_board`           | write | editor                                 | `boardId, name?, description?` (at least one)                                  | 1   |
| `atrium_archive_board`          | write | owner                                  | `boardId`                                                                      | 1   |
| `atrium_delete_board`           | write | owner                                  | `boardId` (to the trash; `destructiveHint: true`)                              | 1   |
| `atrium_restore_board`          | write | owner                                  | `boardId`                                                                      | 1   |
| `atrium_list_boards` (changed)  | read  | as today                               | `workspaceId?, state?: 'active' \| 'archived' \| 'deleted'` (default `active`) | 1   |
| `atrium_list_templates`         | read  | workspace member                       | `workspaceId?`                                                                 | 2   |
| `atrium_create_board` (changed) | write | workspace owner, admin or member       | adds `templateId?`, `includeSampleItems?` (default `true`)                     | 2   |
| `atrium_move_item_to_board`     | write | editor on the source and on the target | `boardId, itemId, targetBoardId, group?, dryRun?, allowDataLoss?`              | 3   |

### Votes (PR 1)

- `column` is a vote column's id or title; it may be left out when the item's columns (`columnsForItem`, so subitems work) have exactly one vote column. Zero or several give a clear error listing the vote columns.
- Read-modify-write of `values.<col>.votersIds` with an `updateTime` precondition, retried once (the likes pattern). Field-path write only. Voting twice or unvoting without a vote is a no-op (`changed: false`).
- A locked column (`columnLocks`) refuses a non-owner, as `canEditColumn` does.
- Returns `{ itemId, column, votes, voted, changed }`.
- `convertCellValue` gets a `vote` case that throws `McpUserError("Use atrium_vote_item or atrium_unvote_item for vote columns.")`, so `atrium_update_item` and `atrium_create_items` can no longer write someone else's vote. `readableCell` shows the count (check it does).
- **People by email:** in `values.mjs` `people()`, an entry containing `@` is matched case-insensitively against the workspace members' profile emails (the lookup `atrium_find_member` uses); no match gives the same error as an unknown uid, so it can't probe accounts. The "Emails are not supported yet" text goes.

### Board lifecycle (PR 1)

- `loadBoard` gets an option `{ states: ['active', 'archived', 'deleted'] }`; the default stays active-only so every other tool keeps refusing inactive boards.
- `atrium_rename_board`: name trimmed, 1 to 120 characters; description up to the board schema's limit. Uses a `mutateBoard` variant with the `edit` role (today `mutateBoard` requires the owner). Returns `{ id, name, description, was }`.
- `atrium_archive_board`: `active` to `archived`, `deletedAt: null`. Refuses a board that isn't active.
- `atrium_delete_board`: `active` or `archived` to `deleted`, `deletedAt` now. The description says "moves the board to the trash; it is purged after 30 days". Refuses a board already in the trash.
- `atrium_restore_board`: `archived` or `deleted` to `active`, `deletedAt: null`. If `folderId` points to a folder that no longer exists, set it to `null` (check what the web's restore does and match it). Items keep their own states.
- All four write `updatedAt`, `updatedBy` with an `updateTime` precondition and return `{ id, name, state, was }`.
- `atrium_list_boards` with `state` lists that state only, with the same visibility rule as today.

### Templates (PR 2)

- `atrium_list_templates`: the built-ins (`BUILT_IN_TEMPLATES` from `@atrium/shared`) then the workspace's saved templates (`workspaces/{ws}/templates`). Each: `{ id, source: 'built-in' | 'workspace', name, description, columns: [{ title, type }], groups: [title], sampleItems: n }`.
- `atrium_create_board` with `templateId`: the id is looked up in the built-ins first, then in the workspace's templates. `buildBoardDoc` gets an optional `structure` (columns run through `withoutServerColumnFields` from `@atrium/shared`, as the web's `createBoardFromTemplate` does); `derivedColumnIds`, `serverManagedColumnIds` and `requiredColumnIds` stay `[]` (the trigger fills them). Sample items go in a **second** commit after the board exists, with fractional positions per group and values validated through `toValidCell`; derived and server-managed values are skipped. Mirror the web (`apps/web/src/data/firestore.ts` `createBoardFromStructure`), field for field. Returns the current result plus `{ template, sampleItems }`.

### Move an item to another board (PR 3)

`atrium_move_item_to_board { boardId, itemId, targetBoardId, group?, dryRun? = false, allowDataLoss? = false }`

- **Scope:** an active top-level item; a subitem is refused ("Move its parent instead"). Source and target must be different, active boards in the **same workspace** (cross-workspace is deferred, see amendment 3; refuse it with "Moving to another workspace isn't supported yet."), and the caller must be an editor on both (the target is "not found" otherwise).
- **Target group:** `group` (id or title) on the target; default the target's first group. Placed last in that group.
- **Column mapping**, per source column with a non-empty value, using `columnsForItem` on each side:
  1. same column id and same type on the target, else
  2. exactly one target column with the same title (case-insensitive) and the same type, else dropped (`no matching column`).
  3. The value is turned into its readable form (`readableCell`) and back through `toValidCell` on the target column, so status, dropdown and tags map by label text. A label missing on the target is dropped (`label "X" not on the target`); the tool never creates labels.
  4. Always dropped: derived columns (nothing stored), server-managed columns (`files`, `time_tracking`, `button`: `cannot be copied yet`), `dependency` (points at source-board items), and target columns locked for a non-owner.
  5. A vote value keeps its `votersIds`; people values keep members (same workspace).
- **Subitems:** active subitems move with the parent, mapped against the target's subitem columns the same way. Cap 200 subitems (one commit of at most 500 writes); above that the tool refuses.
- **Retire:** the source item and its moved subitems go to the trash (`state: 'deleted'`, `deletedAt` now), the same write as `atrium_delete_item`. Their updates, replies and files stay there and come back with `atrium_restore_item` until the 30-day purge.
- **Data-loss guard:** if anything non-empty would be dropped, or the item has updates, the tool refuses unless `allowDataLoss: true`, and the error lists the dropped columns, the files count and the updates count. `dryRun: true` never writes and returns the same report.
- **One commit:** the target item, its subitems and the source state changes are one `client.commit` (preconditions: target docs `exists: false`, source docs `updateTime`).
- Returns `{ newItemId, targetBoardId, group, copied: [{ from, to }], dropped: [{ column, reason }], subitems, updatesLeftOnSource, sourceState: 'deleted', dryRun }`.
- The tool description says plainly that the new item is a copy (new id and number, created now by the caller), that updates and files stay with the trashed original, and that board automations on the target see a new item.

## Tests

`packages/mcp-core/src/mcp-core.test.mjs`, against the fake client, one block per tool: allowed, forbidden (viewer; owner-only tools also refuse an editor), not found (non-member board), plus:

- Votes: add, idempotent repeat, remove, subitem, column inference with zero and two vote columns, locked column, precondition retry; `update_item` refuses a raw vote value; people by email (hit, case, non-member and unknown give the same error).
- Lifecycle: each transition and each refused transition, inactive boards still refused by other tools, `list_boards` per state, restore with a missing folder.
- Templates: list built-ins and saved; create from each kind with and without sample items; server-column fields stripped; derived sample values skipped; unknown template id.
- Move: id match, title match, label text mapping, missing label, every always-dropped kind, guard refuses then `allowDataLoss` passes, `dryRun` writes nothing, subitems along, cap, other workspace refused, viewer on the target gets not found, subitem refused, commit contents.
- Catalogue: count and scopes per PR (43, 44, 45), annotations (`destructiveHint` on delete board and move).

Elsewhere:

- `scripts/mcp/stdio.test.mjs` and `functions/src/mcp/app.test.ts`: the tool count.
- `tests/rules/src/mcp-function.e2e.test.ts`: in PR 1, replace the literal count (`toHaveLength(37)`) with the length of the mcp-core catalogue so later batches don't edit `tests/rules/**`. Add one e2e case per PR against the emulator: vote write (PR 1), create from a built-in template with sample items (PR 2), a move in one commit (PR 3), through `tests/rules/src/mcp-admin-client.e2e.test.ts`.
- `packages/mcp-core/src/index.d.mts` count comment, `docs/mcp-connector.md` tool list.

## Task breakdown (Sonnet-ready)

Each PR starts from fresh `origin/main` in its own worktree (`/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>`, own `ATRIUM_PORT_OFFSET`). Merge in order; each rebases on the previous one (they all edit `tools.mjs`, `service.mjs` and the count tests).

| #   | Branch                        | Offset | Depends on | Hot spots touched                                   |
| --- | ----------------------------- | ------ | ---------- | --------------------------------------------------- |
| 1   | `claude/mcp-1c-votes-boards`  | 10     | none       | `tests/rules/**` (count assertion and one e2e case) |
| 2   | `claude/mcp-1c-templates`     | 20     | PR 1       | `tests/rules/**` (one e2e case)                     |
| 3   | `claude/mcp-1c-move-to-board` | 40     | PR 2       | `tests/rules/**` (one e2e case)                     |

None touches `firestore.rules`, `packages/shared/**`, `apps/web/src/theme/tokens.css`, `firebase.json`, `pnpm-lock.yaml` or `tests/visual/__screenshots__/**`. They can run beside UI work; only another PR editing `tests/rules/src/mcp-*.e2e.test.ts` or `packages/mcp-core` needs ordering.

Each PR: tests first for the new tools, then the code, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` (needs `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH`; mcp tests run with `--import tsx`), `pnpm build`. The description lists the new tools, the Roadmap item and the model that wrote the code.

## What Ophelia (Opus) reviews

- Every write is one the rules already allow to that role; no tool writes `derivedColumnIds`, `serverManagedColumnIds`, `requiredColumnIds`, `seq`, activity or notifications.
- Votes only ever touch the caller's uid; `update_item` can't write votes.
- Inactive boards stay closed to every tool except the lifecycle ones and `list_boards`.
- The move report is complete: nothing is dropped silently, and `dryRun` matches the real run.

## Owner checks (production, through Claude)

1. "Vote for item X on board Y" then "remove my vote": the count changes in the web app.
2. "Archive board Y", then "list my archived boards", then "restore it".
3. "Create a board from the Bug tracker template": columns, groups and sample items appear.
4. "Move item X to board Z" first answers with what would be lost; confirm, and the item shows on Z while the original is in Y's trash.

## Risks

- **The move is lossy by design.** The guard and the dry run make that visible; the faithful move is amendment 2.
- **Template drift.** PR 2 copies the web's template path into `builders.mjs`. mcp-core can't import web code, so a test builds every built-in template and checks it against `boardSchema` and `itemSchema` plus the web's invariants (server-column fields stripped, the three id lists empty, sample items in existing groups). A later template change then fails loudly instead of diverging.
- **Rules gap on votes** (amendment 1) is real today for the web too; this batch doesn't widen it.
- **Count churn in `tests/rules/**`** stops after PR 1 (the e2e reads the catalogue length).
