# MCP batch 2 PR 4: views and forms

Branch `claude/mcp-2-4-views`. Implements PR 4 of `docs/specs/MCP-gap-batch-2.md`: `atrium_list_views`, `atrium_get_view_items`, `atrium_create_view`, `atrium_update_view`, `atrium_delete_view` (65 tools after PRs 2, 3 and 5). No changes to rules, indexes, `packages/shared`, `firebase.json`, the lockfile or visual baselines.

## What changed

- `packages/mcp-core/src/tools/views.mjs` and `service/views.mjs`; one import line each (`DOMAINS.views`, `createService`); the five names in `DOMAIN_TOOLS` of `tools-parity.test.mjs`.
- Mirrors the web (`view-writes.ts`, `view-actions.ts`, `AdvancedFilterPopover.tsx`, `table-model.ts`) and the rules (`viewKeysOk`, `viewSettingsOk`, `canWriteView`). `viewRulesProblems(doc)` in `service/views.mjs` re-implements the rules' key sets and limits (the schema alone strips unknown keys); every write passes `boardViewSchema` and it.
- Filter values are converted per column type as the filter builder stores them; operators are limited to what the builder offers per type (so a formula column only gets the text operators, like the web). Mirror columns are refused for filter, sort, group and hide, as the web's menus do.
- `settings` is the type's own block with the app's field names; column fields (`columnId`, `cardColumnIds`, `colorBy`, `xColumnId`, ...) take titles or ids and are checked against the column types the pickers offer. Unknown keys are refused. Form block: `{ title, description, thankYou, targetGroup, acceptingResponses, questions }` (extras beyond the spec: `targetGroup` and `acceptingResponses`, both in `formSettingsSchema`).
- Reading through a view: per group in board order (filter, then sort) or, with a group-by, `groupItems` then sort per group, exactly the web's table model; subitems and non-active items excluded. Items carry `groupedBy` when the view groups by a column. A form view errors (its responses are ordinary items).
- Guards: removing form questions in `atrium_update_view` needs `allowDataLoss`; `dryRun` returns the same plan without writing. `atrium_delete_view` is `destructiveHint` and returns the definition in the shape `atrium_create_view` takes (recreate test included); a bare team id in a people condition is accepted so that round trip works.
- `main` is stored on the first save with the rules' fixed name, type, position and owner; renaming or deleting it is refused. Names are unique among the views the actor sees (case-insensitive), so a name is a safe reference.

## Tests

`packages/mcp-core/src/views.test.mjs` (fake client, 24 tests, including a parity test against the web engine's table-model order) and `tests/rules/src/mcp-views.e2e.test.ts` (emulator: created views read back as the user and the same document, written as the web writes it with server timestamps, passes the real rules for every type; personal views of a viewer; main).

## Gotchas

- A forms' link is `/forms/<boardId>/<viewId>`; the connector returns the path only (no origin).
- Running one emulator test file: see the `emulators:exec ... vitest run <name>` pattern in `scripts/test-rules.mjs`.
