# 2026-11-17 Claude: MCP batch 2 PR 5, team management

Branch `claude/mcp-2-5-teams` (port offset 60). Spec: `docs/specs/MCP-gap-batch-2.md`, PR 5.

## Done

- `atrium_create_team`, `atrium_update_team`, `atrium_delete_team` in `packages/mcp-core/src/tools/teams.mjs` and `service/teams.mjs` (one import line each in `tools.mjs` and `service.mjs`).
- Mirrors the rules' `validTeam` and `teams-firestore.ts`: name 1 to 60, unique ignoring case, 50 teams per workspace (client-side limit), `#RRGGBB` or a palette name (default `#579bfc`), at most 100 unique current members (uid, email or `me`), audit fields. Owner and admin only.
- Update drops stored members who left the workspace (the rules require current members only) and reports them as `droppedFormerMembers`.
- Delete guard: counts active items per board with `assigneeTeamIds array-contains`, re-checked against the board's People columns; refuses without `allowDataLoss`; `dryRun` reports the same numbers; returns the deleted team. Cells keep the id and read "Deleted team".
- Tests: `packages/mcp-core/src/teams.test.mjs`, parity list in `tools-parity.test.mjs`, emulator cases in `tests/rules/src/mcp-teams.e2e.test.ts`.
- Docs: `docs/mcp-connector.md` (tool row, "Teams" paragraph, counts, not-yet list).

## Notes

- The audit entry's target reads `teamId`, but these tools take `team` (id or name), as the spec's table says, so no team target is audited yet. Rename the arg or extend `TARGET_KEYS` if wanted.
- The delete guard reads every board of the workspace (any state) once per delete.
