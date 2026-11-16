# MCP gap batch 1a: restore, move, reorder, likes, find a person

Part of OPS4 spec section 14, step 1. Six new tools, written once in `@atrium/mcp-core` (`tools.mjs`, `service.mjs`), so the local stdio server and the hosted Function both get them (25 tools become 31). No change to `packages/shared`, `firestore.rules` or the web app. Later slices of batch 1 (column reorder and lock, board lifecycle, `atrium_find_items`, move to another board, votes) are separate PRs.

## Permission model

Same actor model as the existing tools: every call runs as one user, a board outside their workspaces reads as "not found", and the connector mirrors the rules.

| Tool                                          | Scope | Board role | Notes                                                                                                           |
| --------------------------------------------- | ----- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `atrium_restore_item`                         | write | editor     | Rules let editors write `state`; restoring is the inverse of archive and delete.                                |
| `atrium_move_item`                            | write | editor     | Same fields `atrium_update_item` writes when it moves a group (`groupId`, `position`).                          |
| `atrium_reorder_groups`                       | write | owner      | Board `groups` change, like add, rename and delete group. Goes through `mutateBoard` (precondition, one retry). |
| `atrium_like_update` / `atrium_unlike_update` | write | editor     | Rules: only the caller's own uid may enter or leave `likes`, and only editors write updates.                    |
| `atrium_find_member`                          | read  | any        | Looks only inside the workspace's `memberIds`.                                                                  |

No activity or notification documents are written (Functions-only), as for the existing tools.

## Tools

### `atrium_restore_item` `{ boardId, itemId }`

Item or subitem in state `archived` or `deleted` goes back to `active` (`deletedAt` null). Refuses an item that is already active. A subitem needs an active parent ("Restore the parent first"). For a top-level item, its subitems in the same state come back with it (as archive and delete take them along). If the item's group no longer exists on the board it lands in the first group. Returns `{ id, restoredFrom, group, subitemsAlso }`.

### `atrium_move_item` `{ boardId, itemId, group?, position?, beforeItemId?, afterItemId? }`

Moves an active item to a group (id or title; default the item's own group) and a place in it: `position` `"first"` or `"last"` (default `"last"`), or right before or after another item of the target group (`beforeItemId` or `afterItemId`; at most one of the three placements). A new fractional position is computed between the neighbours (`generateKeyBetween`); other items are untouched. Subitems follow their parent into a new group. A subitem keeps its parent's group and can only be placed among its siblings (`group` is refused). Returns `{ id, group, position }`.

### `atrium_reorder_groups` `{ boardId, groups: string[] }`

`groups` lists every group of the board (id or title) once, in the wanted order; a missing, unknown or repeated group is refused. Positions are rewritten with `generateNKeysBetween`. Needs the owner role. Returns the new order.

### `atrium_like_update` / `atrium_unlike_update` `{ boardId, itemId, updateId, replyId? }`

Adds or removes the caller's uid in `likes` of an update, or of a reply when `replyId` is given. Read-modify-write of the `likes` array with an `updateTime` precondition (retried once), because the clients have no array-union op; adding a like that exists or removing one that does not is a no-op (`changed: false`). Returns `{ id, liked, likes, changed }`.

### `atrium_find_member` `{ email, workspaceId? }`

Case-insensitive exact match of `email` against the profiles of the workspace's members only (`workspaceId` optional as for `atrium_list_members`). Returns `{ found: true, member: { uid, name, email, workspaceRole } }` or `{ found: false }`. A person who is not a member gets the same answer as an address that is not in Atrium at all, so the tool cannot be used to probe who has an account. No partial matches.

## Tests

- `packages/mcp-core/src/mcp-core.test.mjs`, against the fake client: restore from archive and trash (subitems along, parent-first rule, missing group fallback, already active, viewer refused); move between groups, first, last, before, after, subitem siblings, validation errors; reorder groups (full list, duplicates, unknown, non-owner); like and unlike (idempotent, replies, viewer refused, precondition retry); find member (hit, case, non-member, non-existent give the same answer, no workspace leak). Catalogue test: 31 tools, scopes and annotations.
- Stdio tool list (`scripts/mcp/stdio.test.mjs`), hosted tool count (`functions/src/mcp/app.test.ts`, `tests/rules/src/mcp-function.e2e.test.ts`).
- Admin client: the new tools use only existing write ops (`update` with `set` and `updateTime` precondition), so `functions/src/mcp/admin-client.ts` needs no change; the emulator e2e `tests/rules/src/mcp-admin-client.e2e.test.ts` gets a likes case to prove the array write and precondition against Firestore.
