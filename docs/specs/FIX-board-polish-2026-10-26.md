# Board polish: updates bubble, group handle, group gutter and corners (owner review, round 2)

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Branch `claude/board-polish` · Worktree `ATRIUM_PORT_OFFSET=10` · Roadmap: 3309201024 (bubble) and 3309193137 (group handle and gutter)

The owner checked PR #52 live. The Sort and Filter, groups and side-panel fixes are confirmed. Three things are left.

**References** (private; never copy them into the repo):

- in the lead's private scratch folder (not in the repo):
  - `8.png`: the owner's crop of monday's bubbles;
  - `9.png`: monday's board, showing the groups' gap from the sidebar;
  - `monday-bubbles-group.png`;
  - `monday-group-hover-handle.png`: group header hovered, showing the "⋯" handle.

## Measured from monday (2026-10-26, 1920px viewport)

- **Board panel and gutter:**
  - The white board panel starts at x=267, and the board title starts at x=309.
  - The group table (`table-wrapper`) starts at **x=307**, so there's a **40px gutter** between the panel's left edge and the group.
  - **The group "⋯" handle** sits _in that gutter_: a 24×24 box at x=279 (12px from the panel edge), vertically centred on the group title row.
    - It's only visible while the **group header** is hovered.
    - It has a white background, 4px radius and a 14px glyph.
- **Group block:**
  - The table wrapper has an **8px radius** and a 1px grid border (the border colour token).
  - The coloured left indicator is **6px wide**, rounded at its top-left corner (**6px**), with a `0 -2px 0 0 white` inset shadow on its top edge.
  - **No drop shadow** was measured on the table. The owner reads the rounded corners plus the border as a "drop effect". Match monday's corners and border first, and only if it still looks flat, add the subtlest elevation token (`--box-shadow-xs`). Note which you chose in the report.
- **Updates bubble**, per row in the name cell's right edge:
  - **No updates:** the grey outline "add update" icon (a speech bubble with +), as we have.
  - **With updates:** a **blue (`--primary-color`) outline speech-bubble icon**, about 20px, with a **small filled blue circular badge** at its bottom-right corner, overlapping the bubble's edge.
    - The badge is about 14px, white bold text at about 10px, holding the count, and "9+" style above 9 if it doesn't fit.
    - Not a filled blue circle with a number, which is what #52 shipped.
  - Hover gives a light background square, as on our other row icons.

## Build

1. **Updates bubble:**
   - Replace the #52 filled bubble with the monday look above. Use a Vibe icon if one fits; otherwise an inline SVG, with colours from `currentColor` and tokens.
   - Keep `updatesCount` as the data source.
   - Unit test: the badge shows the count and switches between 0 and N states.
2. **Group handle:**
   - The owner can't see the "⋯" handle at all today. Find out why: it may be hidden off-screen, clipped by the new gutter, or never rendered.
   - Render it in the gutter, on group-header hover (and on focus within, for keyboard users), opening the existing group menu.
3. **Gutter:**
   - Board content gets the 40px left gutter measured above. #52's `--atrium-table-gutter-start` is the token to adjust, so groups no longer sit against the sidebar.
   - The board header (title, tabs, toolbar) and the groups stay aligned with each other, as in monday: title x ≈ group x.
4. **Group corners:**
   - 8px radius on the group table block. The left colour bar is 6px wide, with a 6px top-left radius and the white top inset.
   - The bottom of the group (the footer and summary row) gets rounded corners too, if that's the block's end.
   - Make sure sticky header cells and the name column don't poke out of the rounded corners (`overflow: clip` or radius on the corner cells).

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` pass.
- **QA in the dev server, in light and dark:**
  - a board with two groups and items with 0, 1 and 12 updates;
  - group header hover showing the handle, and its menu opening;
  - a crop like the owner's `9.png`, to compare against.
  - Report the screenshot paths.
- Run the baseline workflow on the branch (the board screens will change) and list the changed images.
- Don't touch the item card, item-card routing or `open-item.ts`. A parallel task (`claude/item-full-view`) owns them. Commit, push, and don't open a PR.
