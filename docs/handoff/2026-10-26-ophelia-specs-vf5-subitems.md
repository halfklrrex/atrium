# 2026-10-26 · Ophelia · reviews, specs, VF5, subitems

## Done

- **Reviewed and merged Ava's PRs:**
  - #45: the vote race fix, real names in filters, and all 16 types in the showcase.
  - #46: the filled favourite star. I pushed a Prettier fix and a `PROVENANCE.md` row for the Vibe star path to `ag/bug-favourite-star`.
  - The #45 follow-ups are logged on the PR and as Roadmap item 3308619604.
- **#47:** Sonnet coding subagents now run at **medium** effort (owner decision, in `CLAUDE.md`).
- **#48, specs:**
  - `VF5-item-card-updates-fidelity.md`
  - `P1-subitems.md`
  - `P2-column-locks.md` (Ava)
  - `P2-column-cells-editors.md` (Ava, three PRs)
  - `P4a-workspace-membership-invites.md`
  - plus the measured monday **updates thread** reference (`monday-ui-reference.md`, `11`).
- **#49, VF5:** the item card and updates thread now match monday: about 36vw wide, Poppins title, flat bordered cards, reply bubbles, a collapsing composer, and typography tokens. It's deployed and the item is set to In review for the owner.
- **Subitems** (`claude/p1-subitems`): built. See the open work below for its status.
- **Showcase:** re-seeded in production after #45.

## For Ava (start here tomorrow)

1. `docs/specs/P2-column-cells-editors.md`, **PR A** (`ag/cells-time-location`): the #45 follow-ups, the time-column editors, the timeline pill and location.
2. `docs/specs/P2-column-locks.md` (`ag/column-locks`). It touches `firestore.rules`, `tests/rules/**` and `packages/shared/**`. **Rebase on main after subitems merges**, because subitems also changed the items rules block.
3. Then PRs B and C of the cells spec.

## Open work

- **Subitems:** merged (#50) after one round of fixes (column ids must be unique across `columns` and `subitemColumns`). The showcase still needs a production re-seed, and the owner should compare it with monday.
- **Owner review (afternoon):** 7 items Done, plus 4 bugs and 2 VF items, which are going into `claude/owner-review-fixes` (spec `FIX-owner-review-2026-10-26.md`). Two new feature specs: `P1-full-item-view.md` (a floating ClickUp-style item window with a rich description) and `P2-change-column-type.md` (server-side migration with undo).
- **P4a membership:** set to Pending dependencies. It starts once subitems has merged.
- **Specs still owed by Ophelia:** mirror columns (who writes `mirroredValues`), `auto_number` (no server assigner exists), P4b board sharing, and monday's formula function list.

## Gotchas

- **Worktree removal on Windows:** `git worktree remove --force` may fail with "Filename too long". The worktree is still deregistered, so delete the folder with PowerShell: `cmd /c rmdir /s /q "\\?\<path>"`.
- **`test-results/`** is not gitignored in worktrees. Subagents leave scratch seed files there, so never commit it.
- **Reading monday in Claude in Chrome:** the item panel is `position: fixed`, so `offsetParent` filters skip it. Use `getClientRects().length` when selecting elements to measure.
