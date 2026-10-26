# P1: Full item view (floating window)

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: P1 "Full item view (floating window with description and all fields)" (3309192962) · Branch `claude/item-full-view`

## Why

Owner request (2026-10-26). There are two ways into an item:

- **The updates bubble** on a row keeps opening the **side panel** (monday's item card: updates and activity, non-modal; see `FIX-owner-review-2026-10-26.md` §5).
- **The row's open icon** (or Enter on a selected row) opens a **floating window** where you can see and edit _everything_ about the item, the way ClickUp's and Trello's task views work: a rich description, every column, subitems and the updates thread.

## Layout

- **The window:**
  - A centred floating window, about `min(1100px, 92vw)` wide and `min(86vh, 900px)` tall, with a 12px radius (`--border-radius-big`) and a large shadow.
  - A light scrim **is** acceptable here: it's a deliberate focus mode, unlike the side panel. Use a token for it that's lighter than the old one.
  - It closes on Escape, the X button, or a click on the scrim.
  - The URL becomes `/boards/:boardId/items/:itemId`, so the view can be linked and survives a refresh. Back closes it.
- **Header:**
  - A breadcrumb (workspace › board › group, with the group colour dot) and prev/next arrows to step through the group's visible rows.
  - The item name: Poppins, the same token as the VF5 item-card title, inline-editable.
  - A `⋯` menu: archive, delete, duplicate and copy link. These reuse `tableActions` and the cascade from #50.
- **Body, in two columns:**
  - **Left (about 62%):**
    1. **Description:** a rich-text editor with headings, bold, italic, lists, checklists, links and code. It shows a placeholder when empty and autosaves, debounced by about 800ms, with a "Saved" hint.
    2. **Subitems:** a compact list with each subitem's name and its subitem columns, plus "+ Add subitem". Reuse the subitem cells from #50 where possible.
    3. **Updates:** the same `UpdatesFeed` component as the side panel. Don't fork it.
  - **Right (about 38%), the Fields panel:**
    - every board column as a label/value row (the column icon and title, then the cell);
    - edited with the **same** column UIs and editors as the table (`getColumnUi(type).Cell` and `Editor`, through `tableActions.setCell` and `validateCellWrite`);
    - derived, server-managed and (later) locked columns are read-only, as in the table;
    - column order and visibility follow the board.
- **Mobile, below 768px:** full screen, with the columns stacked as Fields, Description, Subitems, Updates.

## Data

- **New item field:** `description`, an object `{ doc: <ProseMirror JSON>, text: string }`.
  - `text` is the plain-text extraction for search (future global search), capped at 10,000 characters.
  - `doc` is capped at about 200 KB serialised, validated client-side with a friendly error.
  - Add it to `itemSchema` as optional and nullable.
- **Rules:**
  - Add `description` to the item's allowed create and update keys.
  - The value must be `null` or a map with exactly the keys `doc` and `text`, where `text` is a string of at most 10,000 characters.
  - Add rules tests.
  - This is a hot-spot file, so keep the diff small. Coordinate with Ava's column-locks PR: whoever lands second rebases.
- **Writes:** one field-path write, `description` plus audit fields. Don't rewrite the whole doc.
- **Editor library:** TipTap (`@tiptap/react` and `starter-kit`, MIT), the same library the P7 Docs editor will use.
  - Run `pnpm licenses:notices` and commit `THIRD_PARTY_NOTICES.md`.
  - Lazy-load the editor chunk, so the board bundle doesn't grow.

## Routing and state

- **Store:** an `item-view-store` (or extend `item-card-store`) with `openItemFull(boardId, itemId)`.
  - The row's open icon and Enter call it; that seam is left by the owner-review fixes.
  - It navigates to the item URL.
- **Board page:** renders the board underneath and the window on top when the route has `:itemId`.
- **Panel and window:** the side panel and the full view never show at the same time. Opening one closes the other.

## Tests and QA

- **Unit tests:**
  - field rows use the table's column UIs;
  - read-only columns don't open editors;
  - the description autosave debounce;
  - the route opens and closes the window;
  - prev/next.
- **Rules tests** for `description`.
- **Visual QA** in light and dark:
  - an item with a long description, 3 subitems and updates;
  - mobile width.
  - Add a visual screen for the window on the showcase data.
- **Showcase:** give 3 showcase items a realistic description.

## Out of scope

Real-time collaborative editing of the description (Yjs, in P7), @mentions in the description, attachments in the description, and custom field layouts.
