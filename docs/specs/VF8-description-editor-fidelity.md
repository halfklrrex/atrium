# VF8: description editor fidelity

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: VF "description editor fidelity (toolbar, / menu, tables, expand) vs monday" (3311830197) · Branch `claude/vf-description-editor`

## Goal

Make the item description editor's toolbar and text match monday's rich-text editor, which is measured in `docs/reference/monday-ui-reference.md`, section "Rich-text editor". Keep every Atrium feature from passes 1 and 2. The owner asked for a richer editor than monday's, so nothing is removed.

## Gaps (Atrium at `3953ddf` vs monday)

| | monday | Atrium today (`DescriptionEditor.module.css`, `DescriptionToolbar.tsx`) |
|---|---|---|
| Rows | one row, never wraps | `flex-wrap: wrap`, two rows at the panel width |
| Button | 30×31, 14px icon, ~2px apart | 32×32, `gap: var(--space-4)` |
| Text style / Font | icon-only ¶ button | text buttons, at least 96px each, with the current name and a chevron |
| Icon colour | primary text | `--secondary-text-color` |
| Under toolbar | no divider | `border-bottom` |
| Body text | 16px/24px, padding 16px 18px | `--atrium-update-body-font` (15px), padding 12px 16px |
| Style menu | 40px rows, each previewing its style | check, and match |

## Changes

1. **Tokens:** add the editor sizes to `apps/web/src/theme/editor-tokens.css` (not `tokens.css`):
   - tool button size 30px; tool icon 14px; tool gap 2px;
   - a doc body font of `400 16px / 24px var(--font-family)` and the body padding `16px 18px`.

   Use those tokens in the CSS module. No raw px in the module (lint enforces this).
2. **Toolbar row:**
   - `flex-wrap: nowrap`, no bottom border, buttons at the new size and gap;
   - icon colour `--primary-text-color`; hover stays `--primary-background-hover-color`; the active state stays as it is.
3. **Text style and Font as icon buttons:**
   - Text style becomes an icon-only button (a paragraph or "Format" icon from `@vibe/icons`; pick the closest, and add a `PROVENANCE` row only if you copy an SVG).
   - Font becomes an icon-only button (a text or "Aa" icon).
   - Both keep their menus, `aria-haspopup`, and `aria-expanded`. Their accessible name and tooltip include the current value ("Text style: Heading 2", "Font: Default").
4. **Overflow into More:** at narrow widths the row must still not wrap.
   - Measure the toolbar with a `ResizeObserver`. Tools that don't fit move, in a fixed priority order, into the existing "More" menu, as menu items with the same label, icon and action.
   - They hide in this order: Expand last, then More (always shown); first to hide are Image, Emoji, Font, Undo, Redo, Link, Text colour, Checklist, Numbered list, Bulleted list, Strikethrough, Underline, Text style, Italic, Bold.
   - Keep the logic in a pure function (`toolsThatFit(widths, available)`) with unit tests. The component only measures and renders.
   - No layout animation.
5. **Body text:** the editor content uses the new body font and padding.
   - The checklist alignment (`--atrium-doc-line-height`, `--atrium-doc-checkbox-size`, fixed in PR #14) must stay aligned at the new line height. Change those tokens if needed, and check them in the visual screens.
   - Read-only description rendering, if it shares these styles, follows the same font.
6. **Style menu:** rows at least 40px tall with 8px padding, each previewing its style (normal, headings, quote, code), like monday's Format menu. Keep our extra entries.

## Not in this PR

- Reordering tools to monday's exact order. Pass 1 already follows it where the tools overlap; leave the order.
- Align and change-direction tools, and a font-size tool (monday has them; we don't yet).
- The "/" menu, tables and expand view. They have no monday counterpart to measure on the free plan.

## Tests and QA

- **Unit tests:** `toolsThatFit` (all fit; some hidden in priority order; nothing fits except More and Expand); the icon buttons' accessible names include the current value; hidden tools appear in More and still run their command.
- **Existing editor tests** (`DescriptionEditor*.test.tsx`) still pass. Update selectors that relied on the visible style or font names.
- **Visual:** regenerate the Linux baselines through the workflow; the description and editor screens change. Check light and dark, the checklist alignment, and that the toolbar is one row in the item view at the 1440px visual viewport.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
