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

## Open work (2026-11-05)

- **Live today (2026-11-05):** the automations engine (#90, after an ultrareview and its 7 fixes), the Automation center (#97), the recipe builder and starter recipes (#100), and the dashboard Workload widget, sharing and trash (#102). Earlier on 11-04/05: Gantt, Workload view, templates, dashboards (Numbers, Battery, Chart, Table), forms (builder and public page), the rich-text composer. The showcase was re-seeded on 2026-11-05.
- **Latest session note:** `docs/handoff/2026-11-05-ophelia-automations-merged-redesign.md` (what merged, gotchas, next steps). The plan it follows: `docs/plans/2026-11-04-feature-push.md`.
- **Live since this evening:** P5c (item moved and person assigned triggers, create item and post update actions; #107, #108, #109) and the Automation center redesign R1 to R3 (#105 shell and catalog, #110 Create tab, #111 sentence builder). Newest note: `docs/handoff/2026-11-05-ophelia-p5c-p5e-live.md`.
- **Open PRs:** #112 (R4, the Manage table with the Needs attention chip). Merge when CI is green. **Update 2026-11-06:** #112 is CONFLICTING with `main` and shows no checks; a rebased local copy `claude/p5e-r4-manage-tab-v2` is not pushed.
- **Unfinished work found 2026-11-06:** four subagent worktrees hold uncommitted, unpushed work: Required columns REQ-1, the flag emoji fallback, the automation `post_update` author rendering, and the template relabel (Soon to ready). Each now has a Roadmap item (Building). Details, paths and what each needs: `docs/handoff/2026-11-06-ophelia-in-flight-inventory.md`. Read it first.
- **Owner decision, 2026-11-05:** the Automation center gets redesigned to look more like monday's: **variant A plus two pieces of C** ("Hide coming soon" switch, "Needs attention" chip). Outline and five open questions with defaults: `docs/specs/P5e-automation-center-redesign.md`. Mockups: `.private/design/automation-center/` (gitignored).
- **Live check:** Claude in Chrome now connects. Read-only checks of the Automate dialog and Create tab are done (dark mode). Still open: light mode and running a recipe (it writes data, so the owner or a go-ahead).
- **Ava is on a break with no end date.** Ophelia works alone. Ava's Roadmap items are Agent = Claude.
- **Owner decisions, 2026-11-05:** Required columns are a **hard rule** (spec `docs/specs/REQ-required-columns-hard-rule.md`); the Windows flag emoji gets a **CDN picture fallback**; the legacy-activity migration gets a **dry run only**. Waiting on the owner: the live checks in `docs/plans/owner-check-list.md` and two questions on the site-admin-role request (Roadmap item 3335038323).
- **Next, in this order:**
  1. Start-of-session routine (bug inbox, Actionable = Agents; filter by label id, Agents = 4, not the index).
  2. Merge #112 (R4); then the VF visual QA for the Automation center.
  3. Required columns (REQ-1 to REQ-3), the site admin role (after the owner's answers), the flag emoji fallback, then P5d (needs a spec).
  4. Visual QA (VF) for the new screens; the open "Dashboard sharing: server-side check" item.
- **Local machine (Mac):** `gcloud` is installed and signed in; `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH` for `pnpm test:rules`; `LC_ALL=en_US.UTF-8 pnpm test` avoids 5 locale-only web test failures.
- Older plan and gotchas: `docs/plans/2026-11-03-autonomous-batch.md` and `docs/handoff/2026-11-03-ophelia-autonomous-batch.md`.

## Notes index

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
- [2026-11-05 · Ophelia · P5c live, Automation center redesign R1 to R3](docs/handoff/2026-11-05-ophelia-p5c-p5e-live.md)
- [2026-11-03 · Ophelia · autonomous batch: activity UI, button actions, notify, favourites, rich-text backend, P5 design](docs/handoff/2026-11-03-ophelia-autonomous-batch.md)
- [2026-11-04 · Ophelia · feature push (Gantt, Workload, templates, dashboards data, P5a pieces)](docs/handoff/2026-11-04-ophelia-feature-push.md)
- [2026-11-05 · Ophelia · automations and dashboards merged, Automation center redesign chosen](docs/handoff/2026-11-05-ophelia-automations-merged-redesign.md)
- [2026-11-06 · Ophelia · inventory of work in flight (R4, REQ-1, flag emoji, post_update author, template relabel)](docs/handoff/2026-11-06-ophelia-in-flight-inventory.md)
- [2026-10-24 · Antigravity · Board filter, sort, search & group-by](docs/handoff/2026-10-24-antigravity-board-filters-sort.md)
- [2026-10-25 · Antigravity · Files storage upload, rules & tests](docs/handoff/2026-10-25-antigravity-files-storage-upload.md)
- [2026-10-25 · Antigravity · Server-side column actions](docs/handoff/2026-10-25-antigravity-server-column-actions.md)
