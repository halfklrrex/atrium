# SUBITEMS PR 6: lock it in

Branch `claude/subitems-pr6`. Implements "PR 6: lock it in" of `docs/specs/SUBITEMS-as-items.md`, after the production migration (0 boards with `subitemColumns`). It only tightens.

## What changed

- **Rules** (`firestore.rules`): board create needs `subitemColumns == []`; `subitemColumns` left the board update's `changed.hasOnly` list, so no client can change it (the migration uses the Admin SDK); template create needs `structure.subitemColumns == []`. The `request.resource.data.subitemColumns is list` check on board update stays (it can only be stricter).
- **Rules tests**: `tests/rules/src/subitems.test.ts` now seeds board columns only (derived, server-managed, locked and required) and covers the spec list: board create with `[]` passes and non-empty is refused, an editor or owner update changing `subitemColumns` is refused while one leaving it alone passes, subitem create and update on a board column pass, derived, server-managed and locked columns are refused for a non-owner, emptying a required column is refused, and a subitem's feed (update, like, reply, `updatesCount` bump) passes and is refused for a viewer. `templates.test.ts` refuses a template create with non-empty `structure.subitemColumns`. The `helpers.ts` fixture keeps `subitemColumns: []`.
- **Helper**: `columnsForItem(board, item?)` and `columnsForSubitems(board)` return `board.columns` always. `hasLegacySubitemColumns` is gone. The `item` argument is kept (unused) so call sites still say whose cells they mean.
- **Web**: `scope: 'subitems'` is removed from `TableCtx`, `legacySubitems` from `TableEnv`, and `BoardStructureState.subitemColumns` from structure writes. `BoardTable`, `SubitemBlock`, `HeaderRow`, `use-item-ctx`, the side panel and the activity panel use the board columns only. The type-change callable still gets `scope: 'columns'`.
- **Functions**: `ChangeBoardData`, `ActivityBoard`, `NotificationBoard`, `RequiredRevertBoard` and the admin board loaders no longer carry `subitemColumns`. A column type change covers every item (subitems included) and always edits `board.columns`.
- **Shared**: `derived-ids` and `voteCapExceeded` read `columns` only; `ItemIndexBoard` lost the field. The board schema field stays as `.default([])` (old documents still parse).
- **MCP**: `atrium_get_board` has no `subitemColumns` key and no legacy branch; the legacy-board test is gone; `docs/mcp-connector.md` updated.
- **Repo test** `scripts/subitem-columns.test.mjs`: the allow list is down to 10 files, each with a reason (schema, template schema and structure, the callable's wire enum, `[]` writers, the migration, the showcase and e2e fixtures).
- **Older backfills** (`2026-10-backfill-derived-column-ids`, `2026-11-backfill-item-date-keys`, `-item-index`, `-required-column-ids`) no longer read `subitemColumns`; subitems use the board columns in them too. They have already run, so this only keeps a rerun correct.

## Gotchas

- The type-change callable's `scope` enum (`columns` | `subitemColumns`) stays in `packages/shared/src/schemas/column-type-change.ts`: the request schema is `.strict()`, a cached web build still sends `scope`, and stored snapshot documents carry it. The server ignores the value (one column list). Removing it is a later cleanup once no old client can call.
- Template documents saved earlier keep whatever they hold; template apply ignores `subitemColumns` (PR 2). The template zod schema still requires the key, as the rules do.
- `tests/rules/src/column-locks.test.ts` and `vote-integrity.test.ts` still seed boards with non-empty `subitemColumns` through the rules-disabled admin context (it checks the flat id lists, which are independent of where a column lives). They pass; no client create writes it.
- Rules tests need Java on the PATH (`/opt/homebrew/opt/openjdk@21/bin` on this machine).
