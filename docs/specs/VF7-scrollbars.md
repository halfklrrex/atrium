# VF7: thin scrollbars, like monday's (and a clean corner on the full item view)

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: VF "VF: thin scrollbars and full item view corners" · Branch `claude/vf-scrollbars`

## Problem (owner report, 2026-10-26)

On Windows, the full item view's corners look "smushed into the vertical edges". Here's why:

- `.main` and `.side` in `components/item-view/ItemView.module.css` scroll with Windows' classic scrollbar, which is about 17px wide and has arrow buttons.
- `.side` runs flush to the window's right and bottom edges.
- `.window` clips with `overflow: hidden` and `border-radius: var(--border-radius-big)`, so the scrollbar's down arrow is cut by the rounded corner.
- Atrium has **no scrollbar styling anywhere**, so every panel shows the heavy native bar. Headless Linux visual tests don't draw scrollbars, which is why CI never caught it.

## Reference (monday, measured read-only on 2026-10-26)

- monday styles scrollbars **per scroll container**; there's no global rule.
- **Panels, lists and popovers:** `::-webkit-scrollbar { width: 4px; height: 6px }`.
- **Thumb:** `background-color: var(--ui-border-color); border-radius: 4px`.
- **Board table body:** 6px × 6px.
- No track colour, no arrow buttons.

## Changes

1. **Tokens** (in a new `apps/web/src/theme/scrollbar-tokens.css`, imported in `main.tsx` next to the other token files; literals are allowed in `theme/*.css`):
   - `--atrium-scrollbar-size: 4px` (panels, lists, popovers);
   - `--atrium-scrollbar-size-table: 6px` (the board table body and the Kanban scroller);
   - `--atrium-scrollbar-thumb: var(--ui-border-color)`;
   - `--atrium-scrollbar-thumb-hover: var(--icon-color)`;
   - `--atrium-scrollbar-radius: 4px`.
2. **One shared style.** In the same theme file, add a global utility class `.atrium-scroll`, plus a `.atrium-scroll-table` modifier for the 6px size:
   - `::-webkit-scrollbar` sized from the tokens, with a transparent `::-webkit-scrollbar-track`.
   - `::-webkit-scrollbar-thumb` with the thumb colour and radius, and the hover colour on `:hover`.
   - `::-webkit-scrollbar-button { display: none }` and `::-webkit-scrollbar-corner { background: transparent }`.
   - **Firefox fallback:** `@supports not selector(::-webkit-scrollbar) { .atrium-scroll { scrollbar-width: thin; scrollbar-color: var(--atrium-scrollbar-thumb) transparent } }`.
   - Don't set `scrollbar-width` or `scrollbar-color` where WebKit applies. Chromium 121+ ignores the `::-webkit-scrollbar` rules on an element that has those standard properties.
3. **Apply it** to every scroll container in the app's CSS modules. The ones found are listed below; add any others you find. Do it either by adding the class in TSX or with `composes: atrium-scroll from global` in the module. Pick one way and use it everywhere.
   - `columns/popups.module.css` (two places)
   - `components/AppShell/AppShell.module.css`
   - `components/AppShell/NotificationsPanel.module.css`
   - `components/board-filters/board-filters.module.css` (two places)
   - `components/board-kanban/kanban.module.css` (`.scroll` uses the table size; the settings list uses the panel size)
   - `components/board-table/AnchoredPopup.module.css`
   - `components/board-table/table.module.css` (the table scroller uses the table size)
   - `components/item-card/ItemCardDrawer.module.css`
   - `components/item-view/ItemView.module.css` (`.main`, `.side` and the one at line ~313)
   - `components/Sidebar/Sidebar.module.css` (two places)
   - `components/Popover.module.css`
4. **Full item view corner:**
   - On `.side` and `.main`, inset the track's end: `::-webkit-scrollbar-track { margin-block-end: var(--border-radius-big) }`, so the thumb never runs into the rounded bottom corners.
   - Add a scoped rule in the theme file, or a module rule using `:global`, whichever keeps Stylelint happy.
   - Check the scrollbar stays inside the window at the top too; the header's bottom border already separates them.
5. **Dark and black themes:** `--ui-border-color` already adapts. Check the thumb is visible in dark (#797e93 on #181b34 is fine).

## Not in scope

- The window's radius and shadow stay as they are.
- No layout changes, and no animation.
- Mobile overlay scrollbars are untouched; the WebKit pseudo-elements don't affect them.

## Tests and QA

- **Unit test:** a small test that `scrollbar-tokens.css` defines the five tokens. Follow the pattern of any existing theme token test if there is one; otherwise skip it.
- **Checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- **Visual baselines:** headless Linux draws no scrollbars, so the baselines shouldn't change. If CI's visual job fails, report it instead of regenerating.
- **QA on Windows (important, because CI can't see it):**
  - Start the dev server against the emulators with the visual-test seed, or with any seeded board that has an item with many fields.
  - Open the full item view at a height where the Fields pane scrolls.
  - Take Playwright **headed** or Windows Chromium screenshots (not headless Linux) of the bottom-right corner in light and dark, plus one of the board table's scrollbar, and save them under `C:\Users\UsuarioPC\AppData\Local\Temp\claude\D--DevProjects-Atrium-atrium-cl\9bdae3f0-862b-438f-a35a-e4c0a6912a2d\scratchpad\vf7\`.
  - Windows Chromium (headless included) draws classic scrollbars, so a local `pnpm test:visual` win32 "actual" image of the full item view works as evidence too. Never commit `*-win32.png`.

## Privacy

The repo is public: follow `AGENTS.md` → Privacy.
