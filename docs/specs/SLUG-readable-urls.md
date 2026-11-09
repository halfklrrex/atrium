# SLUG: readable board, workspace and dashboard URLs

**Owner request (2026-11-09):** board URLs should carry the board's name instead of only a random id.

## Decision

Keep the Firestore document id as the identity and put a **slug of the name in front of it**: `/boards/q4-roadmap-8fK2xQ…`. Pure name-as-id is rejected: a document id cannot change, so renames would break links; names are not unique; and ids are referenced by item paths, rules, favourites, dashboards, automations and the MCP. This is the Notion/Linear pattern. A fully clean `/boards/q4-roadmap` (a unique slug field per workspace with collision and rename handling) is out of scope.

## Behaviour

- URL form: `/<kind>/<slug>-<id>` for `boards`, `workspaces` and `dashboards`, plus the existing suffixes (`/views/:viewId`, `/items/:itemId`, `/trash`). View and item ids stay bare.
- **Resolve by id only.** The route param is parsed by `idFromSlugParam(param)`: if it is a valid id on its own, use it; otherwise take the text after the **last** `-`. (Firestore auto ids are `[A-Za-z0-9]` and never contain `-`; the implementer verifies every code path that creates boards, workspaces and dashboards uses auto ids, and the MCP/showcase/templates too. If any creates ids with `-`, use a `--`-free alternative separator and say so in the PR.) The slug text is never trusted or looked up.
- **Old links keep working:** a bare id (`/boards/8fK2xQ…`) still opens the board.
- **Canonical URL:** once the board loads, if the param's slug differs from the current name's slug (renamed board, bare id, mangled slug), `navigate(canonicalPath, { replace: true })` so the address bar shows the current name. Do this without remount flicker and without a redirect loop (compare slugs, replace once). Keep the query string and hash.
- **Slug rules** (`slugify` in `packages/shared`, pure, tested): Unicode NFKD, strip combining marks, lower-case, non-alphanumerics to `-`, collapse and trim dashes, cap at 40 characters (cut at a dash if possible), empty result (emoji-only or non-Latin names) becomes `board`/`workspace`/`dashboard`. Non-Latin letters may be kept as-is only if `encodeURIComponent` handling is clean; the simple, safe default is transliteration-free ASCII with the fallback word.
- **Helpers (single source):** `boardPath(board, rest?)`, `workspacePath(ws, rest?)`, `dashboardPath(d)` in `apps/web/src/lib/paths.ts`, taking `{ id, name }`. Replace every hand-built path (find them with `rg "'/boards/|\`/boards/|/workspaces/\\$\\{|/dashboards/\\$\\{" apps functions`): Sidebar tree, favourites, workspace lists, Home, search results, board header, board menu, dialogs that navigate after create, `view-paths.ts`, `item-view-store.ts`, `open-item.ts`, invite page, trash, dashboards. Callers that only have an id (a link from a notification or a mention) may use the bare-id form; it redirects to canonical after load.
- `useMatch('/boards/:boardId/*')` users (`useCurrentWorkspace`, `Sidebar`, `BoardMenu`) must go through `idFromSlugParam`. Grep every `useParams`/`useMatch` that reads `boardId`, `workspaceId` or `dashboardId`.
- **Not changed:** public form links (`/forms/:boardId/:viewId`), invite links (`/invite/:workspaceId/:inviteId`), admin and feedback routes, and any Firestore path. Push notification links in `functions/src/lib/push.ts` keep the bare id (the app canonicalises on load; the function has no board name handy).
- Copy-link buttons (item view, share dialogs, board menu) copy the canonical URL.
- Firebase Hosting rewrites already send everything to the SPA; check `firebase.json` needs no change.

## Tests

- `slugify` cases: accents, spaces and punctuation, emoji only, very long names, leading/trailing symbols, uppercase, numbers.
- `idFromSlugParam`: bare id, `slug-id`, slug with many dashes, trailing dash, empty, junk.
- Router/page tests: opening `/boards/old-name-<id>` shows the board and replaces the URL with the current name; a bare id also canonicalises; no navigation loop (assert the replace happens once); item and view sub-routes keep their ids and query.
- Existing tests that assert `/boards/${id}` links are updated to the helper's output. `pnpm lint`, `typecheck`, `test`, `build`; update visual baselines only if a screenshot shows a URL (it should not).

## Out of scope

Per-workspace unique slugs, custom domains, short links, slugs for folders, items or views, changing stored ids.

## Work split

One Sonnet 5.5 subagent (medium), worktree `claude/slug-urls`, own `ATRIUM_PORT_OFFSET`. It touches many web files but no hot-spot file except possibly `packages/shared/**` (a new `slugify` module and test: keep that part small). Opus reviews the diff and runs the checks and a Chrome pass (rename a board, open an old link, copy link, browser back button), then merges with `gh pr merge --rebase`.
