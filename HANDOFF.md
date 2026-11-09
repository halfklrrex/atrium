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
  - the new Atrium logo (2026-11-07), the account approval gate, bulk edit across selected rows
  - the public privacy notice at `/privacy` (PRIVACY-1 PR 3, 2026-11-09): reachable signed out, linked from login, About and Settings > Privacy and data; text in `apps/web/src/pages/privacy/privacy-content.ts`, checked line by line against the code and the infrastructure
- **Data:** Firestore named database **`atrium-1`** (`eur3`, scheduled backups), through `FIRESTORE_DATABASE_ID`. `(default)` (`nam5`) is unused legacy.
- **Showcase:** the "🧪 Atrium Showcase" board is in the owner's Test Workspace (id in `.private/project-ids.md`, gitignored, local only). Re-seed it per `docs/showcase.md`.
- **MCP connector:** a local MCP server lets Claude edit boards and items in the live Atrium (`docs/mcp-connector.md`, `pnpm mcp`).
- **Deploys:** automatic on merge to `main`. Eventarc and Cloud Scheduler are set up. **Merge only when the checks pass**; the repo has no branch protection (an owner decision).
- **Bugs:** the owner posts them in the monday Roadmap's 🐞 Bugs → "Bug inbox" item. Check it at the start of every session (`AGENTS.md`).
- **Actionable column** on the Roadmap: Yes (owner's move), Agents (owner answered, so it's back with us), No. Check the Agents items at the start of every session (`AGENTS.md`).
- **No open-PR limits** (owner, 2026-11-04). Pace is set by usage and the owner's availability; hot-spot PRs merge in order and rebase.
- **Folders:** `D:\DevProjects\Atrium\atrium-cl` (Ophelia, offset 0) and `atrium-ag` (Ava, offset 100). Avoid offset 30 (port 9180 is often taken).

## Open work (2026-11-09)

- **Latest session notes:** `docs/handoff/2026-11-08-ophelia-autonomous-run.md` (what the autonomous run shipped, gotchas), then `docs/handoff/2026-11-07-ophelia-queue-and-next-steps.md`. The monday "Autonomous run log" item (3339139580) has one entry per merge.
- **Live and merged since 2026-11-07:** everything in the list above, plus PWA-2 to PWA-4 (#188, #190, #191: push tokens and prefs, `sendPush` with per-kind switches including `inbox`, settings dialog and service-worker handlers), the Firebase web push key (#196; the owner supplied it, it is deployed), and the designed Excel workbook (#192: Summary dashboard, styled Items, a sheet per view with native charts, month-first dates). The owner signed off the Excel export on 2026-11-09 (Export & print is Done).
- **In flight:** nothing. SEC-1 (PR #198, merged 2026-11-09) fixed everything real from the batched review: the #193 and #194 ultrareviews and a local `/code-review high` of #195 (spec `docs/specs/SEC-1-review-fixes.md`). The review-only draft PRs #193, #194 and #195 stay open and are never merged; close them when convenient.
- **Waiting on the owner (monday, Actionable = Yes):** real-device push checks (item 3306251569; the key is in, so this is just testing); Twemoji on Windows, Mac and iPhone (item 3339109711); the PWA install check on a phone; the later live checks of the appeal flow (item 3338900524, Actionable = No until then).
- **Bug inbox (2026-11-09):** two feature requests acknowledged and logged: workspace icons from an icon set, previews of a few sets first (item 3340735612); default Status and Priority colours matching monday, Critical = red (item 3340727026).
- **Ultrareview budget (owner):** 5 in total across two accounts. Two were spent on #193 and #194 on 2026-11-09 (the third on this account is unused; #195 got a local review instead). Only the owner can launch `/code-review ultra <PR#>`. Next planned batch: P8 API and webhooks, and a whole-codebase pass later. Lessons: build the review slices from files copied onto an old base and the reviewer reports false "missing wiring" findings (routes, CSS, tokens that exist on `main`); verify every finding against `main` before fixing, as the refuted ones were about a third of the findings.
- **Owner decisions, 2026-11-07:** appeals inbox (a blocked person signs in and appeals from the blocked screen; two-way; the admin is "Site Administrator" with no uid or name on anything the sender can read; caps 10 / 30 / 200; no email; closed threads deleted after 365 days); PWA answers (push by default for assigned, reply, mention, button, automation off; desktop too; account notifications follow their own `account` push switch, on by default; sign-out removes the device token; the logo is final, the app is "Atrium"); the 1px bulk highlight; Twemoji on every device; production backfills not needed (dry runs show 0).
- **Queue, in order (each has or needs a Roadmap item):**
  1. The two bug-inbox feature requests above (icon-set previews first; default label colours).
  2. Live QA with Chrome (Automation center light mode, VF compare item 3333664237, nested layers), print preview, the full appeal flow against the real Functions and the forced sign-out in a real browser (only unit-tested so far).
  3. Epics that need a spec first (owner said build on defaults, stop where a secret, paid provider or IAM change is needed): Map and Files gallery views, Teams and user profiles, Docs editor, P8 public API and webhooks (second ultrareview batch), Email notifications and digests (stop before the provider).
- **Ava is on a break with no end date.** Ophelia works alone. Ava's Roadmap items are Agent = Claude.
- **Start of every session:** `git fetch`, open PRs, the bug inbox (item 3307382004) and Actionable = Agents. **Read the threaded replies with GraphQL** (`updates { replies { text_body } }`): owner replies are not in `get_updates` text.
- **Local machine (Mac):** `gcloud` is installed and signed in; ffmpeg is installed (Homebrew); `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH` for `pnpm test:rules`; the web tests now pin the locale themselves (#163), so `LC_ALL=en_US.UTF-8` is no longer needed; typecheck one package at a time (`pnpm -r --workspace-concurrency=1 typecheck`). The membership dialog test "shows the server explanation when a call is refused" is an occasional timing flake under load; re-run the file alone.
- **Process that worked:** Opus plans and writes specs; a Sonnet subagent builds in its own worktree (`/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>`, own `ATRIUM_PORT_OFFSET`); a SEPARATE Sonnet reviewer finds real defects (every PR today had some); a Sonnet agent fixes them; Opus reads the diff and merges with `gh pr merge --rebase`. Force-push is blocked: a conflicted PR is replaced by a new branch with cherry-picked commits. `docs/plans/owner-check-list.md` conflicts constantly: have Opus add check sections in a separate docs PR instead of in feature PRs.
- Older plan and gotchas: `docs/plans/2026-11-03-autonomous-batch.md` and `docs/handoff/2026-11-03-ophelia-autonomous-batch.md`.

## Notes index

- [2026-11-08 · Ophelia · the autonomous run (inbox, export, print, Twemoji, PWA-1)](docs/handoff/2026-11-08-ophelia-autonomous-run.md)
- [2026-11-07 · Ophelia · logo live and board cleanup](docs/handoff/2026-11-07-ophelia-logo-and-board-cleanup.md)
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
