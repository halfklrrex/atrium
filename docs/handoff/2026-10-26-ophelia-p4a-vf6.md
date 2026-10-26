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

## Later the same evening

- **VF7: thin scrollbars** (PR #12, merged).
  - The owner saw "smushed" corners on the full item view. The cause was Windows' classic 17px scrollbars, with arrow buttons, running into the window's rounded corner.
  - Now `theme/scrollbar-tokens.css` gives monday-style 4px and 6px scrollbars (measured on monday). Every scroll container opts in with `composes: atrium-scroll from global`.
  - **Gotcha:** headless Playwright passes `--hide-scrollbars`, so no visual test or CI baseline can see scrollbars. To check them, run Playwright with `ignoreDefaultArgs: ['--hide-scrollbars']` on Windows.
- **Flaky test fix** (PR #10): `membership.test.tsx` now waits up to 5s for Vibe's async menus (`pickMenuAction`).
- **Owner production runs (done by the owner):**
  - The member backfill dry run found nothing to write; `bootstrapUser` had already healed it.
  - The showcase was re-seeded with the three fictional members.
- **Roadmap Actionable column** (`AGENTS.md`): Yes, Agents or No.
  - All items waiting on the owner are set to Yes, each with an update saying what to check.
  - Explanations were posted on "Showcase board + seed script" and on "Tags, rating, vote, …".

## Gotchas

- **The visual gate misses small colour-token shifts.**
  - The dark Kanban lane moved from #30324e to #393b53 and still passed: it's within Playwright's per-pixel `threshold`, and a 16 → 20px icon change sits under `maxDiffPixelRatio`.
  - After any token change, refresh the screens you changed with `-f grep="<screen title>"` and review the image diffs.
- **Never use `--update-snapshots=all` on the whole suite.** Renders aren't byte-identical between runs, so every PNG changes and parallel PRs conflict.
- **Removing a worktree on Windows** can fail with "Filename too long" in `node_modules`. Use `cmd /c "rd /s /q \\?\<path>"` after `git worktree remove`.

## Next

- **Start of next session:** the Roadmap items with Actionable = Agents, then the owner's reply on "VF: item card & updates sidebar" (they asked to discuss the next pass).
- **VF "Members dialog & invite page fidelity":** capture monday's members dialog, then do the measured pass. It's low priority.
- **Kanban:** inline subitem expansion on cards, as monday does it. People and date field rows are still unmeasured, because the owner's Roadmap Kanban shows neither field.
- **Open question for the owner:** should the visual gate be stricter on colour (a lower per-pixel `threshold`)? It would catch token shifts but is noisier. It's unchanged for now.
