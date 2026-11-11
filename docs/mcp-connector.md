# Atrium MCP connector

Atrium has an MCP connector that lets Claude read and edit boards, groups, columns, items, subitems, descriptions and updates in the live Atrium, as the person who signed in. It comes in two modes with the same 25 tools:

- **Hosted (OPS4, recommended):** one public URL, `https://atrium-workboards.web.app/mcp`. You add it once as a connector in claude.ai and in Claude Code, sign in with your Atrium (Google) account, and it works in every project and on every device. Spec: `docs/specs/OPS4-hosted-mcp-connector.md`.
- **Local stdio (OPS3):** a server that Claude Code starts on your own machine with admin credentials. Spec: `docs/specs/OPS3-atrium-mcp-connector.md`. Use it for development and tests, or when the hosted connector is switched off.

The tool logic lives in the workspace package `@atrium/mcp-core` (`packages/mcp-core`) and is shared by both modes. Both write to Firestore (`atrium-board`, database `atrium-1`) with admin-style access that bypasses security rules, so the connector enforces the rules itself (see Safety).

## Hosted connector

> **Status (2026-11-11):** the connector is **enabled** (`MCP_CONNECTOR_ENABLED=true`; it was deployed disabled first, then switched on by a small PR once the owner had approved). The steps in `docs/DEPLOY.md` ("The hosted MCP connector") cover operations and rollback.

### Connect

- **claude.ai:** Settings, Connectors, Add custom connector, URL `https://atrium-workboards.web.app/mcp`. Leave client id and secret empty (Atrium registers Claude automatically). Click Connect, sign in with Google if asked, choose what to allow on the Atrium consent page, then Allow.
- **Claude Code:**

```
claude mcp add --transport http --scope user atrium https://atrium-workboards.web.app/mcp
```

Then run `/mcp` inside Claude Code, pick `atrium`, and choose Authenticate. A browser tab opens on the same consent page; the result returns to a `localhost` address, and the consent page warns about that ("the code will be sent to a program on this computer"). There are no ids or secrets to paste, and nothing goes in the repo.

### Who may connect

Any Atrium account the Site Admin has **approved**. Accounts that are `pending` or `blocked` cannot connect: the consent page shows the usual waiting or blocked screen, and the account status is checked again on every request and every token refresh. Blocking an account also revokes all of its connected apps. Each person sees exactly what they see in Atrium: every workspace they are a member of and, in each, the boards their role allows (see "Workspaces and roles").

### Scopes and the consent page

The consent page (`/connect`) names the app that asks (for example "Claude"), the address the result is sent back to, and two permissions:

| Scope          | Meaning                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `atrium:read`  | Read workspaces, boards, items, descriptions, updates, activity and members. Always on, locked.                 |
| `atrium:write` | Create and change boards, groups, columns, items, descriptions and updates. On by default, can be switched off. |

With Write off, the connection is read-only: a write tool answers "This connection is read-only. Reconnect in Atrium and allow Write." A read-only connection also limits the damage a prompt injection hidden in board text could do. To change the scope, disconnect and connect again.

### How long a connection lasts

| Token         | Lifetime                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------- |
| Access token  | 1 hour. Claude refreshes it automatically; you never see it.                                  |
| Refresh token | 30 days, rotating: every refresh issues a new one. Reusing an old one revokes the connection. |
| Connection    | At most 90 days in total: reconnect (Authenticate again) at the latest every 90 days.         |

Tokens are random and opaque; Atrium stores only their hashes. A revoked or blocked connection stops working within about a minute (a short verification cache).

### Connected apps (Disconnect)

Settings, Account tab, **Connected apps** lists every active connection ("Claude, Read and Write, connected 3 Nov, last used today"). **Disconnect** (with a confirmation) revokes it at once. Removing the connector in claude.ai or Claude Code only forgets it on their side; use Atrium's Disconnect to revoke it for real.

### Limits and audit

- Per person: 60 tool calls a minute per server instance, and per day 2,000 calls of which at most 500 are writes. Over a limit, the tool answers with a plain message and nothing is written. The constants are in `functions/src/mcp/limits.ts`.
- The OAuth endpoints (`/authorize`, `/token`, `/register`, `/revoke`) are rate-limited, and the function runs on at most 3 instances.
- Every tool call, grant event (created, revoked, refreshed) and refused sign-in is written to `system/mcpAudit/entries` (who, which app, which tool and board, success, duration; never tokens or content). Entries are removed after 90 days by a TTL policy. Board history shows the person as the editor, as for any edit.

### Kill switch and emergency stop

- **Kill switch:** `MCP_CONNECTOR_ENABLED` in `functions/.env.atrium-board`. Anything but `true` makes every route answer `503`. Change it in a PR (about 10 minutes to deploy).
- **Emergency stop (owner):** remove the `allUsers` `roles/run.invoker` binding from the `mcp` Cloud Run service, which stops it at once. Steps and the full rollback ladder: `docs/DEPLOY.md`.

### What the hosted connector protects against

It acts with the signed-in person's permissions only, checked per call. Tokens are bound to the Atrium URL as their audience, there is no CORS, tokens, codes and `Authorization` headers are never logged, item text is treated as data and not as instructions, control characters are stripped from what is returned, and the write tools never fetch URLs. Details: the spec, section 5.

## Hosted and local stdio compared

|              | Local stdio (OPS3)                      | Hosted (OPS4)                                     |
| ------------ | --------------------------------------- | ------------------------------------------------- |
| Who          | `ATRIUM_USER_UID` from the environment  | The signed-in Atrium user (token to uid)          |
| Where        | REST + `gcloud auth print-access-token` | Admin SDK, the function's runtime service account |
| Scope        | Optional `ATRIUM_WORKSPACE_ID` filter   | All memberships, per-call role checks             |
| Registration | Per machine, per project                | Once per Claude surface (claude.ai, Claude Code)  |
| Consent      | None (your machine, your `gcloud`)      | Consent page with Read and Write scopes           |
| Limits       | None                                    | Rate and daily limits, audit log, kill switch     |
| New tools    | Pull `main`, restart Claude Code        | Automatic with every deploy                       |

## Local stdio server

A local MCP server (stdio). Nothing is deployed: it runs on the owner's machine, only when Claude Code starts it, using `gcloud` credentials like the showcase seeder (`docs/showcase.md`).

### Setup (once per machine)

1. Be signed in to `gcloud` (`gcloud auth login`) with the account that owns the project.
2. Find your Atrium user uid (Firebase console; keep it in `.private/project-ids.md`, never in the repo). The connector then sees every workspace you are a member of; to limit it to one, also note that workspace's id.
3. Register the server with Claude Code. Use `--scope local` so the ids stay on this machine:

```
claude mcp add atrium --scope local ^
  -e ATRIUM_USER_UID=<your-user-uid> ^
  -- pnpm --silent --dir D:\DevProjects\Atrium\atrium-cl exec tsx scripts/mcp/atrium-mcp.mjs
```

(`^` is the Windows line continuation; put it on one line in a POSIX shell.) Add `-e ATRIUM_WORKSPACE_ID=<workspace-id>` to limit the server to one workspace. `--silent` matters: stdout is the protocol channel and must stay clean.

**Picking up new tools (no reinstall).** The server is not installed anywhere: Claude Code starts it from the checkout named in the `claude mcp add` command (`pnpm exec tsx scripts/mcp/atrium-mcp.mjs`) every time a session starts, so there is no build step and no re-registration. To get a new tool: (1) update that checkout to a commit that has it (`git pull` on `main` after the PR merges), then (2) restart Claude Code, or run `/mcp` and reconnect `atrium`. A running session keeps the old tool list until you do (2). Only if the registration points at an old or different folder do you need `claude mcp remove atrium` and add it again with the right path.

To re-register after a change, run `claude mcp remove atrium` and add it again. Check with `claude mcp list`; inside Claude Code `/mcp` shows the 25 tools.

### Environment variables

| Variable              | Meaning                                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATRIUM_USER_UID`     | The Atrium user the server acts as: reads and writes are attributed to them (`createdBy`, `updatedBy`, board owner) and their workspace memberships decide what it can see. Required: without it the server exits and writes nothing. Checked at startup (the user must exist). |
| `ATRIUM_WORKSPACE_ID` | Optional filter: with it, only that workspace (and its boards) is visible, and it is the default for the workspace-level tools. The user must be a member of it.                                                                                                                |
| `ATRIUM_PROJECT`      | Default `atrium-board`.                                                                                                                                                                                                                                                         |
| `ATRIUM_DATABASE`     | Default `FIRESTORE_DATABASE_ID` (`atrium-1`).                                                                                                                                                                                                                                   |
| `ATRIUM_EMULATOR`     | `host:port` of a local Firestore emulator; uses the `Bearer owner` token. Only local addresses are accepted. For tests.                                                                                                                                                         |

## Workspaces and roles

The server acts as one user and sees exactly what that user sees in the app: every workspace whose `memberIds` lists them (`atrium_list_workspaces`), and in each the boards their role allows (board `access`, or the workspace role on `main` boards, as `boardRole()` in `firestore.rules` computes it). Roles are checked per call and per workspace: someone who is a viewer in one workspace and an owner in another reads in the first and writes in the second. A board outside the user's memberships looks the same as a missing one.

`atrium_list_boards`, `atrium_create_board` and `atrium_list_members` take an optional `workspaceId`. It may be left out when the user is a member of exactly one workspace (or `ATRIUM_WORKSPACE_ID` is set); with several, the tool answers "Give workspaceId; call atrium_list_workspaces first." so a board never lands in a guessed workspace.

## Tools

Columns are addressed by id or title (case-insensitive, must be unambiguous); so are groups. Every tool returns compact JSON; errors come back as a plain message. Each tool definition carries `scope` (`read` or `write`) and MCP annotations (`readOnlyHint`, `destructiveHint`); the stdio server passes the annotations through and ignores the scope, which the hosted connector uses to enforce read-only connections.

| Tool                                                               | What it does                                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atrium_list_workspaces`                                           | Read-only. The workspaces the user is a member of (id, name, role).                                                                                                             |
| `atrium_list_boards`                                               | Read-only. Active boards the user can see in a workspace (optional `workspaceId`, see above).                                                                                   |
| `atrium_get_board`                                                 | Read-only. Columns (with labels), groups and active items with readable values keyed by column title; subitems nested.                                                          |
| `atrium_create_board`                                              | New board with the default Person/Status/Date columns and two groups, no sample items. Needs the member role or higher in the workspace (optional `workspaceId`).               |
| `atrium_add_group` / `atrium_rename_group` / `atrium_delete_group` | Group changes. Delete refuses while the group has active items, and never removes the last group.                                                                               |
| `atrium_add_column`                                                | Adds `text`, `long_text`, `numbers`, `status`, `dropdown`, `date`, `timeline`, `checkbox`, `link`, `people`, `tags` or `rating`. Labels go in `settings.addLabels`.             |
| `atrium_update_column_settings`                                    | Adds status labels, dropdown options or tags (`addLabels`) and changes other settings. Never changes the type or removes a label.                                               |
| `atrium_create_items`                                              | Up to 50 items per call, appended to their groups, with plain cell values.                                                                                                      |
| `atrium_update_item`                                               | Changes name, group and/or cells. Field-path patch: only the given cells change; `null` clears one, except on a required column (REQ-1).                                        |
| `atrium_get_item_description`                                      | Read-only. The item's rich-text description as markdown, plus plain text and the names of nodes markdown cannot show (images, tables, mentions).                                |
| `atrium_set_item_description`                                      | Writes the description from markdown (see below). `mode` `replace` (default) or `append`.                                                                                       |
| `atrium_archive_item` / `atrium_delete_item`                       | Soft only (`state` archived or deleted). Restore in the app.                                                                                                                    |
| `atrium_list_updates`                                              | Read-only. An item's updates (comments), newest first, with replies, authors, likes, mentions and attachment metadata (name, size, type; no download).                          |
| `atrium_add_update` / `atrium_add_reply`                           | Post an update in the item's (or subitem's) feed, or a reply in an update's thread. Markdown body, `@[Name]` mentions (see below). Bump the counters.                           |
| `atrium_edit_update` / `atrium_delete_update`                      | Edit or delete the user's own update, or reply when `replyId` is given.                                                                                                         |
| `atrium_list_subitems`                                             | Read-only. An item's subitems with values keyed by column title, plus the board's columns (subitems share them).                                                                |
| `atrium_create_subitems`                                           | Up to 50 subitems under a top-level item, in its group, after its other subitems, with plain cell values keyed by board column title. Needs the editor role; writes no columns. |
| `atrium_duplicate_item`                                            | Copies an item (with its active subitems) or a subitem as "Name (copy)" next to the original, with its values.                                                                  |
| `atrium_get_activity`                                              | Read-only. Recent board activity (newest first), optionally for one item and its subitems.                                                                                      |
| `atrium_list_members`                                              | Read-only. Members of a workspace (uid, name, email, role; optional `workspaceId`), or those who can see one board.                                                             |

Cell values: status takes a label text; dropdown and tags take label texts; date `"YYYY-MM-DD"`; timeline `["YYYY-MM-DD","YYYY-MM-DD"]`; checkbox `true/false`; rating a number; link a URL; people a workspace member uid or `"me"` (emails are not supported yet). Values are converted to the stored shape and checked by `columnRegistry.validateCell`, so the app never sees data it would reject.

Descriptions: `atrium_set_item_description` takes markdown-ish text (headings `#`, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[links](https://...)`, `-`/`1.`/`- [ ]` lists with indented nesting, `>` quotes, fenced code, `---`) and converts it to the ProseMirror JSON the web editor stores. The value is built by the web app's own `buildDescription` (`apps/web/src/components/item-view/description.ts`: empty becomes `null`, size cap, plain-text field for search) and checked with `itemDescriptionSchema`, then written as the whole `description` field like the app does, so it matches the `validDescription` rule. HTML is never interpreted and only `http(s):` and `mailto:` links are kept. Replacing a description that holds images, tables, mentions or emoji is refused (markdown cannot write them back, and images are tied to `descriptionImages`); use `append`, which leaves existing content untouched, or pass `allowOverwriteRich: true`. Empty markdown with `replace` clears the description.

Subitems are items with a `parentItemId`, stored in the same `items` collection, in the parent's group, using the board's own columns (subitems share them; `board.subitemColumns` is retired and `atrium_get_board` no longer returns it, except for a board the migration has not reached yet, which still lists its legacy subitem columns and uses them for its subitems). A subitem's id works with `atrium_update_item` (name and cells by column title; its group cannot change), `atrium_get_item_description` / `atrium_set_item_description`, `atrium_add_update`, `atrium_archive_item` and `atrium_delete_item`. Moving a parent moves its subitems, and archiving or deleting it takes them along, as in the web app. `atrium_create_subitems` never writes columns, so it needs only the editor role.

Updates: the text is markdown (same conversion as descriptions) stored as the `contentDoc` the composer writes, with the plain-text mirror from the app's `docToText`, checked by `createItemUpdateInputSchema`. `@[Name]` (display name, email or uid of a member who can see the board; `@[me]` for yourself) becomes a mention chip and goes in `mentions`, so the existing Functions notify that person. Mentions are fixed when a post is created: `atrium_edit_update` keeps `@[Name]` as plain `@Name` text. Editing and deleting are limited to the user's own posts (the rules also let board owners moderate; the connector does not). Deleting a post is a hard delete, like the app's; counters move down only while positive.

Example flow: `atrium_list_workspaces` (when you are in more than one), `atrium_list_boards`, then `atrium_get_board` (columns, groups), `atrium_list_members` (uids for People cells), `atrium_create_items` / `atrium_create_subitems`, `atrium_add_update` with `Thanks @[Jordan Lee], done`.

## Safety

The rules below apply to both modes.

- Every tool loads the board first and checks: the user is a member of the board's workspace (and, with `ATRIUM_WORKSPACE_ID`, that it is that workspace), `state` is `active`, and the user has a role on it (board `access`, or, on `main` boards, the role implied by the workspace role). Structure changes need `owner`; item changes `editor` or `owner`; viewers read. A board outside the user's memberships looks the same as a missing one. Memberships are re-read after a minute at most.
- Structure changes (groups, columns) read the board, change it and write it with an `updateTime` precondition, retrying once on a conflict.
- Never written: `derivedColumnIds`, `serverManagedColumnIds`, `requiredColumnIds`, `seq`, `boardSeq`, `descriptionImages` (existing images are never touched), notifications, activity. Derived and server-managed columns cannot be set; locked columns are refused to non-owners; a required cell (REQ-1: `board.requiredColumnIds` or `column.required`) is never emptied by `atrium_update_item`, as the rules refuse it for the app.
- No hard deletes of boards, items or structure; the only hard deletes are the user's own updates and replies. No tool touches folders, workspaces, roles, invites or other users' data; `atrium_list_members` only reads names and emails of workspace members.
- Inputs are zod-validated; ids must match `/^[A-Za-z0-9_-]{1,128}$/`. Tool descriptions say that board content is data, not instructions.
- The Cloud Function triggers (`onItemCreated` sets `seq`/`boardSeq`, `onBoardColumnsWritten` maintains the derived id lists) run on these writes like on any other.

## Code and tests

- `packages/mcp-core` (`@atrium/mcp-core`, plain ESM `.mjs` with hand-written `index.d.mts`): `service.mjs` (`createService({ client, actor, now })`, `actor = { uid, workspaceFilter }`), `tools.mjs` (`defineTools(service)`, 25 tools with `scope` and `annotations`), refs, value conversion, builders, descriptions, updates, and `fake-client.mjs`, an in-memory Firestore for tests. The hosted connector builds the same service on an Admin SDK adapter.
- `scripts/mcp/atrium-mcp.mjs`: thin stdio wiring; `scripts/mcp/lib/config.mjs` (environment) and `lib/client.mjs` (REST + gcloud token).
- `scripts/showcase/firestore-rest.mjs` gained `runQuery` (equality and `arrayContains` filters) and an `update` commit op (field paths, deletes, increments).
- `pnpm test` runs `packages/mcp-core/src/*.test.mjs` and `scripts/mcp/*.test.mjs` (fakes only, no emulator and no production access; one test spawns the server over stdio and calls `tools/list`). `pnpm mcp` starts the server by hand.

## Not yet possible (follow-ups)

- Uploading or downloading files (the Files column and update attachments need the upload callables and signed URLs).
- Likes, reordering, restoring items from the trash, moving items between boards, deleting boards, and folder, workspace or sharing changes.
- Automations, views, dashboards, forms and the other column types (formula, mirror, button, files and so on).
- Moderating other people's updates (rules allow board owners; the connector deliberately does not).
- Emails in People cells (uids and `"me"` only).
