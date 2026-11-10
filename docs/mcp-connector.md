# Atrium MCP connector

A local MCP server (stdio) that lets Claude create and edit boards, groups, columns, items and updates in the live Atrium. Nothing is deployed: it runs on the owner's machine, only when Claude Code starts it. Spec: `docs/specs/OPS3-atrium-mcp-connector.md`.

It writes to Firestore (`atrium-board`, database `atrium-1`) through the REST API with `gcloud auth print-access-token`, like the showcase seeder (`docs/showcase.md`). That is an admin-style write that bypasses security rules, so the connector enforces the rules itself (see Safety).

## Setup (once per machine)

1. Be signed in to `gcloud` (`gcloud auth login`) with the account that owns the project.
2. Find your workspace id and your Atrium user uid (Firebase console or the app's URL; keep them in `.private/project-ids.md`, never in the repo).
3. Register the server with Claude Code. Use `--scope local` so the ids stay on this machine:

```
claude mcp add atrium --scope local ^
  -e ATRIUM_WORKSPACE_ID=<workspace-id> ^
  -e ATRIUM_USER_UID=<your-user-uid> ^
  -- pnpm --silent --dir D:\DevProjects\Atrium\atrium-cl exec tsx scripts/mcp/atrium-mcp.mjs
```

(`^` is the Windows line continuation; put it on one line in a POSIX shell.) `--silent` matters: stdout is the protocol channel and must stay clean.

**Picking up new tools (no reinstall).** The server is not installed anywhere: Claude Code starts it from the checkout named in the `claude mcp add` command (`pnpm exec tsx scripts/mcp/atrium-mcp.mjs`) every time a session starts, so there is no build step and no re-registration. To get a new tool: (1) update that checkout to a commit that has it (`git pull` on `main` after the PR merges), then (2) restart Claude Code, or run `/mcp` and reconnect `atrium`. A running session keeps the old tool list until you do (2). Only if the registration points at an old or different folder do you need `claude mcp remove atrium` and add it again with the right path.

To re-register after a change, run `claude mcp remove atrium` and add it again. Check with `claude mcp list`; inside Claude Code `/mcp` shows the 24 tools.

## Environment variables

| Variable              | Meaning                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATRIUM_WORKSPACE_ID` | The one workspace the server may touch. Required: without it the server exits and writes nothing.                                                                                  |
| `ATRIUM_USER_UID`     | The Atrium user the writes are attributed to (`createdBy`, `updatedBy`, board owner). Must be a non-viewer member of the workspace; checked at startup and on first use. Required. |
| `ATRIUM_PROJECT`      | Default `atrium-board`.                                                                                                                                                            |
| `ATRIUM_DATABASE`     | Default `FIRESTORE_DATABASE_ID` (`atrium-1`).                                                                                                                                      |
| `ATRIUM_EMULATOR`     | `host:port` of a local Firestore emulator; uses the `Bearer owner` token. Only local addresses are accepted. For tests.                                                            |

## Tools

Columns are addressed by id or title (case-insensitive, must be unambiguous); so are groups. Every tool returns compact JSON; errors come back as a plain message.

| Tool                                                               | What it does                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atrium_list_boards`                                               | Read-only. Active boards of the workspace.                                                                                                                          |
| `atrium_get_board`                                                 | Read-only. Columns (with labels), groups and active items with readable values keyed by column title; subitems nested.                                              |
| `atrium_create_board`                                              | New board with the default Person/Status/Date columns and two groups, no sample items.                                                                              |
| `atrium_add_group` / `atrium_rename_group` / `atrium_delete_group` | Group changes. Delete refuses while the group has active items, and never removes the last group.                                                                   |
| `atrium_add_column`                                                | Adds `text`, `long_text`, `numbers`, `status`, `dropdown`, `date`, `timeline`, `checkbox`, `link`, `people`, `tags` or `rating`. Labels go in `settings.addLabels`. |
| `atrium_update_column_settings`                                    | Adds status labels, dropdown options or tags (`addLabels`) and changes other settings. Never changes the type or removes a label.                                   |
| `atrium_create_items`                                              | Up to 50 items per call, appended to their groups, with plain cell values.                                                                                          |
| `atrium_update_item`                                               | Changes name, group and/or cells. Field-path patch: only the given cells change; `null` clears one.                                                                 |
| `atrium_get_item_description`                                      | Read-only. The item's rich-text description as markdown, plus plain text and the names of nodes markdown cannot show (images, tables, mentions).                    |
| `atrium_set_item_description`                                      | Writes the description from markdown (see below). `mode` `replace` (default) or `append`.                                                                           |
| `atrium_archive_item` / `atrium_delete_item`                       | Soft only (`state` archived or deleted). Restore in the app.                                                                                                        |
| `atrium_list_updates`                                              | Read-only. An item's updates (comments), newest first, with replies, authors, likes, mentions and attachment metadata (name, size, type; no download).              |
| `atrium_add_update` / `atrium_add_reply`                           | Post an update in the item's (or subitem's) feed, or a reply in an update's thread. Markdown body, `@[Name]` mentions (see below). Bump the counters.               |
| `atrium_edit_update` / `atrium_delete_update`                      | Edit or delete the configured user's own update, or reply when `replyId` is given.                                                                                  |
| `atrium_list_subitems`                                             | Read-only. An item's subitems with values keyed by subitem column title, plus the subitem columns.                                                                  |
| `atrium_create_subitems`                                           | Up to 50 subitems under a top-level item, in its group, after its other subitems, with plain cell values.                                                           |
| `atrium_duplicate_item`                                            | Copies an item (with its active subitems) or a subitem as "Name (copy)" next to the original, with its values.                                                      |
| `atrium_get_activity`                                              | Read-only. Recent board activity (newest first), optionally for one item and its subitems.                                                                          |
| `atrium_list_members`                                              | Read-only. Workspace members (uid, name, email, role), or those who can see one board.                                                                              |

Cell values: status takes a label text; dropdown and tags take label texts; date `"YYYY-MM-DD"`; timeline `["YYYY-MM-DD","YYYY-MM-DD"]`; checkbox `true/false`; rating a number; link a URL; people a workspace member uid or `"me"` (emails are not supported yet). Values are converted to the stored shape and checked by `columnRegistry.validateCell`, so the app never sees data it would reject.

Descriptions: `atrium_set_item_description` takes markdown-ish text (headings `#`, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[links](https://...)`, `-`/`1.`/`- [ ]` lists with indented nesting, `>` quotes, fenced code, `---`) and converts it to the ProseMirror JSON the web editor stores. The value is built by the web app's own `buildDescription` (`apps/web/src/components/item-view/description.ts`: empty becomes `null`, size cap, plain-text field for search) and checked with `itemDescriptionSchema`, then written as the whole `description` field like the app does, so it matches the `validDescription` rule. HTML is never interpreted and only `http(s):` and `mailto:` links are kept. Replacing a description that holds images, tables, mentions or emoji is refused (markdown cannot write them back, and images are tied to `descriptionImages`); use `append`, which leaves existing content untouched, or pass `allowOverwriteRich: true`. Empty markdown with `replace` clears the description.

Subitems are items with a `parentItemId`, stored in the same `items` collection, in the parent's group, using `board.subitemColumns` (`atrium_get_board` lists them next to `columns`). A subitem's id works with `atrium_update_item` (name and cells by subitem column title; its group cannot change), `atrium_get_item_description` / `atrium_set_item_description`, `atrium_add_update`, `atrium_archive_item` and `atrium_delete_item`. Moving a parent moves its subitems, and archiving or deleting it takes them along, as in the web app. A board with no subitem columns gets monday's defaults (Owner, Status, Date) on the first `atrium_create_subitems`, as the web does; that needs the board owner role.

Updates: the text is markdown (same conversion as descriptions) stored as the `contentDoc` the composer writes, with the plain-text mirror from the app's `docToText`, checked by `createItemUpdateInputSchema`. `@[Name]` (display name, email or uid of a member who can see the board; `@[me]` for yourself) becomes a mention chip and goes in `mentions`, so the existing Functions notify that person. Mentions are fixed when a post is created: `atrium_edit_update` keeps `@[Name]` as plain `@Name` text. Editing and deleting are limited to the configured user's own posts (the rules also let board owners moderate; the connector does not). Deleting a post is a hard delete, like the app's; counters move down only while positive.

Example flow: `atrium_list_boards`, then `atrium_get_board` (columns, groups, subitem columns), `atrium_list_members` (uids for People cells), `atrium_create_items` / `atrium_create_subitems`, `atrium_add_update` with `Thanks @[Jordan Lee], done`.

## Safety

- Every tool loads the board first and checks: `workspaceId` is the configured one, `state` is `active`, and the configured user has a role on it (board `access`, or, on `main` boards, the role implied by the workspace role). Structure changes need `owner`; item changes `editor` or `owner`. A board of another workspace looks the same as a missing one.
- Structure changes (groups, columns) read the board, change it and write it with an `updateTime` precondition, retrying once on a conflict.
- Never written: `derivedColumnIds`, `serverManagedColumnIds`, `seq`, `boardSeq`, `descriptionImages` (existing images are never touched), notifications, activity. Derived and server-managed columns cannot be set; locked columns are refused to non-owners.
- No hard deletes of boards, items or structure; the only hard deletes are the configured user's own updates and replies. No tool touches folders, workspaces, roles, invites or other users' data; `atrium_list_members` only reads names and emails of workspace members.
- Inputs are zod-validated; ids must match `/^[A-Za-z0-9_-]{1,128}$/`.
- The Cloud Function triggers (`onItemCreated` sets `seq`/`boardSeq`, `onBoardColumnsWritten` maintains the derived id lists) run on these writes like on any other.

## Code and tests

- `scripts/mcp/atrium-mcp.mjs`: thin stdio wiring. `scripts/mcp/lib/`: config, client, refs, value conversion, builders, service and tool catalogue. `scripts/mcp/fake-client.mjs`: in-memory Firestore for tests.
- `scripts/showcase/firestore-rest.mjs` gained `runQuery` and an `update` commit op (field paths, deletes, increments).
- `pnpm test` runs `scripts/mcp/*.test.mjs` (fakes only, no emulator and no production access; one test spawns the server over stdio and calls `tools/list`). `pnpm mcp` starts the server by hand.

## Not yet possible (follow-ups)

- Uploading or downloading files (the Files column and update attachments need the upload callables and signed URLs).
- Likes, reordering, restoring items from the trash, moving items between boards, deleting boards, and folder, workspace or sharing changes.
- Creating or changing subitem columns beyond the defaults, automations, views, dashboards, forms and the other column types (formula, mirror, button, files and so on).
- Moderating other people's updates (rules allow board owners; the connector deliberately does not).
- Emails in People cells (uids and `"me"` only).
