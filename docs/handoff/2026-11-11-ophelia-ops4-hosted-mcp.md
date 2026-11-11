# 2026-11-11 · Ophelia · OPS4 hosted MCP connector

Spec: `docs/specs/OPS4-hosted-mcp-connector.md`. User guide: `docs/mcp-connector.md`. Owner steps and rollback: `docs/DEPLOY.md` ("The hosted MCP connector").

## What shipped

| PR  | Branch                          | Content                                                                                                                            | State         |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| A   | `claude/mcp-shared-description` | description helpers moved into `@atrium/shared`                                                                                    | merged (#239) |
| B   | `claude/mcp-core-package`       | `packages/mcp-core`, the actor model (`createService({ client, actor })`), `atrium_list_workspaces` (25 tools), `arrayContains`    | merged (#240) |
| C   | `claude/mcp-admin-client`       | `functions/src/mcp/admin-client.ts`, the Admin SDK adapter, with an emulator e2e                                                   | merged (#242) |
| D   | `claude/mcp-oauth-provider`     | OAuth 2.1 authorization-server core over Firestore (`functions/src/mcp/oauth/`), callables, block hook, `mcpGrants` rule and tests | merged (#243) |
| E   | `claude/mcp-function`           | the `mcp` function, Hosting rewrites, env key, limits, audit, e2e; ships **disabled**                                              | merged (#244) |
| F   | `claude/mcp-connect-page`       | `/connect` consent page, Settings Connected apps card, baselines                                                                   | merged (#245) |
| G   | `claude/mcp-docs`               | this docs PR                                                                                                                       | merged (#246) |

All seven PRs are merged. The hosted function was deployed disabled, then enabled by the enable PR (`claude/mcp-enable`). The exact wording of tool errors for limits was not re-checked; the docs describe behaviour per the spec.

## Live status (end of 2026-11-11)

- **Live and working.** Enabled by #247; a registration bug found right after enabling was fixed by #248. Claude registers with `token_endpoint_auth_method: client_secret_post` because the SDK's metadata advertised it; the first version of our client store refused anything but `none`, so claude.ai failed with "can't sign in" and the log showed `POST /register` 400. Now any method is accepted but the stored client is always public (no secret), and the metadata advertises only `none`. Lesson: test a registration the way the real client sends it, not only the happy path.
- **Verified live:** well-known documents (200), 401 challenge with `scope="atrium:read atrium:write"`, 405 on `GET /mcp`, redirect-URI allow-list (a foreign URI is refused), authorize redirects to `/connect?request=`, TTL policies ACTIVE/CREATING on `mcpTokens`, `mcpAuthRequests`, `mcpClients`, `entries`, `allUsers` invoker on the `mcp` Cloud Run service. One owner account completed the full flow (register, authorize, token, working `/mcp` tool calls); a second Claude account needed its stale connector removed and re-added (it had been created while registration was broken).
- **Connector scope:** a connector added in claude.ai or the desktop app belongs to the Claude account, so it should follow that account into Claude Code on other devices (`claude mcp list` shows `claude.ai Atrium`). `claude mcp add --scope user` is per machine only.
- **Not verified:** `trust proxy` is `2` (Hosting, then Google front end) on reasoning, not measured; check the real client IP in a log line once there is traffic. The two `POST /mcp` 400s seen at the start of a session are the usual startup handshake (a 200 follows) but were not inspected.
- **Local stdio mode still works** (`claude mcp add atrium --scope user -e ATRIUM_USER_UID=<uid> -- pnpm --silent --dir <checkout> exec tsx scripts/mcp/atrium-mcp.mjs`); `ATRIUM_WORKSPACE_ID` is an optional filter now.
- **Models:** PRs B to D were written by Fable agents (hit the 5-hour limit twice; resume with SendMessage after the reset); everything else by Sonnet. The owner asked to avoid Fable from here on.

## What's next (in order)

1. Done: E, F and G merged (function deployed disabled).
2. Done: TTL policies (with `--enable-ttl`) for `mcpTokens`, `mcpAuthRequests`, `mcpClients` and `entries` were created on 2026-11-11 (CREATING, then ACTIVE). Still to check: the invoker binding and the smoke curls.
3. Enable PR (`claude/mcp-enable`, sets `MCP_CONNECTOR_ENABLED=true`) is this change. After it deploys, connect with Read only first, then with Write on a scratch board. Roadmap item to In review, Actionable = Yes, with the connect steps.
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
- The hosted connector is behind a kill switch (`MCP_CONNECTOR_ENABLED`). A green deploy proves nothing about OAuth: run the smoke steps in `docs/DEPLOY.md`.
- Claude fetches OAuth metadata at the issuer root, so the Hosting rewrites must stay before the `** -> /index.html` catch-all (`scripts/mcp-hosting.test.mjs` guards this).
- No real ids, uids or emails anywhere in the repo; use `.private/project-ids.md`.
