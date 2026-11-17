# MCP batch 2 PR 2: Docs tools

Branch `claude/mcp-2-2-docs`. Implements PR 2 of `docs/specs/MCP-gap-batch-2.md` (7 tools: `atrium_list_docs`, `atrium_get_doc`, `atrium_create_doc`, `atrium_write_doc`, `atrium_rename_doc`, `atrium_delete_doc`, `atrium_restore_doc`). No changes to rules, indexes, `packages/shared`, `firebase.json`, the lockfile or visual baselines.

## What changed

- `tools/docs.mjs` and `service/docs.mjs` (one import line each in `tools.mjs` and `service.mjs`); names added to `DOMAIN_TOOLS` in `tools-parity.test.mjs`.
- **Converter** (`description.mjs`): GFM pipe tables <-> `table`/`tableRow`/`tableHeader`/`tableCell` (header row of `tableHeader`, cell attrs `{ colspan: 1, rowspan: 1, colwidth: null }`, one paragraph per cell, `\|` for a literal pipe); mentions read as `@[Name]` (was `@Name`, so `atrium_list_updates` markdown changed too); images read as `![alt](atrium-doc-image:<fileId>)`. `richNodeTypes` no longer flags tables and mentions, except `table` (no header row) and `tableCell` (merged cells, blocks or a line break in a cell).
- **Mentions** (`updates.mjs`): `resolveMentions(doc, resolver)` (new, exported) and a `scope` word in `memberResolver`'s error. `atrium_set_item_description` now resolves `@[Name]` too; its snapshot entry in `tools-snapshot.json` was regenerated deliberately (description only).
- **Writes**: body write is `rev + 1`; a first body is `set` with `exists: false`, later ones `patch` with the body's `updateTime` precondition (the Admin adapter does not support `set` with `updateTime`, `patch` does). A raced write restarts once so the guards see the new state. Create commits the meta and the body together.
- Consent copy (`ConnectPage.tsx`) and its test; `docs/mcp-connector.md` (tool table, scope table, Docs section, Safety, follow-ups).
- Tests: `packages/mcp-core/src/docs.test.mjs` (19 cases), emulator `tests/rules/src/mcp-docs.e2e.test.ts`.

## Notes

- Root position: after the last root position among the workspace's boards, dashboards and docs (the web uses docs only; the spec asked for all three).
- Trashed docs: every tool refuses them except `atrium_restore_doc` (repeating it on an active doc is a no-op) and the `deleted` list.
- The mention notification comes from the existing `onDocBodyWritten` trigger; nothing server-side changed.
- Not done (spec says later): doc images, sharing (PR 8).
