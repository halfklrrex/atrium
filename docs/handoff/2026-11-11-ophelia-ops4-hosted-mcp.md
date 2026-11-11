# 2026-11-11 · Ophelia · OPS4 hosted MCP connector

Spec: `docs/specs/OPS4-hosted-mcp-connector.md`. User guide: `docs/mcp-connector.md`. Owner steps and rollback: `docs/DEPLOY.md` ("The hosted MCP connector").

## What shipped

| PR  | Branch                          | Content                                                                                                                            | State at writing                     |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| A   | `claude/mcp-shared-description` | description helpers moved into `@atrium/shared`                                                                                    | merged                               |
| B   | `claude/mcp-core-package`       | `packages/mcp-core`, the actor model (`createService({ client, actor })`), `atrium_list_workspaces` (25 tools), `arrayContains`    | merged                               |
| C   | `claude/mcp-admin-client`       | `functions/src/mcp/admin-client.ts`, the Admin SDK adapter, with an emulator e2e                                                   | merged                               |
| D   | `claude/mcp-oauth-provider`     | OAuth 2.1 authorization-server core over Firestore (`functions/src/mcp/oauth/`), callables, block hook, `mcpGrants` rule and tests | merged                               |
| E   | `claude/mcp-function`           | the `mcp` function, Hosting rewrites, env key, limits, audit, e2e; ships **disabled**                                              | #244 open when this note was written |
| F   | `claude/mcp-connect-page`       | `/connect` consent page, Settings Connected apps card, baselines                                                                   | check the Roadmap for its state      |
| G   | `claude/mcp-docs`               | this docs PR                                                                                                                       | this PR                              |

Not confirmed when this was written (check the merged code): the exact wording of tool errors for limits, and the details of E's route wiring. The docs describe behaviour per the spec.

## What's next (in order)

1. Merge E (deploys the function disabled), then F and G.
2. Owner runs the one-offs in `docs/DEPLOY.md`: TTL policies for `mcpTokens`, `mcpAuthRequests`, `mcpClients` and the `entries` collection group (on 2026-11-11 no TTL existed on `entries`), the invoker-binding check and the two smoke curls (both `503` while disabled).
3. Enable PR (`claude/mcp-enable`, sets `MCP_CONNECTOR_ENABLED=true`). Connect with Read only first, then with Write on a scratch board. Roadmap item to In review, Actionable = Yes, with the connect steps.
4. Log Decisions D1 to D7 on the Decisions board (spec section 2).
5. Optional PR H: `updatedVia: 'mcp'` and "via Claude" in the activity log. Measure `/token` cold starts and set `minInstances: 1` if slow.
6. MCP gap batches, new tools written once in `@atrium/mcp-core` so both modes get them (spec section 14):
   1. restore, move and reorder items, groups and columns; likes and votes; people by email; REQ-1 enforcement in `convertValues` / `updateItem`; board lifecycle; column update, delete and lock; `atrium_find_items`; move an item to another board;
   2. more column types, and creating derived and server-managed column definitions (their cells stay off-limits);
   3. files (Cloud Storage, Admin SDK bucket in the hosted mode);
   4. views, forms and dashboards;
   5. automations;
   6. callable-only features (sharing, invites, column type change, buttons, time tracking).

## Gotchas

- **Stale emulator on port offset 70.** An old Firestore emulator left running on the offset-70 block made emulator tests talk to the wrong data or fail to bind. Check `lsof -i` for the Firestore and Auth ports of your `ATRIUM_PORT_OFFSET` and kill leftovers before running `pnpm test:rules`.
- **MCP tests need `--import tsx`.** The `functions/src/mcp` tests and the mcp-core wiring load `.ts` and `.mjs` together, so run them with `node --import tsx --test ...` (or through the package scripts) rather than plain `node --test`.
- **The visual baselines workflow commit does not start CI.** A commit pushed by the Update visual baselines workflow (with the default token) does not trigger the PR checks. After it finishes, push an empty commit or re-run the checks by hand before merging.
- The hosted connector is behind a kill switch that ships `false`. A green deploy of E proves nothing about OAuth: run the smoke steps in `docs/DEPLOY.md`.
- Claude fetches OAuth metadata at the issuer root, so the Hosting rewrites must stay before the `** -> /index.html` catch-all (`scripts/mcp-hosting.test.mjs` guards this).
- No real ids, uids or emails anywhere in the repo; use `.private/project-ids.md`.
