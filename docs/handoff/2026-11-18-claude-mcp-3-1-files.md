# 2026-11-18 Claude: MCP batch 3 PR 1, files tools

Branch `claude/mcp-3-1-files` (port offset 80). Spec: `docs/specs/MCP-gap-batch-2.md`, PR 7.

## Done

- `serverOps` adapter: `createService({ ..., serverOps? })`; tools marked `requires: 'server'` are registered only when it is given (`defineTools` drops them for a service with `hasServerOps === false`; a bare object lists everything, for catalogue tests). `serverToolNames()` lists them. The stdio server passes none, so it lists 67 tools; the hosted one 70.
- Tools (`tools/files.mjs`, `service/files.mjs`): `atrium_list_files` (both modes, Firestore metadata, uses `updatesCount` and `repliesCount` to skip empty posts, 200 items cap), `atrium_get_file_link`, `atrium_upload_file` (512 KB), `atrium_delete_file` (Files column and update or reply attachments).
- `functions/src/mcp/server-ops.ts`: `createServerOps(deps)` calls `requestFileUploadInTransaction` (with a bucket whose upload signer is stubbed: no URL is signed), writes the object directly, then `finalizeFileUploadInTransaction`; link and delete call the callables' library functions. `HttpsError` becomes `McpUserError`. A failed finalize deletes the object. Wired lazily in `mcp/index.ts`.
- Audit: `fileId` is now the first target key (`targetKind: file`).
- IAM check: `mcp`, `getfiledownloadurl` and `finalizefileupload` Cloud Run services run as the same default compute service account, so nothing new is needed.

## Gaps and gotchas

- No emulator e2e: the rules emulator run does not start Storage; the adapter is covered by unit tests with fakes. Owner check in production: a 300 KB image uploads and its link opens; 600 KB is refused.
- Posting an update with an attachment is not in this plan.
- Merge conflicts to expect with the dashboards PR: import lines in `tools.mjs`, `service.mjs`, `index.d.mts`, the parity test list and the counts in `docs/mcp-connector.md`.
