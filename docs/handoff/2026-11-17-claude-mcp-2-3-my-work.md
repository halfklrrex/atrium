# MCP batch 2 PR 3: My Work, search, notifications

Branch `claude/mcp-2-3-my-work`. Implements PR 3 of `docs/specs/MCP-gap-batch-2.md`: `atrium_my_work`, `atrium_search`, `atrium_list_notifications`, `atrium_mark_notifications_read` (50 tools on top of PR 1; the spec's 57 assumes PR 2's docs tools merged first). No changes to rules, indexes, `packages/shared`, `firebase.json`, the lockfile or visual baselines.

## What changed

- `packages/mcp-core/src/tools/mywork.mjs` and `service/mywork.mjs`; one import line each in `tools.mjs` (`DOMAINS.mywork`) and `service.mjs`; the four names in `DOMAIN_TOOLS` of `tools-parity.test.mjs`.
- My Work: readable boards (board `access`, or a main board by workspace role), recents order only when over 100 boards, `assigneeUids array-contains me` and `assigneeTeamIds array-contains-any <my teams, at most 30>`; `state` filtered in memory; hits re-checked with `assigneeUidsOf` / `assigneeTeamIdsOf`. Extras beyond the spec: each row has `date` and `due` (the bucket), subitems carry `subitemOf`, and the answer has `today` and `timeZone`.
- Week buckets: `this_week` is tomorrow to Sunday (today has its own bucket), `next_week` is the next Monday to Sunday; a later date has bucket `later`.
- Search: `nameTokens array-contains <longest word>` plus `state == active` with `limit 10` (equality plus array-contains merges single-field indexes, like the web query); docs use the rules' list shape and a role check done inline (PR 2 generalizes `roleOn`; switch to it when both have merged).
- Notifications: `unreadOnly` queries `readAt == null` (the web's query) and sorts newest first in memory (cap 300), the unfiltered list uses `orderBy createdAt desc, limit`. Mark read writes `update` with only `readAt`, in chunks of 400; `all` marks at most 500 per call and says so.
- `search` item results include `group`; board and doc results have `kind` `board` / `doc` (singular).

## Tests

`packages/mcp-core/src/mywork.test.mjs` (fake client) and `tests/rules/src/mcp-my-work.e2e.test.ts` (emulator: items in the web shape get their index fields from `syncItemIndexFields`, then the Admin client finds them).

## Gotchas

- A leftover Firestore emulator (PID of an old `qa-fixes-1` run) held offset 40's ports; kill orphans by PID before `pnpm test:rules`.
- `docs/mcp-connector.md` says 50 tools; whoever merges second fixes the number (46 + 4 + PR 2's 7 = 57).
