# P8 docs: incoming webhooks in OpenAPI and on /developers

Branch `claude/p8-docs-hooks`. Docs-only follow-up to P8 PR 7a (`docs/handoff/2026-11-18-claude-p8-pr7a.md`).

## What changed

- `functions/src/api/openapi.ts`: a separate path `/api/hooks/{token}` (POST only, `security: []`) with a path-level `servers` override (`https://atrium-workboards.web.app`), so the key is the real path and the document's `/api/v1` server stays untouched. Request body from `incomingHookBodySchema` via `z.toJSONSchema`, the `Idempotency-Key` parameter, responses 201 `{ id, boardId }`, 400, 404 (uniform), 409, 413, 422, 429 (own `HookRateLimited` response), 503. Limits come from the shared constants. New tag "Incoming webhooks".
- `scripts/api-parity.test.mjs`: the strict `/api/v1` checks are unchanged (they now ignore the `/api/hooks/` entry); new tests read `functions/src/api/hooks.ts` (`HOOKS_BASE_PATH` plus `router.post('/:token')`), require exactly one hook route with a matching OpenAPI entry, require the page to document it and read the shared limit constants, and pin the constants (60, 1000, 64 KB).
- `/developers`: new "Incoming webhooks" section (what it is, Board menu > Integrations for owners, URL shown once, curl, body fields, answers table, limits, Idempotency-Key, activity log "Webhook: <name>"), a table-of-contents entry, and the Webhooks section names Board menu > Integrations. The facts import the shared constants; tests pin them.
- Tests: `openapi.test.ts` and `DevelopersPage.test.tsx` extended.

## Next

- The `/developers` screenshots change: run the "Update visual baselines" workflow on the PR branch and review the image diffs. No baselines are committed here.
- The page names the Integrations dialog from PR #339; check the wording against the final dialog.
