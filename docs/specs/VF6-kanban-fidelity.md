# VF6: Kanban visual fidelity (measured pass)

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: VF "VF: Kanban view fidelity" · Branch `claude/vf-kanban` · Follows `P3-kanban.md` (merged)

## Goal

Close the gaps between Atrium's Kanban and monday's real Kanban, in light and dark. This is a styling pass only: no behaviour, data or settings changes.

## Reference (measured 2026-10-26, read-only, monday Kanban view at a 1288px-wide viewport)

To see the dark theme, the page's theme class was swapped in the local DOM only. Nothing in the account was changed. The private screenshot is `docs/reference/monday/12-kanban.jpg` (home copy only).

| Element                        | Light                                                      | Dark                                                           |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- |
| Board content behind the lanes | `--primary-background-color` (#ffffff)                     | `--primary-background-color` (#181b34)                         |
| Lane body                      | `--allgrey-background-color` (#f6f7fb)                     | **#393b53** (Vibe `--dark-background-color` in the dark theme) |
| Card background                | `--primary-background-color` (#ffffff)                     | `--primary-background-color` (#181b34)                         |
| Card border                    | 1px **`--layout-border-color`** (#d0d4e4)                  | 1px `--layout-border-color` (#4b4e69)                          |
| Status chip on a card          | `--primary-background-hover-color` (rgba(103,104,121,0.1)) | the same variable (rgba(103,104,121,0.3))                      |
| Tag chip                       | #cce5ff                                                    | #133774                                                        |
| Lane header text               | white                                                      | white                                                          |

**Card geometry** (unchanged unless listed): 236px wide, 8px padding, 8px radius, no shadow. The title is 14px/18px.

**Status chip on a card:**

- 24px tall, radius 4px, `overflow: hidden`.
- A **separate 4px-wide bar** in the label colour at the left edge, clipped by the chip's radius (not a rounded border).
- The text starts **4px after the bar**, so 8px from the chip's edge, and has 8px padding on the right. 14px/21px, primary text.

**Footer:**

- Right-aligned. The icons are **20px** (today they're 16px).
- **Updates icon:** `--secondary-text-color`. With updates, the count comes first ("4"), at **15px/22.5px** in primary text. Without updates, monday shows the plain updates bubble, not the "add update" bubble with a plus.
- **Subitems icon:** primary text at **38% opacity** (`--disabled-text-color`) when the item has no subitems. With subitems, it's `--secondary-text-color` with the count before it, as for updates.

## Changes

All of them go in `apps/web/src/theme/kanban-tokens.css` and `apps/web/src/components/board-kanban/` (`kanban.module.css`, `KanbanCard.tsx`).

1. **Card border:** `--atrium-kanban-card-border` uses `--layout-border-color` instead of `--ui-border-color`.
2. **Card background:** `--atrium-kanban-card-bg: var(--primary-background-color)` in every theme. Today it's `--atrium-surface-bg`, which is `--secondary-background-color` in dark and black.
3. **Lane body in dark and black:** add `.dark-app-theme, .black-app-theme { --atrium-kanban-lane-bg: var(--dark-background-color); }` to `kanban-tokens.css`.
   - Check the computed value in dark is #393b53. If Atrium's Vibe version gives `--dark-background-color` a different dark value, add a named literal token `--atrium-kanban-lane-bg-dark: #393b53` in the theme file instead.
   - For the black theme, use the same variable. Note in the PR what it resolves to.
4. **Board background behind the lanes:** in dark and black, the Kanban scroll area sits on `--primary-background-color`, so the lanes stand out like monday's. Light is already right.
   - Keep this to the Kanban `.scroll`/`.root`; don't change the app's panel token.
   - If the content panel's own background shows around the Kanban and makes a visible seam, report it rather than restyling the shell.
5. **Status chip:**
   - Replace `border-inline-start` with a 4px bar element (or a `::before`) clipped by `overflow: hidden` and a 4px radius.
   - Padding: 4px between the bar and the text, 8px at the end.
   - Background: `--atrium-kanban-status-bg: var(--primary-background-hover-color)`.
6. **Footer:**
   - Icons 20px (new token `--atrium-kanban-footer-icon: 20px`).
   - The updates button always uses the `Update` icon on cards (drop `AddUpdate` here only; the table keeps it).
   - Updates icon colour `--secondary-text-color`.
   - Subitems icon `--disabled-text-color` when the item has none, `--secondary-text-color` when it has some.
   - Count font 15px/22.5px (update `--atrium-kanban-count-font`).
   - Keep the hit areas at least 24px.
7. **Field rows for people and dates:** the Roadmap board's Kanban shows neither, so there's no measurement. Changing the owner's card fields to capture one would change the account, which isn't allowed. So check our rendering for sense only:
   - People avatars and dates sit left-aligned on the 24px row, on the icon's baseline.
   - Nothing overflows the 236px card. Long values truncate with an ellipsis.
   - Fix alignment only if it's off. Don't restyle the table cells.
   - Leave `columns/people.tsx`, `UserAvatar` and any person lookup alone: another task (P4a, `claude/p4a-membership`) is changing them right now.

## Not in scope

- Inline subitem expansion on a card (monday expands subitems in place). That's a separate follow-up.
- Toolbar export and board-updates icons.
- Any change to `tokens.css` (a hot-spot file). If a token is truly missing, add it to `kanban-tokens.css`.

## Tests and QA

- **Unit tests:**
  - update `KanbanBoard.test.tsx` and any card tests that assert the `AddUpdate` icon or the status chip's markup;
  - add a test that a card without updates renders the updates icon without the plus;
  - add a test that the subitems icon gets the "empty" class when the count is 0.
- **Visual baselines:** the `board-kanban` and `board-kanban-collapsed` screens will change. Don't regenerate them locally; the lead runs the "Update visual baselines" workflow on the branch after pushing.
- **Checks:** `pnpm lint` (Stylelint bans literals outside `theme/*.css`), `pnpm typecheck`, `pnpm test`, `pnpm build`. Run `pnpm test:rules` too, though nothing here should affect it.
- **Showcase:** no data changes are needed. The "Status board" view already exists.

## Privacy

The repo is public: follow `AGENTS.md` → Privacy.
