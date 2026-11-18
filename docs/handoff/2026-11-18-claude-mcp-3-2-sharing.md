# 2026-11-18 Claude: MCP batch 3 PR 2, sharing tool

Branch `claude/mcp-3-2-sharing` (port offset 60). Spec: `docs/specs/MCP-gap-batch-2.md`, PR 8. Owner decisions of 2026-11-17 apply: workspace members only, never invites, workspace roles or removing members, hosted-only.

## Done

- `atrium_set_access` (hosted-only, `change`, destructive): `target` board, doc or dashboard, `id`, `kind?`, `person?: { who, role }`, `dryRun?`, `allowDataLoss?`. `tools/sharing.mjs`, `service/sharing.mjs`.
- `ServerOps.setAccess` (`functions/src/mcp/server-ops.ts`): calls `setBoardKindInTransaction` and `setBoardAccessInTransaction` (boards) or `setEntityAccessInTransaction` (docs and dashboards) in one Firestore transaction with the callables' own adapters. A dry run runs the same checks and writes nothing. Returns the before and after sharing state and the workspace roles; the service turns that into gained, lost and changed lists.
- Boards: the kind change and the person change are two library calls, so the adapter buffers writes and activity entries until both have read, then writes once (Firestore refuses a read after a write).
- Guard: anyone losing effective access (a main object going private counts), or the actor ceasing to be an owner, needs `allowDataLoss`. Role changes of others are reported, not guarded.
- Reads: `access: [{ uid, name, role }]` on `atrium_get_board`, `atrium_get_doc`, `atrium_get_dashboard` (the object's own access map).
- Docs: `docs/mcp-connector.md` (77 hosted, 73 local, 4 hosted-only).

## Gaps and gotchas

- `list_*` rows do not carry `access` (spec says the read tools; I added it to the three single reads only).
- A board request with neither a kind change nor a person returns "no change" without running the owner check (reads are open to any reader anyway).
- The dry run and the real run are two transactions; the real run enforces the library's checks again, only the guard report can lag a concurrent change.
- Merge conflicts to expect with the automations PR: import lines in `tools.mjs`, `index.d.mts`, the parity list in `tools-parity.test.mjs`, and the counts in `docs/mcp-connector.md`.
