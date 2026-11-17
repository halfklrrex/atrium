# 2026-11-17 Claude: MCP batch 2 PR 6, every column type and label editing

Branch `claude/mcp-2-6-columns` (port offset 70). Spec: `docs/specs/MCP-gap-batch-2.md`, PR 6.

## Done

- `atrium_edit_labels` (`tools/columns.mjs`, `service/columns.mjs`): rename, recolor (palette name or `#RRGGBB`, status and tags), reorder, remove for status, dropdown and tags. Ids and indexes never renumbered; the empty status label stays last and untouched; at least one named status label. Removing a used label (any item state, subitems included) refuses without `allowDataLoss`; `dryRun` reports the same numbers and writes nothing. With `allowDataLoss` the cells holding the label are cleared (dropdown and tags drop the id), which differs from the web (it leaves them dangling, and a new label reusing the index would show on old items). A required column refuses.
- `CREATABLE_COLUMN_TYPES` now holds every registered type except `button`. `atrium_add_column` runs `prepareColumn` (`service/columns.mjs`): defaults, then settings, `validateColumnDef`, the formula parser, the vote cap. Sugar for ids: `board_relation` `{boards}`, `mirror` `{relationColumn, targetColumns, aggregation}`, `progress` `{statusColumns}`, `dependency` `{timeColumn}`. Two-way relations are refused (the web hides them).
- Cell input for email, phone, country (Intl names), location (`{lat, lng}` only), hour, week (ISO week or date), world clock, color; Connect boards and Dependency go through `service/links.mjs` (permission-checked items by id or exact name, cycle check with `canAddDependency`, same-level rule). `convertValues` gained an optional `itemContext`.
- Mirror reads: `service/mirror.mjs` (`prepareMirrors`) loads the linked items once per call (10 boards, 500 items, a `notes` line when cut), skips boards the actor cannot read, and `readableCell` calls `computeMirror`. Wired into `get_board`, `find_items` (page only) and `list_subitems`.
- Tests: `packages/mcp-core/src/columns.test.mjs`; emulator cases in `tests/rules/src/mcp-columns.e2e.test.ts` (the trigger library fills the id lists; formula and mirror read; labels). `tools-snapshot.json` regenerated for the four tools whose description or schema changed (`atrium_add_column`, `atrium_create_items`, `atrium_update_item`, `atrium_create_subitems`).

## Notes and gaps

- `atrium_update_column_settings` still refuses calculated types, so a formula's expression cannot be edited after creation (delete and re-add).
- `atrium_my_work` and `atrium_search` do not compute mirrors; a Connect boards cell still reads as item ids text.
- The mirror reader keys target columns by column id only (as the web does), so two linked boards sharing a column id with different types could clash.
- After PR 4 merges, rebase: expect conflicts in the import lines (`tools.mjs`, `service.mjs`), `index.d.mts`, the parity test list and `docs/mcp-connector.md` counts.
