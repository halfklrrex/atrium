# MCP gap batch 1b: column management and item search

Part of OPS4 spec section 14, step 1. Six new tools in `@atrium/mcp-core` (31 tools become 37), so stdio and the hosted Function both get them. No change to `packages/shared`, `firestore.rules`, `firebase.json` or the web app. Same actor model as batch 1a: one user per call, a board outside their workspaces reads as "not found", roles mirror the rules.

## Tools

| Tool                                          | Scope | Role           | Input                                                                            | Behaviour                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ----- | -------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atrium_rename_column`                        | write | owner          | `boardId, column, title`                                                         | New title trimmed, must not match another column (case-insensitive). Returns `{ id, title, was }`.                                                                                                                                                                                                                                      |
| `atrium_delete_column`                        | write | owner          | `boardId, column`                                                                | Removes the column and, like the web's `deleteColumn`, its id from `columnLocks`, in one `mutateBoard` transaction. Then removes `values.<id>` from every item in chunks of 200. Derived, server-managed and required columns skip the cleanup (rules REQ-1; the leftovers are invisible). Returns `{ deleted, title, valuesCleared }`. |
| `atrium_reorder_columns`                      | write | owner          | `boardId, columns[]`                                                             | Every column once (id or title); missing, unknown or repeated is refused. New positions via `generateNKeysBetween`.                                                                                                                                                                                                                     |
| `atrium_lock_column` / `atrium_unlock_column` | write | owner          | `boardId, column`                                                                | Adds or removes the id in `columnLocks` (max 200). Idempotent; returns `{ id, title, locked, changed }`.                                                                                                                                                                                                                                |
| `atrium_find_items`                           | read  | any board role | `boardId, name?, group?, where?[{column, equals}], limit?(25, max 100), offset?` | Active top-level items only. `name` is a case-insensitive substring; `equals` is compared with the readable cell (case-insensitive; multi-value cells match any entry; `null` means empty). All filters must match. Sorted like `atrium_get_board`. Returns `{ total, offset, shown, items, nextOffset? }`.                             |

All column changes go through `mutateBoard` (owner check, `updateTime` precondition, one retry).

## Follow-ups from #258

- The tool-count comment and assertions (stdio, hosted app test, e2e, docs) now say 37.
- `positionBetween` raises `McpUserError("Two items share a position; reorder the group first.")` when its neighbours are equal or out of order, instead of a raw error from `fractional-indexing`.
- `atrium_restore_item` on a trashed parent no longer brings back a subitem that was trashed on its own earlier: a subitem returns only when its `deletedAt` is not older than the parent's. Archived subitems carry no `deletedAt`, so the same-state rule still applies to them. (Supersedes the batch 1a "same state" wording for trashed items.)

## Tests (`packages/mcp-core/src/mcp-core.test.mjs`)

One test per tool for allowed, forbidden (editor and viewer; find_items: not found for a non-member) and not found. Extra: duplicate title, lock cleanup on delete, value cleanup and required skip, reorder validation, find filters and paging, `positionBetween` equal positions, restore with an earlier-trashed subitem, catalogue scopes and count.
