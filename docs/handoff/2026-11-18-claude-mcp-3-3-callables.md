# 2026-11-18 Claude: MCP batch 3 PR 3, column type change, buttons and time tracking

Branch `claude/mcp-3-3-callables` (port offset 80). Spec: `docs/specs/MCP-gap-batch-2.md`, PR 9. Owner decisions of 2026-11-17 apply: hosted-only tools; destructive operations allowed behind `dryRun` and `allowDataLoss`.

## Done

- Five hosted-only tools (`tools/callables.mjs`, `service/callables.mjs`): `atrium_change_column_type`, `atrium_revert_column_type`, `atrium_click_button`, `atrium_start_time_tracking`, `atrium_stop_time_tracking`. Hosted 82, local 73.
- `ServerOps` gained `previewColumnTypeChange`, `changeColumnType`, `revertColumnType`, `clickButton`, `startTimeTracking`, `stopTimeTracking` (`functions/src/mcp/server-ops.ts`), calling the callables' library code with the actor's uid and the callables' own adapters.
- `lib/column-type-change.ts`: new `previewColumnTypeChangeLogic` (the dry run) sharing `assertTypeChangeAllowed`, `computedEntries` and `planEntries` with the real run (a refactor, behavior unchanged; existing tests pass).
- `lib/click-button.ts`: the transaction plus post-commit notification delivery moved out of the `clickButton` callable so the connector runs the same code. The callable is now thin.
- Tests: `callables.test.mjs` (service with fake ops), `server-ops-callables.test.ts`, preview tests in `column-type-change.test.ts`, `tests/rules/src/mcp-callables.e2e.test.ts` (real Admin adapters on the emulator).

## Deviations and gotchas

- Roles: the spec table says "board owner" for the type change; the tools follow the web and the callable instead (editor; a locked column and a calculated or managed source need the owner), as the task asked to mirror the web exactly.
- `settings` omitted uses `columnRegistry.defaultSettings(toType)` like the web dialog; status, dropdown and tags create their labels from the values.
- The hosted function times out at 55 seconds (the callable has 540), so a conversion of more than 3000 values is refused with a pointer to Atrium. If a run dies mid-way the column stays `migrating`; `atrium_revert_column_type` accepts it once stale (10 minutes), and the web offers Resume.
- Only `columns` scope (top-level columns) is reachable; legacy `subitemColumns` boards are not.
- `serverOps` deps grew (`columnTypeStore`, `runColumnActions`, `clickButton`): the two Functions test files and `mcp-sharing.e2e.test.ts` that build `createServerOps` by hand now pass stubs.
- Merge conflicts to expect with the automations PR: import lines in `tools.mjs`, `service.mjs`, `index.d.mts`, the parity list and the hosted-only list in `files.test.mjs`, and the counts in `docs/mcp-connector.md` (recount from the catalogue).
