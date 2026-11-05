# VF9: update composer fidelity

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: "Feature: item update composer supports the same rich text and shortcuts as the description" · Branch `claude/composer-fidelity`

## Goal

The owner signed off the composer's function (PR #74) and asked for it to look and behave like monday's update editor. References:

- the owner's screenshot (shared in chat on 2026-11-05): a toolbar strip on top, a bottom row of `@`, attach and emoji icons on the left, and a blue split **Update** button on the right;
- `docs/reference/monday/13-update-editor-toolbar.jpg` (the open composer) and `14-update-editor-format-menu.png` (the ¶ menu: Normal text, Quote, Code, Header). Both are in Claude's home copy only.

The collapsed one-line state stays as it is.

## What exists today (checked at `82223ae`)

- `UpdateComposer.tsx`: toolbar on top, TipTap body, footer with a hint and a small primary `Update` button.
- `ComposerToolbar.tsx`: bold, italic, underline, strikethrough, link, bullets, numbers, checklist, colour/highlight, emoji and `@`. It has `role="toolbar"` but **no roving focus**.
- `composer-extensions.ts`: StarterKit with `heading`, `codeBlock` and `horizontalRule` **off**; TaskList, keyed colour and highlight, emoji, mention. No table, font size, alignment or direction.
- `RichText.tsx` renders a post. Its `switch` on `node.type` and its mark list are the only allow-list: anything unknown is dropped. **The server does not check node types.** `updateContentDocSchema` in `packages/shared/src/schemas/update.ts` is a loose object (`type: 'doc'`, at most 500 top-level nodes, 100,000 characters). So **no `packages/shared` or rules change is needed**, and this PR touches no hot-spot file. (The earlier plan said to widen a shared allow-list; there isn't one.)
- The description editor already has: ¶ text-style menu, keyed colour and highlight, font family, `TableKit` (with `TableControls.tsx`), divider, checklist. It has **no** font size, alignment or direction, so those are new.
- Updates cannot hold files. `storage.rules` denies all client access, and uploads go through signed-URL callables scoped to an item (description images, the Files column). There is no callable for updates.

## Target layout (open state)

**Top toolbar**, one row, never wraps, icon-only buttons with tooltips, in this order:
¶ paragraph style · bold · italic · underline · strikethrough · text colour (the existing colour and highlight popup) · font size · numbered list · bullet list · table · link · alignment · divider · text direction · checklist.

Separators: none (monday shows none). Emoji and mention **leave** the top toolbar and move to the bottom row.

**Body**: the editor, `min-height` about 3 lines (token), padding from the editor tokens. The box has the blue focus border it has now.

**Bottom row**, inside the box under the body:

- left: `@` (inserts a mention trigger, as `startMention` does now), emoji (the existing `EmojiPicker`);
- **attach is hidden** (see "Out of scope");
- right: the blue **Update** button as a Vibe `SplitButton`. The main click posts. The chevron menu has one item, **"Post (Ctrl+Enter)"** (Cmd on Mac): it posts too and, unlike a footer hint, shows the shortcut where monday has its menu. This replaces the footer hint text. For a reply the label is "Reply" and the menu item reads "Reply (Ctrl+Enter)".

**Left out on purpose:** monday's AI-writing button (the pen with a sparkle). Atrium has no AI features.

## Changes

1. **Extensions** (`composer-extensions.ts`):
   - turn on `heading` (level 2 only: `heading: { levels: [2] }`), `codeBlock` and `horizontalRule`;
   - add `TableKit` (not resizable; no scroll-wrapper view, reuse `ScrollingTableView` from `item-view/editor-extensions.ts` by exporting it rather than copying);
   - font size, alignment, direction: three small extensions in a new `item-card/composer-marks.ts`, following the keyed pattern in `item-view/editor-marks.ts` (`KeyedTextStyle`, `TextStyleKeys`): values are **keys, never CSS**. `fontSize`: `small` | `large` | `huge` (normal = unset). `align` (a global attribute on paragraph and heading): `left` | `center` | `right`. `dir` (same nodes): `ltr` | `rtl`. No new npm dependency, so no `licenses:notices` run.
2. **Toolbar** (`ComposerToolbar.tsx`): rebuild to the order above.
   - ¶ menu: Normal text, Quote, Code, Header (the `TEXT_STYLES` pattern from `DescriptionToolbar.tsx`; export and share it rather than copy);
   - font size menu: Small, Normal, Large, Huge;
   - alignment menu: left, centre, right; direction: a toggle button, LTR/RTL;
   - table: inserts 3×3 with a header row, as the description does; reuse `TableControls` if it works with any editor (check; otherwise a table has no add-row control and the spec accepts that for now);
   - **roving focus**: Left/Right/Home/End move between buttons, one tab stop, as the ARIA toolbar pattern says;
   - **narrow widths**: the row must not wrap. Reuse `toolsThatFit` from `item-view/toolbar-fit.ts` and put what doesn't fit into a "More" menu, as the description toolbar does.
3. **Composer** (`UpdateComposer.tsx`): the bottom row and split button; drop the footer hint. The `Update` button stays disabled while the doc is empty or a post is in flight.
4. **Rendering** (`RichText.tsx`): add `heading` (level 2), `codeBlock`, `horizontalRule`, `table`/`tableRow`/`tableHeader`/`tableCell`, the `fontSize` key on `textStyle`, and `align`/`dir` on paragraph and heading. Unknown keys render as plain text, as now. Only known keys become class names.
5. **Plain-text mirror** (`update-doc.ts`, `buildUpdateBody`): `content` must be non-empty whenever `contentDoc` is set, or the server refuses the post. Make sure a post that is **only** a table, code block or divider yields non-empty text (table cells joined with spaces and rows with newlines; a lone divider counts as empty). Add tests. Also check `isEmptyDoc` in `item-view/description.ts` treats a lone table as non-empty.
6. **Functions**: `functions/src/lib/notifications.ts` and `activity.ts` read `contentDoc`. Check they don't walk node types in a way a new node breaks; they should only read `mentions` and `content`. No change expected.
7. **Styling**: tokens only. Reuse the VF8 editor tokens in `theme/editor-tokens.css` (button 30px, icon 14px, gap 2px). New values (composer min-height, bottom row padding) are added to the item-card tokens. Headings, code blocks, tables and rules in a post use the same tokens as the description's rendering. Stylelint and ESLint must pass with no new disables.
8. **Showcase**: no change (updates are not seeded rich).

## Tests

- `ComposerToolbar.test.tsx` (new): order of buttons; each button runs its command (use a real TipTap editor); ¶, size and alignment menus; roving focus keys; overflow into More at a narrow width.
- `MentionComposer.test.tsx`: the `@` button now lives in the bottom row.
- `RichText.test.tsx`: each new node and key renders; an unknown size/align/dir key is ignored; a table cell with a `javascript:` link is still dropped.
- `update-doc.test.ts`: the mirror cases from change 5.
- Visual: the `item-card` screens, if any shows the open composer, change on purpose. Run the baselines workflow.

## Out of scope (log as follow-ups on the Roadmap)

- **Attachments in updates.** Needs a callable that issues signed upload URLs scoped to an update, storage layout and cleanup, plus rules for who can attach. The attach icon stays hidden until then. Log "attachments in updates" as an item under P4 or VF.
- The AI-writing button.
- Resizable tables in updates.

## Acceptance

Open composer matches the screenshot's layout in light and dark (Chrome check after deploy). Pressing each toolbar button changes the text, a post made with every feature renders the same in the feed, and the post is accepted by the server. `pnpm lint`, `typecheck`, `test`, `test:rules` and `build` pass.
