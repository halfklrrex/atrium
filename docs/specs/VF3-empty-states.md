# VF3: Empty states and illustrations (our own art)

Author: Opus 5.5 · Implementer: Sonnet 5.5 (high effort) · Roadmap: VF "Empty states & illustrations (our own)" · Branch: `claude/vf3-empty-states` · Worktree `ATRIUM_PORT_OFFSET=20`

## Why

monday's empty screens feel friendly and finished: a soft illustration, a Poppins headline, a short line of help and one clear action. Ours are bare text or improvised. The owner wants monday-level polish, but **all artwork must be original**. Never trace or copy monday's illustrations. Match the _style and layout_, not the drawings.

## References (open with Read)

- `docs/reference/monday/09-my-work-empty.jpg`: a page-level empty state
- `docs/reference/monday/10-notifications-panel-empty.jpg`: a panel-level empty state
- `docs/reference/monday/04-home.jpg` and `05-workspace-page.jpg`
- `docs/reference/monday-ui-reference.md`

The screenshots are gitignored. Read them from `D:\DevProjects\Atrium\atrium-cl\docs\reference\monday\` if your worktree lacks them.

## Measured monday typography

- **Page-level** (My Work):
  - Illustration about 250×120, centred, about 150px below the page header.
  - Title in **Poppins 24px/30px weight 500**, `#323338`, centred, in a column about 435px wide.
  - Body in **Figtree 16px/22px**, `#323338`, centred, about 8px below the title.
  - Link or button in Figtree 16px in the link colour (`#1F76C2`), about 8px below the body.
- **Panel-level** (Notifications):
  - Illustration about 130×130.
  - Title in **Figtree 16px weight 600**, for example "You rock!".
  - One line of body in Figtree 14px.

## Build

1. **`EmptyState` component** (`apps/web/src/components/EmptyState/`):
   - Props: `size: 'page' | 'panel' | 'inline'`, `illustration`, `title`, `body`, and `primaryAction` / `secondaryAction` (button or link).
   - Exact typography and spacing per the measurements above, using tokens.
   - On mount, a fade plus an 8px rise (transform and opacity only, 200ms), disabled under `prefers-reduced-motion`.
   - Unit tests for the component.
2. **Original illustration set** (`apps/web/src/components/illustrations/`), as inline SVG React components:
   - **Style:** a coherent family of flat shapes with soft rounded corners and gentle shadows. Use the Atrium mark's palette (indigo, pink, teal, orange, matching `AtriumLogo`) plus board motifs: rows, status pills, avatars and cards.
   - **Colours** come from CSS variables, so each illustration adapts to light, dark and black. Make sure dark mode looks right; don't just invert.
   - **Size:** keep each under about 6 KB.
   - **The set:**
     - `EmptyMyWork`: stacked task rows with coloured status pills and a gentle check badge
     - `EmptyWorkspace`: refine the current courtyard mark into a fuller scene, such as tiles arranged around an open centre
     - `EmptyRecents`: two or three overlapping board cards
     - `NoSearchResults`: a magnifier over faded rows
     - `AllCaughtUp`: for notifications, a burst of confetti shapes around a check or star
     - `NotFound`: for 404, an open doorway or courtyard arch with a path
     - `NoFavorites`: a small star outline, for the inline use
3. **Wire them in:**
   - **My work page** (`/my-work`): replace the placeholder with an `EmptyMyWork` page state.
     - Title: "This is your home base"
     - Body: "Items assigned to you on any board will show up here."
     - Action: "Learn about My work", which opens a tooltip or popover explaining it. Keep it local; no external link.
     - Also add monday's tab row (Table, Calendar; Calendar disabled) and the toolbar (a disabled "New item" and a Search box), as in `09`, above the empty state.
   - **Home → Recently visited:** when empty, an `inline`/`panel` empty state with `EmptyRecents`, the body "Boards you open will appear here for quick access", and a "Create board" button.
   - **Workspace page:** when empty, a `page` state with `EmptyWorkspace`, the title "This workspace is empty", the existing body copy, and the "Create board" primary action plus "Add folder" as the secondary action.
   - **Sidebar:**
     - No boards in the workspace: an inline muted line "No boards yet" plus a "+ Create board" text button.
     - Favorites empty: `NoFavorites` at a tiny inline size, with "Star a board to find it here".
   - **404 route** (catch-all): a `page` state with `NotFound`, the title "We couldn't find that page", and a "Go to Home" action. Unknown board or workspace ids, and boards the user can't access, should land here too.
   - **Notifications panel:** clicking the bell in the top bar opens a right-side panel (about 480px wide, full height under the top bar, white, with a left shadow), as in `10`.
     - Header: "Notifications" (Poppins 20px weight 500), a settings icon, a "⋯" and a close "✕".
     - Tabs: All, Mentioned, Assigned to me.
     - Search: an input "Search notifications by people, boards, and more…" and an "Unread only" toggle.
     - Body: the panel empty state with `AllCaughtUp`, the title "You're all caught up!", and the body "No new notifications for now. Enjoy the calm."
     - It closes on Esc, outside click or ✕. Slide it in with a transform, and respect reduced motion.
     - It's a UI shell only; real notifications come in P4.
   - **Search no-results:** export `NoSearchResults` for P1b's board search to use later. Use it now in the workspace switcher's search when nothing matches ("No workspaces match").

## Constraints

- Work only in your worktree, on `claude/vf3-empty-states` created from `origin/main`.
- **Don't touch** the board page internals (`BoardPage`, `components/boards/*`) or anything item-card or undo/archive/trash related. Antigravity owns those right now.
- Use tokens only. Add illustration colour tokens to `apps/web/src/theme/tokens.css` in one compact block, because it's a hot-spot file.
- Don't animate layout properties.

## Visual QA gate

1. Run `pnpm dev` (your offset is 20) and sign in with email and password through the SDK.
2. Screenshot My work, Home with no recents, an empty workspace, the 404 page, the notifications panel and an empty sidebar.
3. Do this in **light, dark and black**.
4. Compare against `09`, `10`, `04` and `05` for layout and typography, then iterate.

## Done

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- A PR is open to `main`, with before and after notes in its body. End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, and end the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Don't merge or deploy.
- **Report:** the PR URL, the screens compared per theme, and any remaining gaps.
