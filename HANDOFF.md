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

## Open work (2026-11-06)

- **Live today (2026-11-06):** the Automation center redesign is complete (R4, #115), catalog templates ready (#117), automation updates shown as "Automations" (#118), the Windows flag emoji fallback (#119), the **required-columns hard rule** (#116, #122, #123), **time-based automations** (P5d-1 to P5d-4: #124, #126, #127, #128; showcase recipes are seeded switched off), the **dashboard sharing server-side check** (#130) and **attachments in item updates** (#132 backend, #133 web; the daily trash purge now also deletes stored files and updates). Specs merged: site admin role (#121), P5d (#120), update attachments (#131). **ADMIN-1a** (#129: account status types, claims backfill script, `pnpm admin:grant`; no gate, nothing run) is merged.
- **Latest session note:** `docs/handoff/2026-11-06-ophelia-req-p5d-admin-spec.md` (what merged, decisions, gotchas, what's waiting).
- **In flight:** nothing open. Everything below waits on the owner or on Chrome.
- **Owner decisions, 2026-11-06:** site admin role defaults confirmed (existing accounts stay approved, waiting screen, bell notification); required columns defaults confirmed (both rules, eventual revert, no bypass).
- **Waiting on the owner:** the live checks in `docs/plans/owner-check-list.md` (Chrome extension was not connected today); **"go" on the site-admin item (3335038323)** to run the account-claims backfill (dry run first, apply, second dry run must show 0) and `admin:grant` for the owner's account, which unblocks ADMIN-1b (the gate), ADMIN-2 and ADMIN-3; go-aheads for three production writes whose dry runs are done or ready: the `requiredColumnIds` backfill (8 boards), the legacy-activity cleanup (1 doc) and the `dateKeys` backfill (not dry-run yet). Small open questions with defaults in the site-admin, P5d and update-attachments specs.
- **Ava is on a break with no end date.** Ophelia works alone. Ava's Roadmap items are Agent = Claude.
- **Next, in this order:**
  1. Start-of-session routine (bug inbox, Actionable = Agents; filter by label id, Agents = 4, not the index).
  2. Site admin after the owner's go: backfill, verify, ADMIN-1b (gate), ADMIN-2, ADMIN-3.
  3. VF visual QA for the new screens (needs Chrome); apply the production backfills the owner approves; re-seed the showcase after visible changes.
  4. Unstarted epics that need a spec first: Teams & user profiles, Email notifications, PWA and web push, Docs editor, Map and Files gallery views, Export and print, the P8 public API (plan an ultrareview checkpoint first).
- **Local machine (Mac):** `gcloud` is installed and signed in; `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH` for `pnpm test:rules`; `LC_ALL=en_US.UTF-8 pnpm test` avoids 5 locale-only web test failures; typecheck one package at a time (`pnpm -r --workspace-concurrency=1 typecheck`).
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
