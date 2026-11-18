# MCP batch 4 PR 2: Automations tools

Branch `claude/mcp-4-2-automations`. Implements PR 11 of `docs/specs/MCP-gap-batch-2.md` (6 tools: `atrium_list_automations`, `atrium_list_automation_runs`, `atrium_create_automation`, `atrium_update_automation`, `atrium_set_automation_enabled`, `atrium_delete_automation`). No changes to rules, indexes, `packages/shared`, `firebase.json`, the lockfile or visual baselines.

## What changed

- `tools/automations.mjs`, `service/automations.mjs` (one import line each in `tools.mjs` and `service.mjs`), names added to `DOMAIN_TOOLS` in `tools-parity.test.mjs`.
- Owner decision (2026-11-17) applied: board owners only; created switched off unless `enabled: true`; the create, update and enable descriptions tell the assistant to show the plain sentence and confirm with the person before anything is switched on; deletes are hard, marked destructive, and return the whole definition.
- Input is readable (columns, groups and status labels by title or text, people by uid, email, name or "me"; cell values in the same form item cells take) and is converted to `automationTriggerSchema`, `automationConditionSchema` and `buttonActionSchema`, then checked by the shared `validateAutomation` (with the workspace member list, so notify targets are checked) and `validateScheduledLimit`; 20 per board is checked in the service, as in the web. Unknown trigger or action types are refused by the schemas.
- Writes: create is one `set` (`exists: false`) with `runAs`, `createdBy` and `updatedBy` = the actor and `disabledReason: null`; update and enable are `update` ops with an `updateTime` precondition; `nextRunAt` and `consecutiveFailures` are never written.
- Tests: `packages/mcp-core/src/automations.test.mjs` (16 tests with the fake client), emulator `tests/rules/src/mcp-automations.e2e.test.ts` (recipes read back through a rules-enforced web client, parse with `automationSchema`, pass `validateAutomation`, are accepted by the rules as a web create and take web-shaped updates; runs are owner-only).
- `docs/mcp-connector.md`: tool rows, an Automations paragraph, counts (83 hosted, 79 local), follow-ups.

## Notes and deviations

- **Time zone.** Atrium's zone list (`CANONICAL_TIMEZONES`, from `zone1970.tab`) holds one name per region, so `Europe/Amsterdam` is refused and `Europe/Brussels` is accepted. The web silently falls back to UTC when the profile zone is not in the list; the connector asks for an explicit `timezone` instead (a recipe set for 9:00 would shift without anyone noticing).
- **Update keeps `runAs`** unless `takeOver: true` (the web's editor always takes the recipe over). The input has this one extra field beyond the spec's table, which the spec text already described.
- **Conditions** work on the six column types the web's condition editor offers (status, dropdown, text, long text, numbers, checkbox), although `validateAutomation` accepts more.
- **`nextRunAt`.** The spec asked the e2e file to check the scheduled `nextRunAt` filled by `onAutomationWritten`. That is a Cloud Function and does not run in the rules emulator, so the e2e checks that the connector writes no `nextRunAt` and that the stored recipe is web-valid; the Function has its own tests (`functions/src/lib/automations/next-run.test.ts`).
- Updating an automation that is already on is live at once; the tool says so in its result and its description. Enabling clears `disabledReason` but not the runner's failure counter (rules forbid clients writing it, as for the web).
- The run history reads the newest 200 runs in one query and filters in memory (no composite index), as the web does.
- Counts in `docs/mcp-connector.md` are 83 hosted and 79 local, on top of files and sharing.
