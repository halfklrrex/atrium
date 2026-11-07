# P5e fix: the automation builder's pickers (value blanks and lists)

Roadmap item: "Recipe builder UI" (reopened). Bug report from the owner, 2026-11-07: "Most of the 'A Value' blue spaces that the user has to select something from don't work correctly and don't allow the user to select anything." Branch `claude/builder-pickers`. Decisions below are the lead's; the owner can change them.

## Cause (found by reading the code; not yet reproduced in a browser)

1. **Value blanks open cell editors under the modal.**
   - `ValueToken` (`apps/web/src/components/automations/ActionLine.tsx`, about lines 60-148) renders the column's own cell editor (`ui.Editor`). The "popover" editors (status, people, date, timeline, dropdown, tags, country, link, long text, location, color, dependency, connect boards, week, world clock) draw through `components/board-table/AnchoredPopup.tsx`.
   - `AnchoredPopup` portals to `document.body` with `z-index: var(--atrium-table-z-popup)`, which `apps/web/src/theme/table-tokens.css` sets to the dropdown tier (70).
   - The Automation center is a Vibe `Modal` (`size="full-view"`) at `--monday-modal-z-index` (80, `apps/web/src/theme/tokens.css` lines ~171-183). 70 is below 80, so the editor paints under the modal and is invisible.
   - The next click lands on the modal, which `AnchoredPopup`'s outside-mousedown handler treats as "outside"; it closes the editor. The user sees nothing happen.
2. **Token lists are clipped.** `SentenceToken`'s list panel (`SentenceToken.tsx`, the `TokenShell` panel, `.panel` in `SentenceToken.module.css`) is `position: absolute` inside the token's own span, inside `.canvas` (`RecipeBuilder.module.css`, `overflow-y: auto`), inside `.builderScroll` (`CenterShell.module.css`), inside the modal's `overflow: hidden`. Lists for the lower sentence lines are cut off.
3. **Empty lists render blank.** `SentenceToken` renders an empty panel when `options` is `[]`; only the multi-choice token shows "No one found".

Ruled out (do not spend time here): the option click vs the outside-click handler (the panel is inside the wrapper), blur commits, `pointer-events`, label shapes, `useWorkspaceMembers()`.

## Fix

### 1. A layer above the modal

- `apps/web/src/theme/tokens.css` (hot-spot file, keep the change to a few lines): add `--atrium-z-modal-popup` between the modal tier and the toast tier (modal 80, toast 90, so for example 85). Name it in the same style as the existing tier tokens and add it to the comment that documents the tiers.
- `apps/web/src/theme/tokens.test.ts` (the layering test around lines 88-116): extend it so it asserts `modal < modal-popup < toast` and that popover and dropdown stay below the modal.
- New small context `PopupLayerContext` (for example `apps/web/src/components/PopupLayer.tsx`) with a hook `usePopupZIndex()` returning `undefined` by default, or the CSS value `var(--atrium-z-modal-popup)` when inside a provider. Provide it in `AutomationCenter.tsx` around the modal's content.
- `components/board-table/AnchoredPopup.tsx` and `components/Popover.tsx`: read the hook and, when it returns a value, set it as an inline `zIndex` style (inline style carrying a CSS variable reference is fine; it is not a literal). Outside the Automation center nothing changes. Check the other portalled layers used by the editors (any date or emoji picker built on Vibe's own `Dialog` already uses Vibe's layer provider and needs nothing).

### 2. Token lists in a portalled, unclipped layer

- Render the list of `SentenceToken`, `SentenceMultiToken` (the shared `TokenShell`) through `AnchoredPopup` anchored on the token button, instead of the inline absolute panel. This gives portal, fixed position, flip-above when there is no room, follow-on-scroll, outside-click and Escape for free.
- Keep: the token button, `aria-haspopup="listbox"`/`aria-expanded`, the `role="listbox"`/`role="option"` markup, keyboard handling (arrows, Enter, Escape, type-ahead if present), focusing the selected or first row on open, the chip/avatar/dot/hint/badge row rendering, multi-select behaviour, `TokenInput` (typed blanks stay inline), and the closing-on-choose behaviour. Clicking inside the portalled list must not count as "outside" for the token's own outside-click handler (the old handler checked `wrapRef.contains`; with a portal use the popup's element as well, or let `AnchoredPopup` own outside handling).
- Remove the now unused `.panel` positioning CSS; keep the row styles. Tokens only: no hard-coded px, colours or font weights (Stylelint enforces).
- Min width: the list is at least as wide as its token and at least the current panel width; max height the current 320px equivalent via an existing token or a new named token in `theme/*.css`.

### 3. Empty and unavailable lists

- When a single-choice token has no options, show one disabled row with a clear message instead of a blank panel. Default text "Nothing to choose from"; callers can pass an `emptyText` (for example "No status column on this board"). Mirror the existing multi-choice "No one found" styling.
- Do not change which options each blank offers.

### 4. Small follow-ups from the 2026-11-07 handoff (only if each stays small)

- After saving a new automation, pass its id as `highlightId` to `RecipesTab` (it already accepts it; nothing passes it today) so the new row is highlighted in Manage.
- Manage table sentence chips via `describeAutomationParts` (see the handoff note). Skip this one if it needs more than a small change, and say so in the PR.

## Tests

- `SentenceToken.test.tsx`: the list renders in `document.body` (portal), not inside the token span; choosing an option calls `onChange` and closes; Escape closes; clicking inside the list does not close it early; an empty `options` shows the empty row; multi-token still toggles values.
- A test rendering the builder **inside `AutomationCenter`** (the real modal): open the "set value" blank on a status column, assert the editor is in the document with the modal-popup z-index, pick a label, assert the action's value is set. Do the same for a condition value list. Use the patterns in `FloatingLayers.test.tsx` for portal assertions. (jsdom has no layout, so assert the inline z-index style and DOM location, not pixels.)
- `AnchoredPopup`/`Popover` outside the provider keep their old z-index (regression test).
- `tokens.test.ts` layering assertions.
- Visual: add one screenshot to `tests/visual/src/screens.spec.ts`: the builder with a value picker open, light and dark. Then run the baselines workflow (`gh workflow run update-visual-baselines.yml -f branch=claude/builder-pickers`, `gh run watch`), review the diffs, push an empty commit afterwards. Never commit `*-win32.png` or `*-darwin.png`.

## Checks (all must pass before the PR)

`pnpm lint`, `pnpm -r --workspace-concurrency=1 typecheck`, `LC_ALL=en_US.UTF-8 pnpm test`, `pnpm build`. Rules tests are not needed (no rules change). Use `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH` only if a rules test is run.

## Out of scope

Redesigning the builder, changing which blanks exist, new trigger/action types, the Manage table layout.

## Owner check (goes in `docs/plans/owner-check-list.md` in the PR)

Showcase board, Automate, Create from scratch, light and dark, after a hard reload: every blue blank opens a visible list or editor and the choice sticks (trigger column and label, condition value, action column, a status / people / date value, a create-item value, a notify person). Save a test recipe switched off, see it highlighted in Manage, delete it.
