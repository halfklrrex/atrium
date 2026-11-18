# MCP batch 4 PR 1: Dashboards tools

Branch `claude/mcp-4-1-dashboards`. Implements PR 10 of `docs/specs/MCP-gap-batch-2.md` (6 tools: `atrium_list_dashboards`, `atrium_get_dashboard`, `atrium_create_dashboard`, `atrium_update_dashboard`, `atrium_delete_dashboard`, `atrium_restore_dashboard`). No changes to rules, indexes, `packages/shared`, `firebase.json`, the lockfile or visual baselines.

## What changed

- `tools/dashboards.mjs`, `service/dashboards.mjs` (one import line each in `tools.mjs` and `service.mjs`), names added to `DOMAIN_TOOLS` in `tools-parity.test.mjs`.
- Widgets are written and read in readable form (column titles, status label texts, board names); the stored form is the shared `dashboardWidgetsSchema`. A column is resolved on the widget's boards (first board that has it).
- The widget layout engine (`findFreeSlot`, `normalizeLayout`) is copied from `apps/web/.../dashboard-layout.ts`; the numbers and battery computations mirror `numbers-model.ts` and `battery-model.ts`. `dashboards.test.mjs` imports the web files and checks parity on the same data, so a change in the web fails the test.
- Tests: `packages/mcp-core/src/dashboards.test.mjs`, emulator `tests/rules/src/mcp-dashboards.e2e.test.ts` (a created dashboard reads back through a rules-enforced web client, parses with `dashboardSchema`, takes a web-shaped update).
- `docs/mcp-connector.md`: tool table, Dashboards paragraph, counts (72), follow-ups.

## Notes

- Delete is the trash (as the web); nothing is deleted for good. `removeWidgets` returns the removed definitions.
- `atrium_update_dashboard` with `boards` keeps boards on the dashboard that the actor cannot read, so an editor cannot drop what they cannot see.
- Chart, table and workload widgets return configuration only (no computed data).
- Sharing fields are never written (PR 8 adds that through an adapter).
- The count (72) will collide with the Files PR's count in `docs/mcp-connector.md`; resolve by adding the two.
