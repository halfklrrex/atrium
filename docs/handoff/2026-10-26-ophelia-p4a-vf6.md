# 2026-10-26: Ophelia (Opus 5.5): P4a membership and the VF6 Kanban pass

## What was done

- **P4a: workspace membership, invites and member profiles** (PR #8, merged and deployed).
  - Spec: `docs/specs/P4a-workspace-membership-invites.md`. Implementation details: `docs/handoff/2026-10-26-claude-p4a-membership.md`.
  - Logged two decisions on the Decisions board: member profiles in `workspaces/{id}/members/{uid}`, and invites accepted by verified email only.
- **VF6: Kanban fidelity** (PR #7, merged).
  - Measured monday's Kanban read-only in light and dark on 2026-10-26; the values are in `docs/specs/VF6-kanban-fidelity.md`.
  - Changes:
    - card border `--layout-border-color`;
    - dark lanes `--dark-background-color` (#393b53) behind `--primary-background-color` cards;
    - status chip with a separate 4px bar;
    - 20px footer icons, a plain updates bubble, and a dimmed subitems icon when an item has none.
- **Visual baselines:** `update-visual-baselines.yml` takes an optional `grep` input (see `docs/visual-testing.md`).

## Gotchas

- **The visual gate misses small colour-token shifts.**
  - The dark Kanban lane moved from #30324e to #393b53 and still passed: it's within Playwright's per-pixel `threshold`, and a 16 → 20px icon change sits under `maxDiffPixelRatio`.
  - After any token change, refresh the screens you changed with `-f grep="<screen title>"` and review the image diffs.
- **Never use `--update-snapshots=all` on the whole suite.** Renders aren't byte-identical between runs, so every PNG changes and parallel PRs conflict.
- **Removing a worktree on Windows** can fail with "Filename too long" in `node_modules`. Use `cmd /c "rd /s /q \\?\<path>"` after `git worktree remove`.

## Next

- **Owner, after the P4a deploy:**
  - Run the member backfill against production: first `pnpm exec tsx scripts/backfill-members.mjs --project atrium-board` (dry run), then add `--yes`.
  - Then re-run the showcase seed (command in `.private/project-ids.md`) so the fake member profiles appear.
  - The agent's permission mode blocked these production runs.
- **VF "Members dialog & invite page fidelity":** capture monday's members dialog, then do the measured pass. It's low priority.
- **Kanban:** inline subitem expansion on cards, as monday does it. People and date field rows are still unmeasured, because the owner's Roadmap Kanban shows neither field.
- **Open question for the owner:** should the visual gate be stricter on colour (a lower per-pixel `threshold`)? It would catch token shifts but is noisier. It's unchanged for now.
