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
  - archive, trash and undo
  - empty states and the notifications bell and panel (2026-10-30)
  - the layering fix for menus
- **Data:** Firestore named database **`atrium-1`** (`eur3`, scheduled backups), through `FIRESTORE_DATABASE_ID`. `(default)` (`nam5`) is unused legacy.
- **Showcase:** the "🧪 Atrium Showcase" board is in the owner's Test Workspace (id in `.private/project-ids.md`, gitignored, local only). Re-seed it per `docs/showcase.md`.
- **Deploys:** automatic on merge to `main`. Eventarc and Cloud Scheduler are set up. **Merge only when the checks pass**; the repo has no branch protection (an owner decision).
- **Bugs:** the owner posts them in the monday Roadmap's 🐞 Bugs → "Bug inbox" item. Check it at the start of every session (`AGENTS.md`).
- **Actionable column** on the Roadmap: Yes (owner's move), Agents (owner answered, so it's back with us), No. Check the Agents items at the start of every session (`AGENTS.md`).
- **Folders:** `D:\DevProjects\Atrium\atrium-cl` (Ophelia, offset 0) and `atrium-ag` (Ava, offset 100). Avoid offset 30 (port 9180 is often taken).

## Open work (2026-10-31)

- **Ava is on a break with no end date.** Ophelia works alone. Ava's stale `ag/*` branches are superseded by rebased copies on `main` and can be deleted. Her Roadmap items are now Agent = Claude.
- **Ophelia, resume here:** P4b board sharing is being built by a Sonnet subagent (spec `docs/specs/P4b-board-sharing.md`, worktree `atrium-cl-wt\p4b-board-sharing`, branch `claude/p4b-board-sharing`). Review, push, run the baseline workflow, merge, then the live two-account check. After that: the Roadmap items with Actionable = Agents, the bug inbox, and the "Column settings & column permissions" item (probably ready to sign off).
- **Owner review (Actionable = Yes):** notifications, Files, Button, Connect boards and Mirror, @mentions in descriptions, Calendar, Timeline, change a column's type, plus the older list (scrollbars, membership, saved views, the showcase).
- **Next candidates (nothing claimed):** P3 My Work and global search, Gantt, Workload, Chart; P4 teams and profiles, activity log, email notifications, PWA and web push; P5 automations (design first). VF backlog: Members dialog fidelity, Kanban inline subitems, sticky bar names on the Timeline.
- **Owner decision pending:** flag emoji on Windows (needs a CDN picture fallback).
- Details, gotchas and what to check live: `docs/handoff/2026-10-31-ophelia-ava-queue-and-p3.md`.

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
- [2026-10-24 · Antigravity · Board filter, sort, search & group-by](docs/handoff/2026-10-24-antigravity-board-filters-sort.md)
- [2026-10-25 · Antigravity · Files storage upload, rules & tests](docs/handoff/2026-10-25-antigravity-files-storage-upload.md)
- [2026-10-25 · Antigravity · Server-side column actions](docs/handoff/2026-10-25-antigravity-server-column-actions.md)
