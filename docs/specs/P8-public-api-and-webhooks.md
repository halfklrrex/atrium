# P8: Public API, personal tokens and webhooks

**Status:** draft for the owner's approval (2026-11-18). Roadmap group "P8 · Public API & webhooks": items 3306244834 (API design), 3306234499 (tokens), 3306234291 (webhooks), 3306244819 (limits and docs). The owner said "build on defaults"; the only stop points are marked **STOP**.

## 1. Goal and what already exists

One supported way for scripts, Apple Shortcuts, Zapier-style tools and other programs to read and change Atrium data, and for Atrium to notify other systems. Three things are already built and are reused, not redone:

- **The rule-enforcing service.** `@atrium/mcp-core` (`createService({ client, actor })`) implements every board, item, column, update, doc, file and team operation on top of the Admin SDK adapter (`functions/src/mcp/admin-client.ts`). It re-implements what the Firestore rules check (membership, board access, owner-only structure, locks, derived and server-managed columns, required columns, field-path writes). The hosted MCP connector runs on it, with 88 tools.
- **OAuth 2.1 server.** OPS4 gave Atrium its own authorization server (DCR, PKCE, rotating refresh tokens, grants in `users/{uid}/mcpGrants`, Settings → Connected apps, audit log, usage limits, kill switch). The item "OAuth 2.1 server" in P8 is therefore **done**; this spec only adds what is missing: personal tokens.
- **Event source.** Every change already writes `boards/{boardId}/activity/{id}` (kinds in `packages/shared/src/schemas/activity.ts`: `item_created`, `value_changed`, `update_posted`, `button_clicked` and so on), and `onActivityCreated` feeds the automation engine from it. Webhooks hang off the same stream.

So P8 is: **(A)** personal access tokens, **(B)** a documented HTTP API over the service, **(C)** outgoing webhooks, **(D)** incoming webhooks, **(E)** limits and API docs.

## 2. Decisions (log on the Decisions board; each has a default the owner may change)

| #   | Decision                                                                                                                                                                                                                                                                              | Why                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **JSON over HTTPS (REST-style, `/api/v1/...`) first, not GraphQL.** Resources: workspaces, boards, items, subitems, updates, columns, members. A GraphQL endpoint is a later add-on over the same service if the owner wants monday-shaped queries.                                   | `architecture.md` said "GraphQL modelled on monday". The service already returns plain JSON per operation, so REST is a thin mapping with no new query engine, no complexity limits and no new dependency. Shortcuts and curl work with it directly. |
| D2  | The API is a new Cloud Function `api` (Express, `onRequest`, `europe-west1`), reached through a Hosting rewrite `/api/**`, sharing the Admin client, the actor model and the usage limiter of `mcp`.                                                                                  | Same deploy, IAM and observability as the connector. No CORS: server-to-server and native clients only.                                                                                                                                              |
| D3  | **Two credential types**: OAuth access tokens (already issued by OPS4) and **personal access tokens** (PATs) created in Settings.                                                                                                                                                     | PATs are what scripts and Shortcuts need. Both resolve to `{ uid, scopes }` and run through one verifier.                                                                                                                                            |
| D4  | PATs are opaque `atrp_` + 32 random bytes (base64url), stored as SHA-256 hashes only, shown **once**, scopes `read` / `write` (same meaning as OPS4), optional **workspace restriction** and expiry (30 d, 90 d, 1 y; default 90 d; "no expiry" not offered). Max 10 active per user. | Least privilege and a bounded blast radius. A leaked read-only token restricted to one workspace is a small incident.                                                                                                                                |
| D5  | Authorization is the existing service: a token never has more access than its user. Blocked or pending accounts fail on every call. Role is checked per call.                                                                                                                         | Single enforcement point; no second permission model.                                                                                                                                                                                                |
| D6  | Webhook delivery uses a **Firestore queue plus the existing Cloud Scheduler pattern** (like `runTimeAutomations`), not Cloud Tasks or Pub/Sub.                                                                                                                                        | Cloud Tasks and Pub/Sub need new APIs and IAM grants (an owner step). A queue document plus a scheduled sweep every minute needs neither, and volume is tiny (a family-and-friends app).                                                             |
| D7  | Outgoing webhook signing secrets are stored in a Functions-only document (rules deny every client read), shown once at creation, rotatable. Secret Manager is not used in v1.                                                                                                         | Signing needs the plain secret. Secret Manager would be a per-webhook IAM and cost step for no real gain here. Revisit if the app is ever opened to strangers.                                                                                       |
| D8  | Webhooks are **per board**, created by the board owner. Incoming webhooks are per board too and create items only (no reads, no deletes).                                                                                                                                             | Matches how automations are owned and keeps the blast radius to one board.                                                                                                                                                                           |
| D9  | Outgoing deliveries are **HTTPS only**, to public hosts only (SSRF guard, section 6), at-least-once, with an event id for de-duplication.                                                                                                                                             | Safety first; no internal network, metadata server or localhost targets.                                                                                                                                                                             |

## 3. Personal access tokens (A)

**Data** (database `atrium-1`):

```
users/{uid}/apiTokens/{tokenId}   name (<=60), prefix (first 8 chars, for display), scopes[], workspaceIds[]|null,
                                  createdAt, expiresAt, lastUsedAt|null, revokedAt|null
apiTokenIndex/{sha256hex}         uid, tokenId, expiresAt          (Functions-only; TTL on expiresAt)
```

Rules: `apiTokens` self-read, no client write; `apiTokenIndex` denied entirely. Rules tests for both.

**Callables** (approved-only, `actorFromRequest`): `createApiToken({ name, scopes, workspaceIds?, expiresInDays })` returns `{ tokenId, token }` once; `revokeApiToken({ tokenId })`. Zod schemas in `packages/shared/src/api-tokens.ts`; web wrappers in `callables.ts`. `setAccountStatus` block also revokes the user's tokens (best effort, like grants).

**Verifier** `functions/src/api/auth.ts`: `Authorization: Bearer <token>`; `atrp_` prefix → hash → `apiTokenIndex`; otherwise the OPS4 access-token path. Result `AuthInfo { uid, scopes, workspaceIds|null, kind }`. 60-second per-instance cache (bounds revocation delay), account-status re-check, `lastUsedAt` written at most once a minute. Never log tokens.

**Web:** Settings → Account → "API tokens" card next to Connected apps: create dialog (name, Read / Write, workspace restriction, expiry), the token shown once in a copy box with a warning, a list (name, prefix, scopes, last used, expires) with Revoke + confirm. Vibe components and tokens only, light and dark, phone layout; visual baselines via the workflow.

## 4. HTTP API (B)

Base `https://atrium-workboards.web.app/api/v1`. JSON in and out, `Content-Type: application/json`, UTF-8. Errors: `{ "error": { "code": "not_found" | "forbidden" | "invalid" | "conflict" | "rate_limited" | "read_only" | "unauthorized", "message": "…" } }` with the matching 4xx. A board outside the caller's access is `404`, never `403`.

| Method and path                                          | Operation (service method)                                             | Scope        |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | ------------ |
| `GET /me`                                                | the caller, their scopes, the token's workspace restriction            | read         |
| `GET /workspaces`                                        | `listWorkspaces`                                                       | read         |
| `GET /workspaces/{id}/boards`                            | `listBoards`                                                           | read         |
| `GET /boards/{id}`                                       | `getBoard` (columns, groups, labels)                                   | read         |
| `GET /boards/{id}/items?group=&cursor=&limit=`           | `findItems` (paged, default 50, max 200)                               | read         |
| `GET /items/{id}`                                        | item with values keyed by column id and title, subitems nested         | read         |
| `POST /boards/{id}/items`                                | `createItems` (one or up to 50)                                        | write        |
| `PATCH /items/{id}`                                      | `updateItem` (name, group, values by column id or title)               | write        |
| `POST /items/{id}/subitems`                              | `createSubitems`                                                       | write        |
| `POST /items/{id}/duplicate`, `POST /items/{id}/archive` | `duplicateItem`, `archiveItem` (**no hard delete** over the API in v1) | write        |
| `GET /items/{id}/updates`, `POST /items/{id}/updates`    | `listUpdates`, `addUpdate` (plain text and `@[Name]` mentions)         | read / write |
| `GET /boards/{id}/members`                               | `listMembers`                                                          | read         |

Column values use the **same JSON shapes as the MCP tools and the web app** (`columnRegistry` validates; derived and server-managed columns refuse writes). Structure changes (columns, groups, board settings), docs, files, teams, automations and sharing stay MCP-only in v1; the table grows by mapping more service methods, one file per resource in `functions/src/api/routes/`. An OpenAPI 3.1 document (`functions/src/api/openapi.ts`, generated from the same zod schemas where they exist) is served at `GET /api/v1/openapi.json` and rendered on a docs page (section 7). `scripts/api-parity.test.mjs` fails when a route has no OpenAPI entry or an OpenAPI path has no route.

Idempotency: `POST` accepts `Idempotency-Key` (max 64 chars); the response of the first call is kept in `apiIdempotency/{uid}_{key}` (24 h TTL) and returned again. Concurrency uses the service's `updateTime` preconditions and retry; a conflict that survives the retry is `409`.

## 5. Webhooks

### 5.1 Outgoing (C)

```
boards/{boardId}/webhooks/{id}        name, url (https), events[] (activity kinds, or ["*"]), enabled, createdBy, createdAt,
                                      consecutiveFailures, disabledReason|null, lastDeliveryAt|null      (client: owner read; no write)
boards/{boardId}/webhookSecrets/{id}  secret                                                             (Functions-only)
webhookDeliveries/{id}                boardId, webhookId, eventId, payload, attempt, nextAttemptAt, status pending|sent|failed|dead,
                                      lastStatus?, lastError?, createdAt, expiresAt                      (Functions-only; TTL 14 d)
```

- **Callables** (board owners only): `createWebhook`, `updateWebhook`, `deleteWebhook`, `rotateWebhookSecret`, `testWebhook` (sends a `ping` event). Max 5 webhooks per board.
- **Producer:** the existing `onActivityCreated` trigger also calls `enqueueWebhooks(boardId, activity)`: it loads the board's enabled webhooks once, and writes one `webhookDeliveries` doc per match (id `${webhookId}_${activityId}`, so retries of the trigger are idempotent). Entries written by webhooks' own API clients are delivered like any other (no loop, because the API does not read webhooks). Automations that call an external system stay out of scope.
- **Consumer:** a scheduled function `deliverWebhooks` (every minute, same pattern as `runTimeAutomations`) claims due deliveries (`nextAttemptAt <= now`, limit 50, transactional claim), POSTs, and records the result. Timeout 5 s, no redirects followed, response body not stored beyond 500 chars. Retries at 1, 5, 30 minutes and 3 hours (five attempts), then `dead`. 20 consecutive failures disable the webhook (`disabledReason`), and the board owner gets a notification.
- **Payload** (JSON, size capped at 64 KB, item text truncated):
  `{ "id": "<eventId>", "type": "value_changed", "createdAt": "…", "boardId": "…", "itemId": "…", "itemName": "…", "columnId": "…", "actor": { "id": "…", "name": "…" }, "data": { "from": …, "to": … } }`. No emails. Values use the API's column-value shapes.
- **Headers:** `Atrium-Event-Id`, `Atrium-Event-Type`, `Atrium-Timestamp`, `Atrium-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>" with the secret>`. Receivers reject timestamps older than 5 minutes. The docs page shows verification snippets (Node, Python, shell).

### 5.2 Incoming (D)

`https://atrium-workboards.web.app/api/hooks/{hookId}.{secret}` accepts `POST` JSON `{ name, values?, group? }` and creates one item on that board as a "Webhook" actor (updatedVia `webhook`, shown with the hook's name in the activity log). Data `boards/{boardId}/incomingHooks/{id}` (name, createdBy, enabled; no secret) plus `incomingHookIndex/{sha256hex}` (Functions-only). Created, rotated and deleted by board owners through callables. Limits: 60 calls a minute and 1,000 a day per hook, body ≤ 64 KB, values validated by `columnRegistry` (a bad column returns `400` and creates nothing). The secret is in the URL path by design (Shortcuts and form tools can't set headers); the web UI shows it once and the logs never print the path.

## 6. Security

- **Rules are bypassed on the server, so the service is the gate.** Every route resolves the board through `loadBoard`, which applies membership, board access, role and column checks. No route accepts a uid from the client. A route test per resource proves: a non-member gets 404, a viewer can't write, a read-only token can't write, a workspace-restricted token can't see other workspaces, a blocked account is refused.
- **SSRF guard for outgoing webhooks** (`functions/src/api/ssrf.ts`, unit-tested hard): scheme `https` only; port 443 only; the hostname is resolved at delivery time and **every** returned address must be public (reject loopback, link-local including 169.254.169.254, private ranges, CGNAT, IPv6 ULA and mapped addresses, multicast, `*.internal`, `*.local`, bare IPs in the URL); connect to the resolved address (pinned, to defeat DNS rebinding) with the original `Host`/SNI; no redirects. Checked again when the webhook is saved so the owner gets a clear error early.
- **Limits** (`functions/src/api/limits.ts`, same `MinuteLimiter` + daily counters as OPS4): per token 120 calls a minute and 5,000 a day, 1,000 writes a day; per IP 300 failed-auth attempts an hour; every limit returns `429` with `Retry-After`. Body size cap 256 KB on the API, 64 KB on incoming hooks. Constants live in one file.
- **Audit:** `system/apiAudit/entries/{id}` (TTL 90 d) records token created / revoked, auth failures, writes (route, board, ok, ms) and webhook disabled. Board history already records `updatedBy`.
- **Privacy:** payloads and logs carry ids and display names only, never emails; the privacy notice (`privacy-content.ts`) gains a sentence on tokens, webhook payloads and the audit log. Strings returned to callers have control characters stripped (as OPS4).
- **Kill switches:** `API_ENABLED` and `WEBHOOKS_ENABLED` env flags (allow-listed in `scripts/functions-env.test.mjs`), default `false` at first deploy, flipped after the smoke test. Emergency stop: remove the `allUsers` invoker binding from the `api` Cloud Run service.
- No CORS, no cookies, no GET with side effects, tokens only in the `Authorization` header (never in a query string).

## 7. API docs page (E)

A public static page `/developers` in the web app (no sign-in; linked from Settings → API tokens and the About dialog): authentication, an end-to-end curl example, the route table, error codes, limits, webhook payloads and signature verification snippets, and the OpenAPI link. Rendered from `openapi.json` plus hand-written MDX-free React sections; Vibe typography and tokens. No interactive playground in v1 (a "Try it" box is a possible follow-up).

## 8. PR plan (each small, hot-spot PRs merge in order)

| PR  | Content                                                                                                                                                                                     | Hot spots                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | Data, rules and callables for PATs; shared schemas; rules tests; `api/auth.ts` verifier with tests (no route yet)                                                                           | `firestore.rules`, `tests/rules`, `packages/shared` |
| 2   | Settings "API tokens" card, create-once dialog, revoke; privacy notice sentence; baselines                                                                                                  | baselines                                           |
| 3   | Function `api` + `firebase.json` rewrite (`/api/**`), router, error model, limits, audit, idempotency, routes for `me`, workspaces, boards, items (read); tests; deployed **disabled**      | `firebase.json`                                     |
| 4   | Write routes (items, subitems, updates, archive, duplicate) with the per-route security tests                                                                                               | none                                                |
| 5   | OpenAPI document, parity test, `/developers` docs page                                                                                                                                      | baselines                                           |
| 6   | Outgoing webhooks: data, rules, callables, `ssrf.ts`, producer in `onActivityCreated`, `deliverWebhooks` scheduler, delivery tests with a fake `fetch` and a fake DNS resolver              | `firestore.rules`, `tests/rules`                    |
| 7   | Webhooks UI (board menu → Integrations: list, create, test, rotate, delivery log) and incoming hooks (data, rules, callables, `POST /api/hooks/…`, UI)                                      | baselines                                           |
| 8   | Showcase additions (a sample token-less webhook and incoming hook entry on the showcase board is **not** seeded; the seeder only gets a note), `docs/mcp-connector.md` cross-links, HANDOFF | none                                                |

Each PR keeps the checks green (`pnpm lint`, `typecheck`, `test`, `test:rules`, `build`). PR 3 and PR 6 are the **ultrareview batch** (the owner triggers `/code-review ultra <PR#>`; only the owner can).

## 9. Tests

Unit: token hashing and verifier (expired, revoked, wrong prefix, blocked account, workspace restriction, cache); `ssrf.ts` (every rejected range, IPv6 forms, decimal/octal/hex IP spellings, DNS returning one private address among public ones, rebinding between check and connect); HMAC signature vector; retry schedule and dead-lettering; idempotency replay; limiter. Route tests with the fake client (same fixtures as mcp-core): per resource, the permission matrix above. Emulator e2e (`tests/rules/src/*.e2e.test.ts`): PAT create → call → revoke → 401; an item write produces a delivery doc; the scheduler claims it exactly once under two concurrent sweeps. Rules tests: `apiTokens`, `apiTokenIndex`, `webhooks`, `webhookSecrets`, `webhookDeliveries`, `incomingHooks`, `incomingHookIndex`. `scripts/api-parity.test.mjs` as in section 4. `scripts/database-id.test.mjs` already guards the database id for the new triggers and clients.

## 10. Deploy: workflow vs owner

**Workflow on merge:** deploys `api`, the new callables, the scheduler job and Hosting rewrites. No new IAM roles and no secrets.

**Owner/lead one-offs** (single-line `gcloud`, project `atrium-board`, database `atrium-1`):

1. Firestore TTL policies on `expiresAt` for `apiTokenIndex`, `webhookDeliveries`, `apiIdempotency` and the audit `entries` group (the `mcpTokens` ones from OPS4 are separate).
2. After the first deploy, `gcloud run services get-iam-policy api --region=europe-west1 --project=atrium-board` must list `allUsers` with `roles/run.invoker`; if not, delete and redeploy (AGENTS.md gotcha). Same check for the scheduler's target and the new callables.
3. Smoke: `curl -i https://atrium-workboards.web.app/api/v1/me` → `503` while disabled, `401` after enabling; with a token `200`.
4. Enable: set `API_ENABLED=true` (then `WEBHOOKS_ENABLED=true`) in `functions/.env.atrium-board` in a PR.

**STOP points:** none expected. Cloud Tasks, Secret Manager or an email/SMS notification of a disabled webhook would each need an owner step, and none is used.

## 11. Out of scope for v1

GraphQL endpoint, hard delete and structure changes over the API, per-user webhooks, webhook payload templates and filters beyond event kinds, an interactive API playground, API versions other than `v1`, cross-workspace tokens for other people, SCIM, and a public rate-limit dashboard.

## 12. Owner questions (all have defaults; answer on monday, Actionable = Yes)

1. REST first and GraphQL later (default), or GraphQL in v1?
2. Token expiry choices 30 d / 90 d / 1 y with 90 d default and no "never expires" (default), or allow "never"?
3. No hard delete over the API in v1 (default)?
4. Webhooks owned by board owners, max 5 per board (default)?
5. Webhook secret stored in a Functions-only Firestore doc (default) or in Secret Manager (needs a one-time IAM grant from you)?
6. Public `/developers` docs page reachable signed out (default), or signed-in only?
