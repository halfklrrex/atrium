# HANDOFF.md: index

Session notes live in `docs/handoff/`. Each agent writes its own dated file (`YYYY-MM-DD-<agent>-<task>.md`), so notes never conflict. This file only holds the index and standing facts. Read the rules in `AGENTS.md` and the plain-language overview in `docs/WORKFLOW.md`.

## Current state (keep short; update when it changes)

- **Codenames:** Claude (Opus 5.5) is **Ophelia**, the technical lead. Antigravity is **Ava**. Both are she/her.
- **Live:** https://atrium-workboards.web.app runs:
  - the shell, Home, My work and workspaces
  - the board table (P1b), subitems and the full item view
  - the item card and updates (VF5 fidelity pass, 2026-10-26)
  - saved views and the Kanban view (VF6 fidelity pass, 2026-10-26)
  - workspace membership, invites and member profiles (P4a, 2026-10-26)
  - thin monday-style scrollbars everywhere (VF7, 2026-10-26)
  - every registered column type has a web cell, including Files, Button, Time tracking, Formula, Dependency, Connect boards and Mirror
  - change a column's type, with undo (2026-10-31)
  - the Calendar and Timeline views (2026-10-31)
  - @mentions in updates, replies and descriptions
  - the Activity log (board and item), button actions with notify, column descriptions and defaults, reorderable favourites (2026-11-03)
  - archive, trash and undo
  - empty states and the notifications bell and panel (2026-10-30)
  - the layering fix for menus
- **Data:** Firestore named database **`atrium-1`** (`eur3`, scheduled backups), through `FIRESTORE_DATABASE_ID`. `(default)` (`nam5`) is unused legacy.
- **Showcase:** the "🧪 Atrium Showcase" board is in the owner's Test Workspace (id in `.private/project-ids.md`, gitignored, local only). Re-seed it per `docs/showcase.md`.
- **MCP connector:** a local MCP server lets Claude edit boards and items in the live Atrium (`docs/mcp-connector.md`, `pnpm mcp`).
- **Deploys:** automatic on merge to `main`. Eventarc and Cloud Scheduler are set up. **Merge only when the checks pass**; the repo has no branch protection (an owner decision).
- **Bugs:** the owner posts them in the monday Roadmap's 🐞 Bugs → "Bug inbox" item. Check it at the start of every session (`AGENTS.md`).
- **Actionable column** on the Roadmap: Yes (owner's move), Agents (owner answered, so it's back with us), No. Check the Agents items at the start of every session (`AGENTS.md`).
- **No open-PR limits** (owner, 2026-11-04). Pace is set by usage and the owner's availability; hot-spot PRs merge in order and rebase.
- **Folders:** `D:\DevProjects\Atrium\atrium-cl` (Ophelia, offset 0) and `atrium-ag` (Ava, offset 100). Avoid offset 30 (port 9180 is often taken).

## Open work (2026-11-07, end of day)

- **Latest session notes:** `docs/handoff/2026-11-07-ophelia-queue-and-next-steps.md` (read this first: the queue, the owner's decisions and the gotchas), `docs/handoff/2026-11-07-ophelia-pickers-bulk-edit-approval-on.md`, `docs/handoff/2026-11-07-ophelia-gate-drag-automation-redesign.md`. Plans: `docs/plans/2026-11-07-owner-feedback-round-2.md` (every owner report and the work packages), `docs/plans/owner-check-list.md` (what the owner still has to look at).
- **Live since 2026-11-07:** the account gate (#143) and **approval ON for new sign-ups** (#152, the flag lives in the committed `functions/.env.atrium-board`; the owner tested it with a second account and it works), builder pickers above the modal (#154), shift+click range select and immediate bulk edit (#153, #161: Undo respects required columns, column highlight), people shown as names in the Automation center and Manage chips (#160), the blocked sign-in message (#157), test fixes (#163). Specs merged: PWA and web push (#149), appeals inbox ADMIN-4 (#156).
- **In flight:** `claude/bulk-highlight-overlay` (the bulk column highlight is applied but invisible on Status and Priority cells because the colour pill covers the outline; fix draws it as an overlay above the cell content). Check the PR list first.
- **Owner decisions, 2026-11-07:** appeals inbox: a blocked person signs in and appeals from the blocked screen (blocking stops disabling the Auth user), two-way until an admin closes it, feedback goes to the same Inbox, the admin is shown as "Site Administrator" (no admin uid or name on anything the sender can read), daily caps accepted (10 blocked, 30 approved, 200 per thread), no email, closed threads deleted after 365 days. The owner's old Minerva messenger is inspiration only: nothing copied.
- **Waiting on the owner:** the PWA questions (five, with defaults, on Roadmap item 3306251569; PWA is on hold until answered); live checks of the builder pickers (other blanks), a real bulk edit and Undo on the showcase, and the P5 items that need a real run (event triggers, actions library, post_update author, time-based "Scheduled for" run, flag emoji on Windows); go-aheads for two production writes with dry runs ready: the `requiredColumnIds` backfill (8 boards) and the legacy-activity cleanup (1 doc) (`dateKeys` is already applied).
- **Queue (not started; each has a Roadmap item):**
  1. Appeals and feedback inbox, 7 small PRs in the order of `docs/specs/ADMIN-4-appeals-inbox.md` (PR2, PR3 and PR4 get an ultrareview checkpoint). Start with PR2 (shared schemas, rules, indexes, rules tests; hot spots) after a fresh read of the spec's T6 and the "What each side sees" table. List accounts blocked before PR3 and ask the owner.
  2. New app logo (Roadmap item in the VF group): propose 2 or 3 SVG directions, owner picks, then a Sonnet agent applies it (header, login, favicon, PWA icon sizes). Do it before PWA-1.
  3. Export and print: print styles and native .xlsx (spec section in `docs/specs/P6-export-csv.md` first; an MIT dependency, so `pnpm-lock.yaml` and `pnpm licenses:notices`), then an Export button in the batch bar (CSV of the selected rows). Convert (to subitems or another board) is its own later item; Apps is skipped.
  4. Read-only live QA with Chrome: light mode of the Automation center, VF compare item 3333664237, nested layers (the date picker inside a builder value editor must draw above the modal and Escape must close only the innermost layer).
  5. PWA and web push, only after the owner answers (spec `docs/specs/P4-pwa-web-push.md`, PWA-1 to PWA-4, ultrareview before PWA-3).
  6. Unstarted epics that need a spec first: Teams and user profiles, Email notifications, Docs editor, Map and Files gallery views, the P8 public API (plan an ultrareview checkpoint first).
- **Ava is on a break with no end date.** Ophelia works alone. Ava's Roadmap items are Agent = Claude.
- **Start of every session:** `git fetch`, open PRs, the bug inbox (item 3307382004) and Actionable = Agents. **Read the threaded replies with GraphQL** (`updates { replies { text_body } }`): owner replies are not in `get_updates` text.
- **Local machine (Mac):** `gcloud` is installed and signed in; ffmpeg is installed (Homebrew); `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH` for `pnpm test:rules`; the web tests now pin the locale themselves (#163), so `LC_ALL=en_US.UTF-8` is no longer needed; typecheck one package at a time (`pnpm -r --workspace-concurrency=1 typecheck`). The membership dialog test "shows the server explanation when a call is refused" is an occasional timing flake under load; re-run the file alone.
- **Process that worked:** Opus plans and writes specs; a Sonnet subagent builds in its own worktree (`/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>`, own `ATRIUM_PORT_OFFSET`); a SEPARATE Sonnet reviewer finds real defects (every PR today had some); a Sonnet agent fixes them; Opus reads the diff and merges with `gh pr merge --rebase`. Force-push is blocked: a conflicted PR is replaced by a new branch with cherry-picked commits. `docs/plans/owner-check-list.md` conflicts constantly: have Opus add check sections in a separate docs PR instead of in feature PRs.
- Older plan and gotchas: `docs/plans/2026-11-03-autonomous-batch.md` and `docs/handoff/2026-11-03-ophelia-autonomous-batch.md`.

## Notes index

- [2026-11-07 · Ophelia · queue, owner decisions and next steps](docs/handoff/2026-11-07-ophelia-queue-and-next-steps.md)
- [2026-10-23 · Claude · kickoff, P0, P1a, deploys](docs/handoff/2026-10-23-claude-kickoff-p0-p1a.md)
- [2026-10-24 · Claude · multi-agent workflow, VF1, OPS1, deploy-on-merge](docs/handoff/2026-10-24-claude-workflow-vf1-ops1.md)
- [2026-10-24 · Antigravity · Undo, archive & trash](docs/handoff/2026-10-24-antigravity-undo-archive-trash.md)
- [2026-10-24 · Claude · FW1 column framework (derived columns, validateValue)](docs/handoff/2026-10-24-claude-fw1-column-framework.md)
- [2026-10-24 · Antigravity · real-time sync & optimistic UI (P1c)](docs/handoff/2026-10-24-antigravity-realtime-sync-optimistic.md)
- [2026-10-25 · Ophelia · reviews, FW2, DB1, bug inbox, showcase](docs/handoff/2026-10-25-ophelia-reviews-fw2-db1.md)
- [2026-10-25 · Ophelia · Ava's PR queue merged](docs/handoff/2026-10-25-ophelia-ava-queue-merge.md)
- [2026-10-26 · Ophelia · P4a membership, VF6 Kanban pass](docs/handoff/2026-10-26-ophelia-p4a-vf6.md)
- [2026-10-26 · Claude · P4a membership (implementation)](docs/handoff/2026-10-26-claude-p4a-membership.md)
- [2026-10-26 · Ophelia · reviews, specs, VF5, subitems](docs/handoff/2026-10-26-ophelia-specs-vf5-subitems.md)
- [2026-10-26 · Ophelia · the repository is now public](docs/handoff/2026-10-26-ophelia-public-repo.md)
- [2026-10-27 · Ophelia · numeric item IDs, description editor passes 1 and 2](docs/handoff/2026-10-27-ophelia-ids-editor.md)
- [2026-10-30 · Ophelia · P4 notifications backend, emoji fixes, web UI waiting](docs/handoff/2026-10-30-ophelia-p4-notifications-emoji.md)
- [2026-10-31 · Ophelia · Ava's queue, @mentions, Calendar, Timeline, Mirror, change column type](docs/handoff/2026-10-31-ophelia-ava-queue-and-p3.md)
- [2026-10-31 · Ophelia · activity backend and polish batch 2 merged](docs/handoff/2026-10-31-ophelia-evening-activity-backend-merged.md)
- [2026-11-01 · Claude · Atrium MCP connector (OPS3)](docs/handoff/2026-11-01-claude-atrium-mcp-connector.md)
- [2026-11-07 · Ophelia · builder pickers, bulk edit v2, approval ON, PWA spec](docs/handoff/2026-11-07-ophelia-pickers-bulk-edit-approval-on.md)
- [2026-11-06 · Ophelia · CSV export, bulk edit, admin IAM fix](docs/handoff/2026-11-06-ophelia-export-bulk-edit-admin-iam.md)
- [2026-11-06 · Ophelia · required columns done, P5d under way, site admin specced](docs/handoff/2026-11-06-ophelia-req-p5d-admin-spec.md)
- [2026-11-06 · Ophelia · in-flight inventory](docs/handoff/2026-11-06-ophelia-in-flight-inventory.md)
- [2026-11-05 · Ophelia · P5c live, Automation center redesign R1 to R3](docs/handoff/2026-11-05-ophelia-p5c-p5e-live.md)
- [2026-11-03 · Ophelia · autonomous batch: activity UI, button actions, notify, favourites, rich-text backend, P5 design](docs/handoff/2026-11-03-ophelia-autonomous-batch.md)
- [2026-11-04 · Ophelia · feature push (Gantt, Workload, templates, dashboards data, P5a pieces)](docs/handoff/2026-11-04-ophelia-feature-push.md)
- [2026-11-05 · Ophelia · automations and dashboards merged, Automation center redesign chosen](docs/handoff/2026-11-05-ophelia-automations-merged-redesign.md)
- [2026-11-06 · Ophelia · inventory of work in flight (R4, REQ-1, flag emoji, post_update author, template relabel)](docs/handoff/2026-11-06-ophelia-in-flight-inventory.md)
- [2026-10-24 · Antigravity · Board filter, sort, search & group-by](docs/handoff/2026-10-24-antigravity-board-filters-sort.md)
- [2026-10-25 · Antigravity · Files storage upload, rules & tests](docs/handoff/2026-10-25-antigravity-files-storage-upload.md)
- [2026-10-25 · Antigravity · Server-side column actions](docs/handoff/2026-10-25-antigravity-server-column-actions.md)
