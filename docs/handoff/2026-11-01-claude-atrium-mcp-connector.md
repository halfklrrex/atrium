# 2026-11-01, Claude: OPS3 Atrium MCP connector

## Done

- Local stdio MCP server `scripts/mcp/atrium-mcp.mjs` with 13 tools (list/get board, create board, groups, columns, items, soft archive/delete, updates). Logic in `scripts/mcp/lib/*.mjs`, tests in `scripts/mcp/*.test.mjs` (in `pnpm test`).
- `scripts/showcase/firestore-rest.mjs`: added `runQuery(collectionId, where)` and an `update` commit op (dotted field paths, deletes, increments, `updateTransforms`).
- Docs: `docs/mcp-connector.md` (setup, env vars, tools, safety).
- Dependencies (root devDependencies): `@modelcontextprotocol/sdk`, `fractional-indexing` (same major as the web app), `zod` (same range as `packages/shared`, because the lib builds tool schemas).

## Next

- The owner registers the server per machine (`docs/mcp-connector.md`), then tries it on a throwaway board.
- Possible v2: subitems, people by email, rename/reorder columns, views, replies.

## Open questions and gotchas

- The default board has two groups both titled "Group Title", so group references by title are ambiguous until one is renamed; `atrium_create_board` returns the group ids and `atrium_rename_group` takes an id.
- Nothing was run against production in development; only fakes and the stdio `tools/list` test.
- No emulator end-to-end test: it needs the Functions emulator to check the triggers, which was not cheap. The fake client mirrors the commit semantics instead.
- `status` columns created through the connector have no blank "default" label (index 5) like boards created in the app; empty cells work without it.
- Run `claude mcp add` with `pnpm --silent`; any stdout noise breaks the protocol.
