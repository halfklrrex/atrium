# OPS4: Hosted Atrium MCP connector (remote, OAuth 2.1)

**Goal (owner request, 2026-11-11):** one public HTTPS MCP URL that the owner adds **once** as a custom connector in claude.ai and in Claude Code (`claude mcp add --transport http`), so the Atrium tools work in every project without per-project stdio registration. Each person signs in with their own Atrium (Google) account and gets exactly the boards their memberships allow. **Who may connect (owner decision, 2026-11-11):** any account the Site Admin has approved; `pending` and `blocked` accounts cannot. The local stdio mode (OPS3, `docs/specs/OPS3-atrium-mcp-connector.md`) keeps working.

Facts checked when this was written: `main` has **24** tools in `scripts/mcp/lib/tools.mjs`. `@modelcontextprotocol/sdk` 1.32.2 is already a root devDependency and ships an Express OAuth 2.1 authorization-server router (`mcpAuthRouter`), bearer middleware and a stateless Streamable HTTP transport. Sources: Anthropic "Authentication for connectors" (401 with `resource_metadata` required; DCR used when CIMD is not advertised; callbacks `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, loopback `localhost`/`127.0.0.1` any port; form-urlencoded `/token`; refresh rotation; 10 s / 30 s budgets) and the MCP authorization spec 2025-11-25 (PRM, AS metadata at the issuer root, PKCE S256, `resource` audience binding).

## 1. Approach

A new 2nd-gen Cloud Function `mcp` (`functions/src/mcp/`, `onRequest` wrapping an Express app, `europe-west1`, bundled by tsup, deployed by the existing `deploy.yml`) serves the MCP endpoint (stateless Streamable HTTP, JSON responses, no SSE) **and** a thin OAuth 2.1 authorization server built from the SDK's `mcpAuthRouter`, backed by Firestore collections. Firebase Hosting rewrites expose it under the canonical site: resource `https://atrium-workboards.web.app/mcp`, issuer `https://atrium-workboards.web.app`.

User sign-in is **not** re-implemented: `/authorize` parks the request in Firestore and redirects to a consent page in the web app (`/connect?request=...`), which already has Google sign-in and the account gate; a callable turns the signed-in uid into an authorization code. Access tokens are opaque, hashed, Firestore-backed, audience-bound, 1 hour; refresh tokens rotate (30 days, absolute grant life 90 days), so the owner is not asked to reconnect every hour. Tool logic moves from `scripts/mcp/lib` to a workspace package `@atrium/mcp-core` used by both the stdio server (REST client + `gcloud` token) and the Function (Admin SDK adapter). The only logic change is "the configured user and one workspace" becoming "the signed-in user and all their memberships". No Secret Manager secret is needed in v1.

## 2. Decisions (log on the Decisions board)

| #   | Decision                                                                                                                                                            | Why                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Cloud Functions 2nd gen (`mcp`, `onRequest`) behind Hosting rewrites; URL `https://atrium-workboards.web.app/mcp`.                                                  | Same build, deploy and IAM as the other functions. The raw cloudfunctions.net URL cannot work: Claude fetches authorization-server metadata at the issuer's root `/.well-known/...`. Hosting's 60 s cap is harmless with a stateless JSON transport. |
| D2  | Atrium is its own OAuth 2.1 authorization server (SDK router + Firestore `OAuthServerProvider`); user authentication is delegated to the existing web session.      | Firebase Auth is an identity provider, not an AS for third-party clients; Google OAuth directly ignores `resource`, needs an owner-made client, and refuses Claude Code's loopback client.                                                           |
| D3  | Dynamic Client Registration with a redirect-URI allow-list (the four callbacks above), public clients only (`token_endpoint_auth_method: none`), no stored secrets. | Nothing to type into Claude. CIMD can be added later behind the same provider.                                                                                                                                                                       |
| D4  | Opaque tokens stored as SHA-256 hashes; access 1 h, refresh 30 d rotating with reuse detection, grant absolute 90 d.                                                | One read per request, instant revocation, no key material.                                                                                                                                                                                           |
| D5  | Scopes `atrium:read` and `atrium:write`, chosen on the consent screen; write tools return a tool error without `atrium:write`.                                      | Read-only connections limit prompt-injection blast radius.                                                                                                                                                                                           |
| D6  | Per-user, all-memberships scoping replaces `ATRIUM_WORKSPACE_ID`/`ATRIUM_USER_UID`; `ATRIUM_WORKSPACE_ID` becomes an optional filter in stdio mode.                 | The uid comes from the token; boards from `workspaces.memberIds` / `board.access`, as the rules compute them.                                                                                                                                        |
| D7  | `@atrium/mcp-core` workspace package (`packages/mcp-core`, `.mjs` + hand-written `index.d.mts`), inlined into the Functions bundle via tsup `noExternal`.           | No duplication, no rewrite of the tested library, no runtime `workspace:` dependency in `functions/package.json`.                                                                                                                                    |

## 3. Hosting and transport

`functions/src/mcp/index.ts` exports `mcp = onRequest({ invoker: 'public', cors: false, timeoutSeconds: 55, memory: '512MiB', maxInstances: 3, minInstances: 0 }, createMcpApp())`, re-exported from `functions/src/index.ts`. Keep `cpu`/`concurrency` from `global-options.ts` (`docs/specs/BUG-deploy-cpu-quota.md`). `app.set('trust proxy', true)` (the SDK rate limiter reads `X-Forwarded-For`).

Routes (`functions/src/mcp/app.ts`), in order:

| Route                                           | Handler                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| all (first middleware)                          | kill switch: `MCP_CONNECTOR_ENABLED !== 'true'` -> `503 {"error":"connector_disabled"}`, `Cache-Control: no-store`                                                                                                                                                                                                                                                                                                         |
| `GET /.well-known/oauth-authorization-server`   | SDK metadata: issuer, `code_challenge_methods_supported: ["S256"]`, `scopes_supported`, `token_endpoint_auth_methods_supported: ["none"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, registration and revocation endpoints                                                                                                                                                                          |
| `GET /.well-known/oauth-protected-resource/mcp` | SDK metadata: `resource`, `authorization_servers`, `scopes_supported`, `resource_name: "Atrium"`, `bearer_methods_supported: ["header"]`                                                                                                                                                                                                                                                                                   |
| `GET /authorize`                                | SDK handler -> `provider.authorize` stores the request, 302 to `/connect?request=<id>`                                                                                                                                                                                                                                                                                                                                     |
| `POST /token`                                   | SDK handler (`authorization_code` with PKCE, `refresh_token` with rotation); test form-urlencoded parsing under Functions' body parser                                                                                                                                                                                                                                                                                     |
| `POST /register`, `POST /revoke`                | SDK handlers (rate-limited)                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /mcp`                                     | `requireBearerAuth({ verifier, resourceMetadataUrl, expectedResource })` -> account gate -> usage limit -> per-request `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`. Unauthenticated: `401` with `WWW-Authenticate: Bearer resource_metadata="https://atrium-workboards.web.app/.well-known/oauth-protected-resource/mcp", scope="atrium:read atrium:write"` |
| `GET /mcp`, `DELETE /mcp`                       | `405`, `Allow: POST`                                                                                                                                                                                                                                                                                                                                                                                                       |

`firebase.json` (hot-spot, one small PR): add seven rewrites (`/mcp`, `/authorize`, `/token`, `/register`, `/revoke`, the two `/.well-known/...` paths) to function `mcp`, region `europe-west1`, **before** the `** -> /index.html` catch-all of the `app` target, plus a `Cache-Control: no-store` header on `/mcp`. No `pinTag`. `scripts/mcp-hosting.test.mjs` asserts the rewrites exist, target `mcp`/`europe-west1` and precede the catch-all. None of the paths collide with SPA routes (the new SPA route is `/connect`).

## 4. Auth design

### 4.1 Flow

1. Claude POSTs `/mcp` without a token -> 401 with `resource_metadata` -> reads PRM and AS metadata -> `POST /register` (DCR) -> opens `GET /authorize?...&code_challenge&resource`.
2. `provider.authorize()` writes `mcpAuthRequests/{requestId}` and redirects to `https://atrium-workboards.web.app/connect?request=<requestId>`.
3. `/connect` sits inside `RequireAuth` + `AccountGate`, so a signed-out person gets Google login and a pending/blocked account gets the existing waiting/blocked screens. The page loads the request through the callable `mcpAuthRequestInfo`, shows the client name, the **redirect hostname** (extra warning for `localhost`/`127.0.0.1`: "the code will be sent to a program on this computer"), the scopes as checkboxes (Read on and locked, Write on by default), and Allow / Deny. `RequireAuth` must preserve `?request=` through the login redirect.
4. Allow -> callable `mcpAuthorize({ requestId, decision, scopes })`: in a transaction, the request must be `pending` and unexpired; set `uid`, `scopes` (subset of requested, includes `atrium:read`), `codeHash`, `status: 'approved'`; returns `{ redirectUrl }` = `redirect_uri?code=<requestId>.<secret>&state=...`. Deny -> `redirect_uri?error=access_denied&state=...`.
5. `POST /token` with `code` + `code_verifier` + `resource`: the SDK verifies PKCE via `challengeForAuthorizationCode`; `exchangeAuthorizationCode` checks status `approved`, same client and redirect URI, `resource` equals the canonical URL, not expired; marks `exchanged`; creates `users/{uid}/mcpGrants/{grantId}` plus one access and one refresh token doc. Presenting a used code again revokes the grant.
6. Every `/mcp` request: hash the token -> `mcpTokens/{hash}` (`kind: 'access'`, unexpired, resource matches) -> `AuthInfo { token, clientId, scopes, expiresAt, resource, extra: { uid, grantId } }`. Then the **account gate** reads `users/{uid}.accountStatus` and requires `'approved'` (pending/blocked -> `401 invalid_token`; the refresh is refused with `invalid_grant` for the same reason).
7. Refresh: transactional rotation (delete old refresh doc, check grant not revoked and account approved, write a new pair, `expiresAt` = min(now + 30 d, grant.createdAt + 90 d)). A used refresh token presented again revokes the grant.

### 4.2 Data (database `atrium-1`; all Functions-only except `mcpGrants`)

```
mcpClients/{clientId}        client_id, client_name (<=100), redirect_uris[], token_endpoint_auth_method 'none', grant_types, response_types, createdAt, lastUsedAt, expiresAt (TTL 90 d after lastUsedAt)
mcpAuthRequests/{requestId}  clientId, clientName, redirectUri, codeChallenge, state?, requestedScopes[], resource, status pending|approved|denied|exchanged, uid|null, scopes|null, codeHash|null, createdAt, expiresAt (TTL 10 min)
mcpTokens/{sha256hex}        kind access|refresh, uid, clientId, grantId, scopes[], resource, createdAt, expiresAt (TTL)
users/{uid}/mcpGrants/{id}   clientId, clientName, redirectHost, scopes[], createdAt, lastUsedAt, lastRefreshAt, revokedAt|null   (self-read, no client write)
mcpUsage/{uid}               day 'YYYY-MM-DD', calls, writes, updatedAt
system/mcpAudit/entries/{id} kind grant_created|grant_revoked|token_refreshed|tool_call|auth_denied, at, uid, clientId, grantId?, tool?, boardId?, ok?, error?, ms?, expiresAt (TTL 90 d)
```

Tokens: 32 random bytes base64url with prefix `atr_`; only the hash is stored. Codes: `<requestId>.<32 random bytes base64url>`, hash stored. Rules: `mcpGrants` `allow read: if signedIn() && uid() == userId; allow write: if false;` plus `tests/rules` tests (owner reads own, other denied, writes denied) and denial tests for the Functions-only collections.

### 4.3 Callables (`functions/src/callable/`, approved accounts only via `actorFromRequest`)

`mcpAuthRequestInfo({ requestId })`, `mcpAuthorize({ requestId, decision, scopes? })`, `revokeMcpGrant({ grantId })`. `setAccountStatus` **block** also calls `revokeAllMcpGrants(uid)` (best effort). Zod schemas in `packages/shared/src/mcp.ts`; web wrappers in `apps/web/src/lib/callables.ts` (`mcpCalls`).

### 4.4 Lifetimes, revocation, kill switch

Access 1 h; refresh 30 d rotating; grant absolute 90 d; auth request 10 min; code single-use. A per-instance verification cache (60 s, 500 entries) bounds how long a revocation or block takes to bite. Revocation paths: Settings -> Disconnect, `/revoke`, admin block, refresh/code reuse. Kill switch: `MCP_CONNECTOR_ENABLED` in `functions/.env.atrium-board` (add to `ALLOWED_KEYS` in `scripts/functions-env.test.mjs`). Emergency stop (owner): remove the `allUsers` `roles/run.invoker` binding from the `mcp` Cloud Run service.

## 5. Security

- Rules are bypassed, so the service enforces them: `loadBoard` checks `state`, `board.access[uid]` or the workspace role for `main` boards, owner for structure, editor for items, column locks, derived/server-managed refusal, no hard deletes, field-path writes, `updateTime` preconditions. A board outside the user's memberships reads as "not found". Workspace role is checked per call (viewer in A, owner in B is possible).
- Account status: consent page behind `AccountGate`; callables approved-only (the `approved-only.test.ts` allow-list is unchanged); every `/mcp` and `/token` request re-checks `accountStatus === 'approved'`.
- Audience binding via `expectedResource`; tokens are never forwarded anywhere.
- Scopes: every tool in `defineTools` gets `scope: 'read' | 'write'` and `annotations`; a write tool without `atrium:write` returns "This connection is read-only. Reconnect in Atrium and allow Write."
- Limits: SDK rate limits on `/authorize`, `/token`, `/register`, `/revoke`; `/mcp` per-uid 60 calls/min/instance and daily `mcpUsage` caps (2,000 calls, 500 writes; constants in `functions/src/mcp/limits.ts`); `maxInstances: 3`.
- DCR abuse: redirect allow-list, `client_name` <= 100, public clients only, TTL on unused clients.
- Audit: one `system/mcpAudit` entry per tool call, grant event and auth failure. Board history already records `updatedBy = uid`.
- Untrusted content: item text is data, not instructions (stated in tool descriptions); control characters stripped from returned strings; output caps stay; write tools never fetch URLs; `@[Name]` mentions need `atrium:write`.
- No CORS on `/mcp` or the OAuth endpoints. Never log tokens, codes or `Authorization`. The consent page renders client names as text only. No ids or emails in the repo.

## 6. Tool logic: `@atrium/mcp-core` and the actor model

**PR A prerequisite:** `description.mjs` and `updates.mjs` import `buildDescription`, `docToText`, `isEmptyDoc` from `apps/web/src/components/item-view/description.ts`. Move these pure functions to `packages/shared/src/description-doc.ts` (exported from the shared index); the web file re-exports; MCP code imports `@atrium/shared`.

**PR B:** `packages/mcp-core/` (`@atrium/mcp-core`, `"type": "module"`, `main ./src/index.mjs`, `types ./src/index.d.mts`) with `builders`, `description`, `errors`, `refs`, `service`, `tools`, `updates`, `values`, the fake client and tests moved from `scripts/mcp/`. `scripts/mcp/` keeps `atrium-mcp.mjs`, `lib/config.mjs`, `lib/client.mjs` (REST + gcloud) and `stdio.test.mjs`. Functions: tsconfig `paths`, tsup `noExternal`, vitest alias.

`createService({ client, actor, now })` with `actor = { uid, workspaceFilter }` replaces `config`: `workspace(id)` (cached; requires membership; viewer reads only), `loadBoard` derives the workspace from `board.workspaceId`, new `listWorkspaces()` via `runQuery('workspaces', { memberIds: { arrayContains: uid } })` (add `arrayContains` to both clients and the fake), `listBoards`/`createBoard`/`listMembers` take an optional `workspaceId` (default only when the user has exactly one workspace after the filter, otherwise "Give workspaceId; call atrium_list_workspaces first."). New tool `atrium_list_workspaces` (25 tools; update `EXPECTED` in `scripts/mcp/stdio.test.mjs` and `docs/mcp-connector.md`). Stdio: `ATRIUM_USER_UID` required; `ATRIUM_WORKSPACE_ID` optional filter.

**PR C:** `functions/src/mcp/admin-client.ts`: `createAdminClient(firestore)` implementing the same five methods (`getDoc`, `getDocMeta`, `listAllDocs`, `runQuery`, `commit`) so `service.mjs` is untouched: Date/`toMillis()` <-> `Timestamp`, preconditions mapped to `{ lastUpdateTime }` / `create`, field-path updates with `FieldPath`, `FieldValue.delete()`/`increment()`, gRPC `FAILED_PRECONDITION`/`ALREADY_EXISTS` mapped to `status: 409` so `mutateBoard`'s retry works. Emulator e2e test in `tests/rules/src/mcp-admin-client.e2e.test.ts` (this is the main technical risk, so no fakes).

**PR E wiring:** `functions/src/mcp/server.ts` `buildServerFor(authInfo, deps)` registers each `defineTools(service)` entry with scope enforcement, usage counter, control-character stripping, `McpUserError` -> `isError` text, and an audit entry; unexpected errors are logged and returned as "Unexpected error".

## 7. Web app (PR F)

- Route `/connect` (`apps/web/src/pages/connect/ConnectPage.tsx`) in the authenticated layout: loading, not found/expired ("Start again from Claude"), consent, done, error. Vibe components and tokens only, light and dark, phone layout.
- Settings -> Account tab -> "Connected apps" card (`ConnectedAppsCard.tsx`): lists `users/{uid}/mcpGrants` with `revokedAt == null` ("Claude - Read, Write - connected 3 Nov - last used today"), **Disconnect** with confirm -> `mcpCalls.revokeGrant`. Empty state: "No apps are connected. Add Atrium as a connector in Claude to see it here."
- Visual baselines for `connect` (light/dark) and the Account tab via the Update visual baselines workflow.

## 8. Local vs hosted

|              | Local stdio (OPS3)                      | Hosted (OPS4)                                 |
| ------------ | --------------------------------------- | --------------------------------------------- |
| Who          | `ATRIUM_USER_UID` from env              | the signed-in Atrium user (token -> uid)      |
| Where        | REST + `gcloud auth print-access-token` | Admin SDK, runtime service account            |
| Scope        | optional `ATRIUM_WORKSPACE_ID` filter   | all memberships, per-call role checks         |
| Registration | per machine, per project                | once per Claude surface                       |
| Limits       | none                                    | rate and daily limits, audit log, kill switch |

## 9. Tests

mcp-core: existing fake-client tests re-pointed at `actor`, plus viewer-in-A/owner-in-B, workspace filter, `listWorkspaces`, `listBoards` with one vs two workspaces, `createBoard` role check, `arrayContains`. Functions (vitest, fakes only; drive the app with `http.createServer` and `fetch`, no new dev dependency): provider (registration allow-list and public-client forcing, authorize, PKCE challenge lookup, exchange happy path / wrong client / wrong redirect / wrong resource / expired / replay revokes grant, refresh rotation and reuse detection, verify expired/kind/revoked), account gate (pending/blocked -> 401), scope enforcement, usage limits, audit, kill switch 503, exact well-known JSON, 401 header. Rules: `mcpGrants` self-read only, other collections denied, admin-client emulator test. One emulator e2e: `/register` -> `/authorize` -> `mcpAuthorize` as a seeded approved user -> `/token` -> `POST /mcp` `tools/list` and `atrium_list_workspaces` with the SDK's `StreamableHTTPClientTransport`. Also `functions-env.test.mjs` (key allowed, boolean), `mcp-hosting.test.mjs`, `stdio.test.mjs` (25 tools; exits without `ATRIUM_USER_UID`).

## 10. Dependencies and licences

`functions/package.json`: `@modelcontextprotocol/sdk` (MIT, same version as root), `express` (MIT), `fractional-indexing` (CC0). Run `pnpm licenses:notices`, commit `THIRD_PARTY_NOTICES.md`; `pnpm-lock.yaml` is a hot-spot, so keep the dependency change inside PR E.

## 11. Deploy: workflow vs owner

**Workflow on merge:** deploys the `mcp` function (public invoker), Hosting rewrites, rules and callables. No new IAM roles, secrets or schedulers.

**Owner/lead one-offs (single-line `gcloud`, project `atrium-board`, database `atrium-1`):**

1. Firestore TTL policies (checked 2026-11-11: only `activity`, `automationRuns` and `presence` have one, so `entries` is free): `gcloud firestore fields ttls update expiresAt --collection-group=mcpTokens --database=atrium-1 --project=atrium-board`, and the same for `mcpAuthRequests`, `mcpClients` and `entries`.
2. After the first deploy: `gcloud run services get-iam-policy mcp --region=europe-west1 --project=atrium-board` must list `allUsers` with `roles/run.invoker` (if a failed first deploy left it off, delete and redeploy; AGENTS.md gotcha).
3. Smoke: `curl -i https://atrium-workboards.web.app/.well-known/oauth-protected-resource/mcp` -> 503 while disabled, 200 after enabling; `curl -i -X POST https://atrium-workboards.web.app/mcp` -> 401 with the `WWW-Authenticate` header.
4. Connect: claude.ai -> Settings -> Connectors -> Add custom connector -> URL `https://atrium-workboards.web.app/mcp` (no client id/secret) -> Connect -> consent. Claude Code: `claude mcp add --transport http --scope user atrium https://atrium-workboards.web.app/mcp`, then `/mcp` -> Authenticate.

## 12. Rollout and rollback

1. PRs A-D merge with nothing user-visible.
2. PR E deploys the function **disabled** (`MCP_CONNECTOR_ENABLED=false`); run the one-offs 11.1-11.3.
3. PRs F and G merge; Roadmap item to In review, Actionable = Yes, with the connect steps.
4. Enable PR flips the env to `true`; connect with **Read only** first (`atrium_list_workspaces`, `atrium_list_boards`, `atrium_get_board`), then reconnect with Write and create an item on a scratch board.
5. Rollback ladder: flip the env back (PR, about 10 min); instant stop by removing the `allUsers` invoker binding; revert PR E. Leftover `mcpTokens` etc. expire by TTL.

## 13. PR breakdown

| PR           | Branch                          | Content                                                                                                      | Agent                               |
| ------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| A            | `claude/mcp-shared-description` | Move description helpers into `@atrium/shared`                                                               | Sonnet                              |
| B            | `claude/mcp-core-package`       | `packages/mcp-core`, actor model, `atrium_list_workspaces`, `arrayContains`, stdio config change, docs table | Fable                               |
| C            | `claude/mcp-admin-client`       | Admin SDK adapter + emulator e2e + functions aliases                                                         | Fable                               |
| D            | `claude/mcp-oauth-provider`     | provider, stores, tokens, callables, block hook, shared schemas, rules + tests                               | Fable                               |
| E            | `claude/mcp-function`           | function, rewrites, env key, deps + notices, hosting test, e2e; deploys disabled                             | Sonnet (Fable reviews 401/metadata) |
| F            | `claude/mcp-connect-page`       | `/connect` page, Connected apps card, baselines                                                              | Sonnet                              |
| G            | `claude/mcp-docs`               | `docs/mcp-connector.md` (hosted first), `docs/DEPLOY.md`, `docs/architecture.md`, handoff, Decisions D1-D7   | Sonnet                              |
| Enable       | `claude/mcp-enable`             | `MCP_CONNECTOR_ENABLED=true`                                                                                 | Sonnet                              |
| H (optional) | `claude/mcp-via-label`          | `updatedVia: 'mcp'`, "via Claude" in the activity log                                                        | Sonnet                              |

Each PR: `pnpm lint`, `typecheck`, `test`, `test:rules`, `build`, `licenses:check` green; rebase merge.

## 14. After OPS4: the MCP gap batches

New tools are written once, in `@atrium/mcp-core`, so they work in both modes. Order (from the 2026-11-11 gap plan): (1) restore/move/reorder items, groups, columns; likes and votes; people by email; REQ-1 enforcement in `convertValues`/`updateItem`; board lifecycle; column update/delete/lock with `scope: 'items'|'subitems'`; `atrium_find_items`; move item to another board (copy + retire; updates are not copied); (2) more column types and creating derived/server-managed column definitions (cells stay off-limits); (3) files (Cloud Storage with the same credentials; the hosted version uses the Admin SDK bucket); (4) views, forms, dashboards; (5) automations; (6) callable-only features (sharing, invites, column type change, buttons, time tracking) become reachable from the hosted function without a bridge.

## 15. Open items

Default choices, changeable on request: daily caps and `maxInstances: 3` (constants in `limits.ts`); `minInstances: 1` if cold starts make `/token` slow (measure after rollout).
