# VF1: Shell polish to match monday

Author: Opus 5.5 · Implementer: Sonnet 5.5 (high effort) · Roadmap: VF "App shell parity"

The owner compared the live P1a shell with monday side by side and found it "better, but not quite there". The measured target is in `docs/reference/monday-ui-reference.md`, section **"Shell layout, re-measured"**. Screenshots are in `docs/reference/monday/` (open them with Read). Fix every gap below. Don't touch board-page internals: P1b rebuilds the board page right after this.

## Gaps to close

1. **Floating panels on the surface.** This is the biggest difference.
   - The background below the top bar is `#EDF1FC`.
   - **Sidebar:** 12px left margin, 255px wide, **top-left radius 12px**, background `linear-gradient(135deg, #FFFFFF 5%, #EDF1FC 100%)`, no border.
   - **Content panel:** directly to its right. White, **top-left radius 12px**, filling the right and bottom edges.
   - Today the sidebar is flat white and flush with the content, and the content panel shows no rounded corner. In monday's screenshot you can see the content panel's own rounded top-left corner against the sidebar gradient.
   - When the sidebar is collapsed, the content panel starts 12px from the left edge.
   - **Dark and black themes:** the surface is the theme's darkest background token. The sidebar gradient runs from the panel colour to the surface colour, and the content panel is the theme's primary background. Use tokens only.
2. **No divider lines in the sidebar.** Remove the horizontal rules between Home/My work, Favorites and Workspace. Use spacing instead: about 16px between groups, plus a little more above "Workspace".
3. **Section labels** ("Favorites ›", "Workspace"): Figtree **12px weight 600**, primary text colour (not the grey it is now). Favorites gets a right-pointing chevron that rotates when the section expands.
4. **Workspace switcher:** a **bordered box**: 1px `#C3C6D4` (use the Vibe `--ui-border-color` token if it matches), radius 4px, 32px tall. Inside: a 20px avatar, the name in 16px weight 600, and a chevron at the right. The blue 32×32 "+" button sits 8px to the right of the box, and the box fills the remaining width.
5. **Nav rows:** 32px tall, 8px horizontal padding, 20px icon, 14px label.
   - Inactive label colour is `#676879` (secondary); the active label is primary.
   - **Active route** gets the light-blue selected background `rgba(194,213,255,0.4)`. The owner's screenshot shows "My work" with a grey background on the workspace page, which is wrong: grey is hover only.
   - Make sure the active state follows the current route: Home, My work, the current board.
6. **Top bar:**
   - **Logo:** the Atrium mark, then "Atrium" in Poppins 16px weight 700, then "workboards" in Figtree 16px weight 400 in the secondary colour.
   - **Icons:** 40×40 ghost buttons on a 44px pitch with 20px line icons. Add an app-grid icon button with a little extra space before it. The avatar is 32px.
   - The top bar sits on the surface, with no white background of its own.
7. **Workspace page**, compared with `05-workspace-page.jpg`:
   - **Cover banner:** it sits inside the content panel and follows its rounded top-left corner, so clip it with `overflow: hidden` on the panel.
   - **Avatar:** 72px, radius 8px, with a 4px white ring so it reads as overlapping the banner.
   - **Tab row:** the 1px divider runs the full content width under the tabs. The "+ Add" split button sits on the tab row's right side, as now.
8. **Home**, compared with `04-home.jpg`:
   - The content area under the greeting strip is the light grey `#F6F7FB` area holding the white rounded main card (radius 8px) and the right rail cards.
   - Check that the greeting strip is white, and that it spans the panel and follows its rounded corner.
9. **Collapse control:** keep the circular chevron button on the sidebar's right edge. In monday it only appears while hovering the sidebar, so do the same.

## Constraints

- Don't install packages. Another agent will work on the board page next, so leave `BoardPage` and `components/boards/*` alone, apart from what the shell layout needs.
- Use tokens from `apps/web/src/theme/tokens.css`. Add new ones there; no literals in components.
- Don't animate layout properties. Use transform or opacity, and respect `prefers-reduced-motion`.

## Visual QA gate (required)

1. Run `pnpm dev` and sign in with an Auth emulator test account. The emulator Google popup can't return to the app inside the preview pane; sign in with email and password through the SDK instead.
2. Screenshot Home, a workspace page and a board page in light. Compare each against `01`, `04` and `05`, and iterate.
3. Also screenshot dark and black for Home and a board.
4. Stop the dev server when done.

## Done

`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass. Report: files changed, screens checked, and any remaining gaps. No deploy, commit or push. Don't edit CLAUDE.md, HANDOFF.md or docs.
