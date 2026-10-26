# VF5: Item card and updates sidebar fidelity, plus app-wide typography consistency

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: VF "VF: item card & updates sidebar fidelity + app-wide font/design-system consistency" (3308012577) · Branch `claude/vf5-item-card` · Worktree `ATRIUM_PORT_OFFSET=10`

## Why

The owner reported (bug inbox update 659158661) that our item card and updates feel "a lot less seamless and pretty" than monday's. Part of the cause is that fonts and design-system use aren't consistent across the app. The measured target is `docs/reference/monday-ui-reference.md`, sections **Item card (`06`)** and **Item card: updates thread (`11`)**. The screenshots `06-item-card.jpg` and `11-item-card-updates-thread.jpg` are in the home copy's `docs/reference/monday/` (gitignored); read them from `D:\DevProjects\Atrium\atrium-cl\docs\reference\monday\`.

## Build

### 1. Typography audit (app-wide, do this first)

- **Inventory:** list every `font-family`, `font-size`, `line-height`, `font-weight` and `font:` declaration in `apps/web/src/**/*.css`, plus any typography set in TSX.
- **The target system:**
  - **Figtree** (`var(--font-family)`) for all UI text.
  - **Poppins** (`var(--title-font-family)`) only for page, board, group, workspace and item-card titles.
  - Sizes follow monday's scale: 14px/20px for most UI text, 15px/22.5px for body text such as update bodies, 14px/21px for reply text, and 12px for meta text and hints.
  - Use Vibe's `--font-size-*` and `--font-line-height-*` variables. Where Vibe has no match, add named composite tokens to `apps/web/src/theme/tokens.css`, following the existing `--atrium-*-font` pattern. Examples: `--atrium-update-body-font`, `--atrium-reply-body-font`, `--atrium-meta-font`.
- **Fix the outliers:** wrong family, ad-hoc sizes, `line-height: 1.5` numbers where the scale specifies px pairs, and Vibe `Text`/`Heading` components given the wrong `type`.
- **Vibe components:** where a raw `<span>`/`<div>` reimplements what Vibe's `Text` or `Heading` already does, prefer the Vibe component. Don't rewrite working components only for that.
- Put the inventory table (file, before, after) in the PR description.

### 2. Item card panel (`ItemCardDrawer.*`)

- **Width:** about 700px at a 1920px viewport. Use a `clamp()` token so it's about 36% wide, with sensible minimum and maximum widths. Full height below the top bar. Shadow `0 4px 8px` (Vibe `--box-shadow-medium` or the closest token), no border, square corners.
- **Header:**
  - A close X, then the title (Poppins 24px/34px weight 500, inline-editable, using the existing rename behaviour).
  - On the right: assignee avatar(s), a subscribe icon and `⋯`.
- **Tabs:** Updates, Files, Activity Log. The Updates tab shows its count as "Updates / N". Use Vibe `Tabs` if it fits; otherwise match the 14px/24px text and the blue active underline.
- **Sub-actions row:** add one under the tabs only if we have a real action for it. Otherwise leave it out; don't add dead buttons.

### 3. Updates feed (`UpdatesFeed.*`, `UpdateReplies.*`)

- **Composer, collapsed:** a single bordered box (1px `--ui-border-color`, 8px radius) with the placeholder "Write an update and mention others with @" and an icon row.
- **Composer, focused:** it expands to show the toolbar row, an editor about 80px tall, and the blue "Update" button. The focus border is `--primary-color`.
- **No grey header or footer bands.** Today `.composerToolbar` and `.composerFooter` use `--secondary-background-color`; monday's are white.
- **Update card:**
  - 1px border (`--layout-border-color` or the closest token to `#C3C6D4`), 8px radius, **no shadow** (remove `--box-shadow-small`), white.
  - Header: 16px padding, 40px avatar, author name 14px/20px bold, relative time in secondary text right after the name, and the action icons on the right.
  - Body: 15px/22.5px, padding `0 16px 16px`. Links in the link colour, not underlined.
  - "Edited" at the bottom right, in secondary text.
  - Reaction summary chip.
  - A full-width 1px divider, then an action row (48px tall, padding `8px 8px 8px 16px`) with a like icon button and a "Reply" tertiary button.
- **Replies:**
  - Each reply sits inside the parent card: a 32px avatar plus a bubble (`--allgrey-background-color` or the closest token to `#F6F7FB`, 8px radius, 12px padding).
  - Inside the bubble: the name (14px bold) and time on one line, then the text at 14px/21px. A small like/Reply row under each bubble.
  - The reply composer is at the bottom: a 32px avatar plus a bordered field with an 8px radius.
- **Relative times:** "1d", "17h", "5m". Check `apps/web/src/lib` for an existing formatter before adding one.
- **Empty state:** keep the current illustration. Match "No updates yet" (bold 16px) and two lines of secondary text.
- **Dark and black themes:** every colour comes from tokens, so the panel works in all three themes. Check that reply bubbles stay distinguishable from the card in dark mode.

### 4. Keep behaviour

All existing behaviour must keep working: posting, replies, likes, editing, deleting, mentions if present, and real-time updates. Update the unit tests whose DOM assertions change. Don't delete tests.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` pass.
- **Visual QA in the dev server (offset 10):**
  - Open an item with at least two updates, one of them with two replies. Seed it through the app or the showcase seed: the showcase main board has items with updates and replies.
  - Screenshot the panel in light, dark and black.
  - Compare the light screenshot side by side with `11-item-card-updates-thread.jpg`, and list the remaining differences in the PR description.
  - Sign in with email and password through the SDK; the Google popup doesn't work in embedded browsers.
- **Visual baselines will change** (the item card and maybe other screens, through typography). After pushing, run `gh workflow run update-visual-baselines.yml -f branch=claude/vf5-item-card`, wait for it, and list the changed baselines in the PR description. Never commit `*-win32.png` or `*-darwin.png`.

## Constraints

- Tokens only. Stylelint and ESLint enforce this, and `theme/*.css` is the only place for literals.
- No layout-property animations. Respect `prefers-reduced-motion`.
- Don't touch board-table row rendering, `firestore.rules`, `packages/shared` or the data layer. A parallel subitems task (`claude/p1-subitems`) owns those.
- Don't open the PR yourself. Commit on the branch, push it, run the baseline workflow, and report back with the inventory, the remaining differences and the screenshot paths.
