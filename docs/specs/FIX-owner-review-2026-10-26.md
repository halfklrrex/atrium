# Owner review fixes (2026-10-26)

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Branch `claude/owner-review-fixes` · Worktree `ATRIUM_PORT_OFFSET=10`

The owner reviewed the live app and reported these. They're ordered by priority; the first one makes Sort and Filter unusable. Each has a Roadmap item, listed in brackets.

## 1. Sort and Filter dropdown lists open behind their popover and can't be clicked (Critical, 3309194282)

- **Symptom:**
  - In the toolbar's **Sort** popover, opening the "Sort by" column dropdown (a Vibe `Dropdown`) renders its option list _behind_ the popover panel.
  - The options can't be clicked.
  - The same happens in the **Filter** (advanced filter) popover's column, operator and value dropdowns.
  - The Person filter works.
- **Likely cause:** PR #37 introduced one shared layering scale for menus, popovers, panels, drawers and toasts, enforced by lint (see `docs/handoff/2026-10-25-ophelia-reviews-fw2-db1.md` and the layering tokens in `apps/web/src/theme/tokens.css`).
  - Vibe `Dropdown` renders its menu either inline or in a portal (`menuPortalTarget`, react-select underneath), with a z-index below the popover layer.
- **Fix it at the root:**
  - Make every Vibe `Dropdown` used inside a popover (Sort, Filter, and any others: grep `Dropdown` in `components/board-filters`, `board-table`, `columns`) render its menu above the popover layer.
  - Prefer one shared pattern: a portal to `document.body` plus a z-index token on the layering scale (for example `--atrium-layer-popover-menu`), or a shared `PopoverDropdown` wrapper.
  - Also make sure outside-click handling doesn't close the popover when clicking inside the portalled menu. `AnchoredPopup` already treats `[role="listbox"], [role="option"], [data-popup-keep]` as inside, so check whether the toolbar popovers use `AnchoredPopup` or something else.
- **Test:**
  - A unit test that the menu renders in a layer above the popover and that choosing an option updates the sort or filter.
  - Add a regression test to `FloatingLayers.test.tsx`.
  - Add a visual screen if practical (Sort popover with the dropdown open).

## 2. "Add new group" shows nothing until refresh (High, 3309193610)

- **Symptom:** the owner clicked "Add new group" several times and nothing appeared. After a refresh, all the groups were there.
- **Investigate:** `tableActions.addGroup` and the board structure transaction (`updateBoardStructure`), and how `BoardTable` derives `groups` from the board doc.
  - Is the board listener receiving the update?
  - Is a memo keyed on something that doesn't change?
  - Is there an optimistic structure patch that's dropped?
- **Fix:** the new group must appear immediately (optimistically) and scroll into view, with its title in edit mode, as monday does.
- **Test:** a unit test that the new group is rendered right after the action.

## 3. Updates bubble on a row doesn't reflect updates (Medium, 3309201024)

- **What monday does:** once an item has updates, the row's updates bubble turns into a filled blue bubble with the count. Ours stays the empty "+" bubble.
- **Approach:**
  - Use the item's update count. Check whether the item doc has a counter, such as `updatesCount` or a `repliesCount`-like field (the P1c item-card spec mentions `repliesCount`).
  - If there's no item-level counter, add `updatesCount`, maintained by the client in the same batch as posting and deleting an update.
    - Only if the rules allow it: `updatesCount` must be added to the item's allowed update keys, with an integer check. This is a minimal rules change with a rules test.
    - If that isn't clean, **stop and report** instead of inventing a server design.
  - Show the count in the bubble (Vibe `Counter` or monday-style text) and switch the icon to the filled state.

## 4. Group "⋯" handle sits against the sidebar (Low, 3309193137)

- **Symptom:** the group header's "⋯" menu handle is flush with the left edge of the board area, almost touching the sidebar.
- **Fix:** give the board content a left gutter like monday's, so the handle has breathing room. Use a token, and don't shift the table's measured alignment otherwise.

## 5. Item side panel: non-modal, and the row "Open" button becomes an icon (Medium, 3309193592)

- **Non-modal panel:** the item card (`components/item-card/ItemCardDrawer.tsx`, restyled in VF5) must:
  - **not dim** the page (no darkened backdrop);
  - **keep the board interactive**: no invisible click-blocking backdrop, so clicking another row's updates bubble switches the panel to that item;
  - **not cover the top bar** (it starts below it, which VF5 already does; verify).
  - Close it with X or Escape. Clicking empty board space does nothing, as in monday.
  - Accessibility: it's a non-modal `role="dialog"` with `aria-modal="false"` and focus management that doesn't trap.
- **Row button:** the row's "Open" button (`board-table/ItemRow.tsx`) becomes **just the small open icon**, with no text, shown on row hover, with a tooltip "Open item". It keeps opening the side panel for now.
  - The owner wants it to open a future **full item view**, which has its own spec. Leave a clear seam (one `openItemFull()` call site) for that later.

## 6. Polish (Low, 3309194281)

- **Sidebar icons:** the sidebar nav icons (Home, My work, More) are slightly larger than monday's. Match monday's icon size (about 16px; measure ours, and add a token if needed).
- **Home header buttons:** the "Give feedback" and "Quick Search" buttons look worse than monday's.
  - monday uses a light grey secondary button ("Give feedback") and a primary blue button with a search icon ("Quick Search"), both medium size with 4px radius.
  - Match them using Vibe `Button` kinds and sizes.
  - The owner's comparison screenshot is in a local scratchpad folder (monday) and `1.png` (sidebar). These are private, so never copy them into the repo.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` pass.
- **QA in the dev server, light and dark,** signing in with email and password through the SDK:
  - Sort and Filter dropdowns open on top and are clickable.
  - Add group three times; each group appears at once.
  - Post an update, then check the row bubble shows 1.
  - The item panel doesn't dim the page, and clicking another row's bubble switches items.
  - Screenshot each, and report the absolute paths.
- If the visual job's screens change, run the baseline workflow on the branch and list what changed.

## Constraints

- Tokens only.
- Don't change subitem code beyond what a fix strictly needs (subitems just merged in #50).
- Commit per fix, push, and don't open a PR.
