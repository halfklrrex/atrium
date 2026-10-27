# P1: description editor, pass 1

Roadmap item: "Description editor pass 1: styles, shortcuts, / menu, tables, undo, expand" (P1 group).

The owner asked for this in the bug inbox on 2026-10-26: the description "feels very bare bones", and they want something "durable, flexible and robust" like Trello's. On 2026-10-27 they approved every proposed feature, to be built in passes. Pass 2 (colours, emoji, images) and pass 3 (@mentions) are separate items.

Depends on PR #14 (checklist alignment), which changes the same component. Start from `main` after it merges.

## Today

`apps/web/src/components/item-view/DescriptionEditor.tsx` is a TipTap v3 editor:

- extensions: StarterKit, TaskList, TaskItem (nested) and Placeholder;
- one toolbar row: H2, bold, italic, bullets, numbers, checklist, inline code and link;
- it autosaves through `buildDescription` into `item.description = { doc, text }`, which the rules cap (`validDescription`, text up to 10,000 characters; the doc is capped client-side by `ITEM_DESCRIPTION_DOC_MAX_BYTES`).

## Scope

### 1. Toolbar, rebuilt in monday's order

Left to right:

1. **Undo** and **Redo**, disabled when unavailable.
2. **Text style** dropdown: Normal text, Heading 1, Heading 2 and Heading 3, showing the current style's name. Use a Vibe `Menu` in the shared `AnchoredPopup`, following the menu patterns elsewhere in the app.
3. **Bold**, **Italic**, **Underline** and **Strikethrough**.
4. **Bulleted list**, **Numbered list** and **Checklist**.
5. **Link**, which keeps today's popup.
6. A **"More" (⋯) menu**: Quote, Code block, Inline code, Divider, Table, and Clear formatting.
7. **Expand**, which is right-aligned, just before the save hint.

Toolbar details:

- Tooltips include the shortcut, e.g. "Bold (Ctrl+B)"; use ⌘ on macOS.
- The toolbar wraps on narrow widths. It never scrolls horizontally.
- Icons come from `@vibe/icons` where they exist. Otherwise use inline SVGs following the text colour, like today's `NumberedList`.

### 2. Markdown shortcuts as you type

StarterKit already provides most input rules: `#`, `##` and `###` + space for headings, `-` or `*` for bullets, `1.` for numbers, `>` for quote, ``` for a code block, `---` for a divider, and `**bold**`, `*italic*`, `~~strike~~` and `` `code` ``.

- Make sure they're all enabled.
- Add `[ ]` and `[x]` + space for a checklist; TaskItem has an input rule for this, so verify it.
- Add a unit test per shortcut family.

### 3. "/" command menu

- Typing `/` at the start of an empty paragraph, or after a space, opens a filterable menu of blocks at the caret:
  - Text
  - Heading 1, Heading 2 and Heading 3
  - Bulleted list, Numbered list and Checklist
  - Quote, Code block and Divider
  - Table (3×3, with a header row)
- Each entry has an icon, a name and a hint, e.g. "Heading 1 · #".
- Keys: ↑ and ↓ move, Enter or Tab inserts, Esc closes and leaves the `/`, and typing filters. A space with no match closes the menu.
- Inserting removes the `/query` text.
- Build it with `@tiptap/suggestion` (MIT; it's a dependency of the mention extension). Render it in the shared `AnchoredPopup`, or a portal positioned at `clientRect`, with the app's layer tokens. No tippy.js.
- Put it in its own file: `item-view/slash-menu/`.

### 4. Tables

- Use `@tiptap/extension-table` (TableKit in v3, MIT): resizable columns and a header row.
- When the caret is in a table, a small floating table toolbar (or a ⋯ on the cell) offers:
  - add a row above or below;
  - add a column left or right;
  - delete the row, the column or the table;
  - toggle the header row.
- Styling:
  - borders `--layout-border-color`;
  - header cells `--allgrey-background-color` with medium weight;
  - cell padding `--space-8`;
  - a horizontal scroll inside the editor when the table is wider than the editor. Use the thin scrollbars: `composes: atrium-scroll from global`.

### 5. Underline, strikethrough and clear formatting

- StarterKit v3 includes Underline. Enable it explicitly if needed.
- Clear formatting runs `unsetAllMarks().clearNodes()`.

### 6. Expand mode

- The Expand button opens the same editor in a large centred dialog: about 900px wide (a token) and 80vh tall. Use a Vibe `Modal`, or the app's existing dialog pattern.
- It's the same document. Either move the editor instance into the dialog with a portal, or mount a second editor on the current doc and save through the same `onSave`. Edits must never fork. The simplest robust option is one editor instance re-parented with a portal; justify the choice in the PR if you pick another.
- Esc or the close button returns to the inline view. The save state carries over.

### 7. Robustness

- **Paste.** Pasting HTML from Word, Google Docs or the web keeps headings, lists, bold, italic, links and tables, and drops everything else: TipTap's schema does this when the extensions exist. Pasting a bare URL over selected text makes it a link.
- **Size limit.** Tables make docs bigger. Keep the existing size check. When a doc goes over the limit, the toast must not lose the user's typing: today it only refuses to save, so check that the editor keeps the content and retries on the next edit.
- **Search text.** `docToText` adds `tableCell` and `tableHeader` to `BLOCKS`, and dividers add nothing.
- **Read-only rendering.** Viewers and the Kanban card / board previews of descriptions (if any) must render every new node. Grep for other description renderers.
- **Saved data.** Older docs stay valid. No migration is needed: new node types only appear in docs written after this lands. No rules change; `validDescription` doesn't inspect node types.

## Visual fidelity

The lead captures monday's item description editor read-only in light and dark: toolbar height, icon size and spacing, dropdown, slash menu, table and expand view. The measurements go into `docs/reference/monday-ui-reference.md` before implementation starts, with an addendum in this spec. Until then use these defaults:

- toolbar buttons 32×32 with 4px gaps (as today);
- `--atrium-update-body-font` for the body;
- the doc heading tokens `--atrium-doc-h1/2/3-font` (already present).

Tokens only.

## Dependencies

- Add `@tiptap/extension-table` (or `@tiptap/extension-table`'s TableKit) and `@tiptap/suggestion`, at the same major and minor version as the existing TipTap packages.
- Run `pnpm licenses:notices` and commit `THIRD_PARTY_NOTICES.md`. Both are MIT.

## Tests

- **Unit** (`DescriptionEditor.test.tsx`):
  - the toolbar applies each mark and block;
  - undo and redo are disabled when unavailable;
  - the text-style dropdown sets H1–H3 and Normal;
  - the "/" menu opens, filters, inserts a heading and a table, and Esc closes it;
  - the markdown shortcuts work;
  - `docToText` includes table text;
  - read-only mode renders a table and a divider.
- **Visual:**
  - extend the full item view seed with an H1, a table and a divider;
  - add a screen for the slash menu open and one for expand mode, in light and dark;
  - the lead refreshes the baselines.

## Out of scope (passes 2 and 3)

Text and highlight colours, emoji, images, @mentions, comments on text, and collaborative cursors.
