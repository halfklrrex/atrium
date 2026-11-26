# VF: selection action bar and bulk-update toast match monday

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: "VF: bulk-selection action bar and toast wording vs monday" · Branch `claude/vf-batch-bar`

## Source

The owner's side-by-side screen recordings (2026-11-07). Two frames are saved for you: `/private/tmp/claude-501/ref/monday-bulk-bar.png` (monday) and `/private/tmp/claude-501/ref/atrium-bulk-bar-before.png` (Atrium today). Open both with the Read tool. The bar is at the bottom center of the frame.

## Differences to close

|                         | monday                                                                                                                                                           | Atrium today                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Layout of each action   | icon **above** a small label, each action a compact vertical button                                                                                              | icon and label side by side                                                                                    |
| Actions shown           | count circle, "Items selected", Duplicate, Export, Archive, Delete, Move to, close X (monday also has Convert and Apps: **leave those out**, Atrium has neither) | count, text, group dots, divider, Duplicate, Export, Archive, Delete, "Move to" with a trailing chevron, close |
| Toast after a bulk edit | "We successfully updated N items" with an Undo link                                                                                                              | "Updated N items"                                                                                              |

## Changes (all in `apps/web/src/components/board-table`)

1. `BatchBar.tsx` and its classes in `table.module.css`: render each action (Duplicate, Export, Archive, Delete, Move to) as a vertical stack: the 16-px Vibe icon over a label. Keep every existing behavior, menu, handler and `aria` label; Move to keeps its group menu (give it an icon from `@vibe/icons`, e.g. `Move`, and open the same menu from a plain button). Keep the count circle, "Items selected", the group dots and the close button. Hover and focus states use Vibe tokens; the bar stays one row, centered, and keeps its z-index and bottom offset tokens.
2. `bulk-edit.ts` `bulkSummary`: the all-success text becomes `We successfully updated ${updated} items` (`We successfully updated 1 item` for one). The skipped text stays as is and never hides skipped rows. Update `bulk-edit.test.tsx` and any other test that asserts the old text (`grep -rn "Updated .* items" apps/web`).
3. Tokens only: every color, spacing, size, radius, font and shadow comes from Vibe variables or `apps/web/src/theme/tokens.css` (add a named token there only if Vibe has none; `tokens.css` is a hot-spot file, so keep the change minimal). Stylelint and ESLint enforce this.
4. Do not animate layout properties; respect `prefers-reduced-motion` (no new animation is needed).

## Tests and checks

- Component tests: all five actions render with their labels and still call the same table actions; the Move to menu lists the groups; the toast text for one and several items.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- This changes a screen the visual job covers if any visual spec selects rows. Run `grep -rn "Items selected" tests/visual`. If one does, do not hand-edit PNGs: after the PR is open and the `visual` job fails on purpose, run `gh workflow run update-visual-baselines.yml -f branch=claude/vf-batch-bar` and `gh run watch`, and mention it in the PR. Take a real light and dark screenshot of the bar (Playwright, not the diff ratio) and attach it to the PR description.

American English everywhere.
