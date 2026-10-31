# The showcase board

`scripts/showcase/seed-showcase.mjs` fills a workspace with **"🧪 Atrium Showcase"**: a believable "Website relaunch" board with realistic fake data, so the owner can open the live app and see what each new feature looks like. It is safe to re-run at any time.

## What it creates

- `showcase-main`: the board "🧪 Atrium Showcase". It has 4 groups (This week, Next up, Backlog, Done), 26 active items, 2 archived and 2 trashed items, and every column type the board table can render today (People, two Status columns, Date, Numbers with a € unit, Dropdown, Text, Long text, Checkbox, Link, Connect boards and two Mirrors). Four items carry updates and replies in the item card feed. Shared views show in the view tabs: a table "Due this week" (filtered and sorted by date, two columns hidden), a Kanban "Status board" and a Calendar "Due dates" (placed by Due date, coloured by Status). Dates are spread over the last and next 30 days, with some overdue items and some empty cells.
- `showcase-archived-demo` and `showcase-trashed-demo`: two tiny boards, one archived and one deleted, so the workspace's **Archive & Trash** page has something to show. (That page lists boards. Archived and trashed _items_ have no screen yet; they are in the data for when one lands.)
- `showcase-linked-demo`: an active board "🔗 Showcase: Linked tasks" with five items (Status and Budget columns). The main board's **Related items** (Connect boards) column links to it, and its two **Mirror** columns read from it: "Linked status" lists the linked items' Status as coloured chips, "Total budget" sums their Budget.
- **Three fake workspace members** (Jordan Lee, Sam Rivera and Casey Morgan, fixed uids `showcase-user-*`, `@example.com` emails), so People cells show names and initials instead of "Board member". They get `workspaces/{id}/members/{uid}` profile docs **only**: they are not in the workspace's `roles` or `memberIds`, are not real accounts, cannot sign in and do not appear in the Members dialog. Several items list them in the Owner column.
- The owner's favourite and "recently visited" entries for the main board.
- Three notifications in the owner's bell (`users/{owner}/notifications/showcase-notification-*`): a mention, a reply and an assignment from the fake members, two unread and one read, pointing at real showcase items and updates. Clients cannot create notifications, so the script writes them directly.

Dates are laid out around "today" (UTC, midnight), so running it on a later day moves the whole board forward and keeps it fresh. `--now YYYY-MM-DD` pins the day.

## Running it

### Local emulator

```bash
pnpm dev                       # in one terminal: emulators + web app
# sign in once in the app (this creates your personal workspace), then in another terminal:
pnpm showcase                  # finds the workspace in the emulator by itself
pnpm showcase --workspace <id> --owner <uid>     # or choose them explicitly
pnpm showcase --reset          # delete the showcase boards first, then recreate them
pnpm showcase --dry-run        # print what would change, write nothing
```

It always writes to the named Firestore database (`FIRESTORE_DATABASE_ID`, currently `atrium-1`, in the emulator and in production); `--database <id>` overrides it. It talks to the Firestore emulator at `FIRESTORE_EMULATOR_HOST`, or at this working copy's port from `ATRIUM_PORT_OFFSET` when that is not set. It refuses a non-local address.

### Production (Ophelia or the owner)

```bash
gcloud auth login              # once; an account that can write to Firestore in atrium-board
pnpm showcase --project atrium-board --workspace <workspaceId> --owner <ownerUid>          # dry run
pnpm showcase --project atrium-board --workspace <workspaceId> --owner <ownerUid> --yes    # writes
```

- Without `--yes` it only reads (the workspace and the owner's membership) and prints what it would write.
- It authenticates with `gcloud auth print-access-token` and the Firestore REST API. No service-account key, no application-default credentials. The calls send `x-goog-user-project`; add `--no-quota-project` if your account is not allowed to use the project for quota.
- Find the workspace id in the app's URL (`/workspaces/<workspaceId>`) and the owner uid in the Firebase console (Authentication) or in the workspace document's `ownerId`.

### Safety

The script only ever creates, updates or deletes documents it owns: `boards/showcase-*` with their `items`, `updates` and `replies` (and any other sub-collection, on `--reset`), plus the owner's `favorites/showcase-*`, `recents/showcase-*` and `notifications/showcase-notification-*`, plus the three fake members' `workspaces/<workspace>/members/showcase-user-*` docs (only in the workspace being seeded; `--reset` recreates them). The workspace document, real members' docs, `invites` and `roles` are never touched. Every write and delete is checked against that allow-list (`isOwnedPath` in `data.mjs`) before anything is sent. It also refuses to run when:

- the workspace does not exist, or the owner is not a member (or is only a viewer);
- a `showcase-*` board id already exists in a _different_ workspace;
- `FIRESTORE_EMULATOR_HOST` is not a local address.

Without `--reset` it upserts: every showcase document is replaced by its canonical version, and showcase items, updates and replies that are no longer in the content are deleted, so repeated runs converge to the same state. Changes you make by hand on the showcase board are therefore overwritten. With `--reset` the three showcase boards are deleted recursively first and then recreated.

## Keeping it up to date (AGENTS.md rule)

When a feature or column type lands that is visible on a board, **extend the showcase in the same PR**. After the merge, Ophelia re-runs it against production.

All content is in `scripts/showcase/data.mjs`:

- **A new column type with a web cell** (`apps/web/src/columns/`): add it to `COLUMNS` with a sensible `settings` object, give most items a value in `ITEMS` (leave a few empty), and remove it from `PENDING_TYPES`. The test "every column type with a web UI is in the showcase" reads `ADD_COLUMN_ORDER` from the web registry and fails until you do.
- **A new board feature** (a view, a group setting, subitems, automations...): add the data it needs to the main board, or add a `showcase-<name>` board and list its id in `SHOWCASE_BOARD_IDS` (the allow-list follows that list).
- **Items, updates, replies**: add or edit entries in `ITEMS` / `SIDELINED_ITEMS`. Dates are days relative to today (`due: -2` is two days ago), and ids come from the stable `key`s.

Everything is built with the shared zod schemas and every cell value goes through `columnRegistry.parseValue`, so invalid data throws immediately. `pnpm test` covers the builder and the seeding logic (`scripts/showcase/showcase.test.mjs`).

### Column types waiting for a web cell (`PENDING_TYPES`)

None right now (`PENDING_TYPES` is empty). A type that exists in `packages/shared` but has no entry in `apps/web/src/columns/registry.ts` goes in this list: the table draws an unknown column type as a header over blank cells, which would make the showcase look broken, so they are left out until their UI lands.

## Backfilling `updatesCount`

The board table updates bubble reads the item `updatesCount`, which the app keeps current from now on. Items that already had updates before it existed (the showcase seed sets it itself) need a one-off backfill: `pnpm exec tsx scripts/backfill-updates-count.mjs [--board <id>]` runs against the emulator, and `... --project atrium-board [--board <id>] [--database <id>] --yes` against production (without `--yes` it only prints a dry run; it authenticates with `gcloud` and refuses a non-local emulator host). It counts each item `updates` sub-collection and patches only `updatesCount` (field mask), only where the stored value differs, so it is safe to re-run.

## Backfilling member profiles

Workspaces created before P4a have no `members` docs, so their members would show as "Board member" until each one signs in again (`bootstrapUser` writes the missing doc). `scripts/backfill-members.mjs` does it for everyone at once: `pnpm exec tsx scripts/backfill-members.mjs [--workspace <id>]` against the emulator, `... --project atrium-board [--workspace <id>] --yes` against production. It is a **dry run unless you pass `--yes`**, authenticates with `gcloud` like the showcase seed, copies name, email and photo from `users/{uid}`, only creates missing docs or fixes a stale `role` copy, and never deletes anything, so it is safe to re-run.
