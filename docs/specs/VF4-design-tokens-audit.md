# VF4: Design tokens audit and enforcement

Author: Opus 5.5 · Implementer: Sonnet 5.5 (high effort) · Roadmap: VF "Design tokens audit" · Branch: `claude/vf4-tokens` · Worktree `ATRIUM_PORT_OFFSET=10`

## Goal

`AGENTS.md` says every colour, spacing step, radius, shadow and font comes from Vibe CSS variables or `apps/web/src/theme/tokens.css`. Today that's a convention. Make it **enforced** and **true**.

## Build

1. **Audit:**
   - Find every hard-coded value in `apps/web/src/**/*.{css,module.css,ts,tsx}`: hex, `rgb`/`rgba`/`hsl`, named colours, `px`/`rem` lengths in colour, spacing, radius, shadow, font-size, line-height and font-weight declarations, font-family strings, and inline `style={{…}}` literals.
   - **Allowed exceptions:**
     - `0`, `1px` borders and hairlines, `100%`, `auto`, `inherit`
     - SVG illustration geometry (paths and viewBoxes)
     - the shared colour palette that's persisted to data (`theme/palette.ts`)
     - the Google brand colours in `GoogleSignInButton` (required by Google's guidelines)
     - test files
   - Write the inventory into the PR description as a table: file, value, replacement.
2. **Fix:**
   - Replace each literal with the matching Vibe variable. Grep `@vibe/core`'s CSS for the real token names; never invent one.
   - Where Vibe has no match (layout sizes like the sidebar width, the monday-measured values from `docs/reference/monday-ui-reference.md`), add a named token to `tokens.css` in the right section, with light, dark and black values where they differ.
   - Remove dead tokens.
   - **No visual change is intended.** The goal is identical pixels.
3. **Enforce:**
   - Add **Stylelint** (`stylelint`, `stylelint-config-standard`, CSS-modules aware), with rules that ban colour literals (`color-no-hex`, `color-named: never`, function-disallowed-list for `rgb`/`rgba`/`hsl`/`hsla`) and raw px or rem on spacing, radius, font-size and shadow properties, through `declaration-property-unit-disallowed-list` or a small custom plugin.
   - Allow-list `tokens.css`, the illustration files and the exceptions above, using targeted `/* stylelint-disable-next-line ... -- reason */` comments or overrides. Don't use broad disables.
   - Add an ESLint rule (`no-restricted-syntax`) that flags colour-literal strings in TSX `style` props.
   - Wire Stylelint into `pnpm lint`, so CI enforces it.
4. **Housekeeping:** add `.claude/worktrees/` to `.gitignore`. These are Claude's per-task worktrees, and they currently show as untracked in the home copy.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- **The `visual` CI job must stay green with NO baseline changes.** That's the proof nothing moved. If a screenshot changes, find out why and fix the token mapping. Don't update baselines to make it pass, unless the change fixes a genuine bug; if so, explain it in the PR.
- Spot-check light, dark and black for Home, the workspace page and the board page in the dev server (offset 10).

## Constraints

- Work only in your worktree, on `claude/vf4-tokens` created from `origin/main`.
- Another Claude agent is building the **board table (P1b) in parallel**. **Don't touch** `apps/web/src/components/board-table/**` or `apps/web/src/theme/table-tokens.css` if they appear; they're its responsibility and it follows the same rules.
- Antigravity has open PRs for the item card and undo/trash. Don't touch `components/item-card/**`, `pages/TrashPage*` or `functions/src/**/purge*`. Once your lint rule lands, they'll have to comply when they rebase. List in your report anything on their branches you expect to violate it.
- Hot-spot files (`tokens.css`, `pnpm-lock.yaml`): keep the diffs focused.

## Done

- A PR is open to `main`, with the inventory table. End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, and end the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Don't merge.
- **Report:** the PR URL, the counts (found, replaced, allow-listed), CI status, and the tokens added.
