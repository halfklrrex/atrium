# SIDEBAR-overview-tab: an Overview tab and a key bar for the item side panel

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: "Item side panel: Overview tab" (new item in the VF group; Opus creates it) · Builds on: `docs/specs/P1c-item-card-updates.md`, `docs/specs/P1-full-item-view.md`, `docs/specs/VF5-item-card-updates-fidelity.md`, `docs/specs/P4-update-attachments.md` · Design: the approved preview "Item side panel: Overview tab" (option A with parts of B and C; the file is a local scratch preview, not in the repo) · Owner decision: 2026-11-10 (below) · Status: spec, nothing built

## Goal

The side panel (`ItemCardDrawer`) opens on Updates and shows nothing else about the item: no fields, no description, no subitems. To see the status or the due date you either close it or open the full item. Give the panel an **Overview** tab that opens first, with the description, the item's fields in a compact grid, a subitems row and the latest update, and put a slim **key bar** (status, owner, due date, priority) under the title on every tab. The full item view stays the place for everything at once; the panel becomes a place to work on one item without leaving the board.

## Owner decision (2026-11-10, final)

1. **Overview is the default first tab.** Tabs, in order: **Overview**, **Updates / n**, **Files**, **Activity Log**. No "NEW" badge.
2. **From option B:** the key bar under the title, the only strip that stays visible on every tab.
3. **From option A:** the Overview body (description first, a 2-column fields grid, a subitems row) and a footer with **Copy link** and **Open full item**, on Overview only.
4. **From option C:** the latest-update teaser and a non-sticky "Write an update…" line at the end of Overview, and the single-column field list when the panel is narrow (below 420 px).
5. **Dropped:** C's sticky action row, a Subscribe button, a primary-blue "Full item" button, section-header icon buttons, and a "Customise" link on the fields label.
6. **Later, not in this spec:** item subscriptions, and a per-board "Pin to side panel" column setting that overrides the key-bar rule.

## Decisions this spec makes (the owner can overrule them)

- **The updates bubble still opens Updates.** The row's speech bubble and the Kanban card's updates button are labelled "Updates for …"; landing on Overview would contradict the label. Every other way in (the row name, the row menu's "Open item", Kanban card click, the Activity log panel, the Automation Center) opens Overview.
- **The tab stays when you step to the previous or next item** (as in monday). A fresh open uses the opener's tab.
- **No Files tab until PR 3 builds it.** The tab doesn't exist in the code today (see Facts). PRs 1 and 2 ship Overview, Updates and Activity Log; PR 3 adds Files. No placeholder tab in between (the owner's no-placeholder rule from Settings applies).

## Facts this design rests on (checked against `origin/main` at `80060bc`)

- **The panel:** `components/item-card/ItemCardDrawer.tsx`, mounted once in `AppShell.tsx`. A non-modal `<aside role="dialog" aria-label="Item card">` in a fixed dock under the top bar, `inline-size: var(--atrium-item-card-width)` (`clamp(480px, 36vw, 720px)` in `tokens.css`), `max-width: 100%`. It has a header (close, previous/next when `itemIds.length > 1`, the `InlineEdit` title, the creator's `UserAvatar`, an "Item actions" menu with two "coming soon" entries), a Vibe `TabList` with **Updates** (`Updates / n` when there are updates) and **Activity Log** (indexes `0` and `1`), and a scrolling `contentArea`. No breadcrumb, no "Open full item" button, no fields.
- **Data in the panel:** `useItem` (one item doc), `useItemUpdates` (newest first), `useBoard`, `useItemActivity` (only while its tab shows). No workspace, role or items listener, so it has no `TableCtx` and cannot render `ItemCell`.
- **Store:** `item-card-store.ts` (`activeBoardId`, `activeItemId`, `itemIds`, `open`, `openItemCard`, `closeItemCard`, `setActiveItemId`, `setItemIds`). No tab in the store.
- **Openers:** `board-table/open-item.ts` has `openItem(boardId, itemId)` (the panel; it closes an open full view first) and `openItemFull(boardId, itemId)` (navigates to `itemViewPath`, state `FROM_BOARD_STATE`; without a router it falls back to the panel). Callers of `openItem`: `ItemRow.tsx` (row name click, the updates bubble, the row menu's "Open item"), `KanbanCard.tsx` (the card's updates button, and the card itself), `BoardActivityPanel.tsx`, `AutomationCenter.tsx`.
- **Full item view:** `components/item-view/ItemView.tsx` builds a `TableCtx` inline (without `board` and `boardRole`; `BoardTable.tsx` resolves the role with `resolveBoardRole` and `canEditBoard`), counts empty required columns inline (`validateRequiredColumns` over fillable columns), and has `copyLink()` inline (`window.location.origin + itemViewPath(board, itemId)`, toasts "Link copied." / "Could not copy the link."). It reads router state `{ fromBoard, updateId, replyId }`; nothing scrolls to the subitems.
- **Fields:** `FieldsPanel.tsx` renders every `ColumnView` (from `buildColumnViews`, board order) as a `<dl aria-label="Fields">` of label-left, value-right rows, with the column icon (`getColumnUi(type).icon`) and a red `*` for required columns. Styles in `ItemView.module.css` (`.fields`, `.field`, `.fieldLabel`, `.fieldValue`).
- **`ItemCell.tsx`:** the table's own `Cell`/`Editor` for a column, written through `tableActions.setCell`; derived, server-managed, locked and migrating columns are read-only; an empty required cell shows the `REQUIRED_HINT` ("Required") overlay (`isRequiredEmpty` in `board-table/required.ts`, built on `isColumnValueEmpty` from `@atrium/shared`). It accepts a `className`.
- **Subitems:** `ItemSubitems.tsx` (full view only) filters `items` by `parentItemId`. "Done" is `isRowDone(item, columns)` in `board-table/table-env.ts` (the first status column's label has `isDone`).
- **Description:** `DescriptionEditor.tsx` (lazy, TipTap) always renders `DescriptionToolbar` when editable, has an Expand-to-dialog mode, autosaves, and shows the placeholder "Add a description...". Body line height is `--atrium-editor-line-height` (24 px, `editor-tokens.css`).
- **Updates:** `UpdatesFeed.tsx` renders the composer (`LazyUpdateComposer`, placeholder "Write an update and mention others with @") and the cards inline. Props: `boardId`, `itemId`, `focusUpdateId`, `focusReplyId`, `canManage`. `UpdateComposerProps` has `autoFocus`. Posts carry `content`, `contentDoc`, `mentions`, `likes`, `repliesCount`, `attachments` (server-managed, `FileAttachment[]`).
- **Files today:** there is **no Files tab**. Files live in two places: `files` column values (`filesValueSchema`: `{ files: FileAttachment[] }`, cell UI in `columns/files.tsx`, downloads through `fileCalls`) and update or reply attachments (`UpdateAttachments.tsx`, downloads through `updateAttachmentCalls`).
- **Column type ids** used below: `status`, `people`, `date`, `timeline`, `dropdown`, `link`, `long_text`, `files`.
- **Visual tests:** desktop `board: item card Activity Log tab` (`item-card-activity-{theme}`) opens the panel through the updates bubble of "Firebase project and emulators" on the seeded "Product roadmap" board, whose columns are Area (dropdown), Scope (long text), Spec / PR (link), Status, Priority (status), Date, Person, Budget. `FULL_VIEW_ITEM` (`roadmap-item-17`, "Ship the pipeline") has a long description, three subitems and an update. No phone screen opens the panel.
- **No viewport hook** in the web app yet (Settings PR 3 adds one). This spec doesn't need it: the narrow layout is a CSS container query on the panel.

## Scope

- The panel's chrome: a breadcrumb line, an "Open full item" icon in the header, the key bar, the new tab order, the tab stored per open.
- The Overview tab: description, fields grid with the cap, subitems row, latest-update teaser and "Write an update…" line, footer.
- The narrow layout (panel below 420 px wide).
- The Files tab (PR 3).
- Small shared extractions so nothing is copied: the item `TableCtx` hook, the required count, the copy-link helper, `FieldsPanel`'s grid layout, `ItemCell`'s empty hint.
- Tokens in a new `apps/web/src/theme/item-panel-tokens.css`; unit tests; visual specs and baselines.

## Non-goals

- Item subscriptions and any Subscribe control (owner decision 6).
- The per-board "Pin to side panel" setting (owner decision 6). The key-bar rule is code only.
- Changing the full item view's layout. It only gains the shared helpers and the "open at subitems" scroll.
- The "Item actions" menu (its "coming soon" entries stay as they are).
- Opening the panel for a subitem (`ItemRow`'s TODO stays).
- Reply attachments in the Files tab (one listener per update; later).
- Schema, rules, Functions or `packages/shared` changes.

## Design

### Panel structure (every tab)

```
| [x] [<] [>]  Ship the pipeline            (AQ) [open] [...] |  header
|      ● P1 · Core boards · Product roadmap                    |  crumb
| STATUS        PERSON        DATE          PRIORITY           |  key bar
| [Working on]  (JR)(MK)      Nov 14        [High]             |
| Overview | Updates / 4 | Files | Activity Log                |  tabs
|--------------------------------------------------------------|
|  (the active tab's content; the only part that scrolls)      |
|--------------------------------------------------------------|
| [link] Copy link                         [open] Open full item|  footer, Overview only
```

- **Order of the column flex:** header, crumb, key bar, tabs, content (`flex: 1`, the existing `contentArea` scroll), footer. Only the content scrolls.
- **Header:** as today, plus an **Open full item** `IconButton` (`Open` icon from `@vibe/icons`, the same icon as the row menu's "Open item"; `aria-label="Open full item"`, tooltip "Open full item", `kind="tertiary"`, small) between the creator avatar and the "Item actions" menu. It calls `openItemFull(boardId, itemId)`.
- **Crumb** (new, under the header): the group's colour dot, the group title, " · ", the board name. `--atrium-item-panel-crumb-font`, `--secondary-text-color`, padding-inline aligned with the title's start. The dot reuses ItemView's `--group-color` pattern (`style={{ '--group-color': group.color }}`). It's a `<p>`, not a `nav`: nothing in it is a link.
- **Key bar:** see below. Rendered on every tab once the item and the board have loaded; nothing while loading.
- **Tabs:** Overview, Updates (`Updates / n` as today, with the `Update` icon), Files (PR 3), Activity Log. Overview has no icon and no badge.
- **Footer** (Overview only): `border-block-start` with `--layout-border-color`, padding `var(--space-8) var(--space-16)`, background `--primary-background-color`, `flex: none`. Left: a tertiary small `Button` "Copy link" (`Link` icon). Right: a secondary `Button` "Open full item" (`Open` icon), not primary (owner decision 5). Copy link uses the shared `copyItemLink` helper (same URL and toasts as the full view's menu).

### The key bar

A `<dl aria-label="Key information">` of up to four cells, padding `var(--space-8) var(--space-16)`, `display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--space-8)`, so three, two or one slots share the width equally. Each slot is a `div role="group"` with:

- `<dt>`: the **column's own title** (not a fixed word), `--atrium-item-panel-key-label-font`, `--secondary-text-color`, `text-transform: uppercase`, `letter-spacing: var(--atrium-item-panel-key-label-tracking)`, one line with an ellipsis and `title` set to the full title.
- `<dd>`: a live `ItemCell` (same props as `FieldsPanel` passes) with `className` for the compact cell (`block-size: var(--atrium-item-panel-key-cell-height)`). Clicking the status opens the status picker, exactly as in the table.

**Slot rule** (pure function `selectKeyBarColumns`, see Pure functions):

| Slot         | Takes                               | If the board has none                                     |
| ------------ | ----------------------------------- | --------------------------------------------------------- |
| 1 · Status   | first `status` column (board order) | slot dropped                                              |
| 2 · Owner    | first `people` column               | slot dropped                                              |
| 3 · Due      | first `date` column                 | first `timeline` (its cell shows the range); else dropped |
| 4 · Priority | second `status` column              | first `dropdown`; else dropped                            |

- Slots keep this order whatever the columns' positions on the board, so Status is always first.
- A dropped slot leaves no gap: the bar shrinks to 3, 2 or 1 equal cells. **With no match the bar is not rendered at all**, and the grid starts with every field.
- A column is used once at most (the priority slot never reuses the status slot's column).
- **Fields in the key bar are never repeated in the grid.**

**Empty values** (new optional `emptyHint` prop on `ItemCell`, used only by the key bar): when the cell is editable and its value is empty (`isColumnValueEmpty`) and no editor is open, it shows the hint in the same overlay position as `REQUIRED_HINT`:

| Type       | Hint         |
| ---------- | ------------ |
| `status`   | "Set status" |
| `people`   | "Assign"     |
| `date`     | "Set date"   |
| `timeline` | "Set dates"  |
| `dropdown` | "Choose"     |

- The hint is `--placeholder-color`, `--font-text2-normal`. When the column is also **required**, the `emptyHint` replaces "Required" and the cell is marked required-empty (below), so the hint shows in `--negative-color`.
- Read-only cells (viewers, locked, derived) show no hint, only the empty cell.
- `ItemCell` sets `data-required-empty="true"` on its root when `isRequiredEmpty(def, raw)` and the cell is editable. The panel's module styles that attribute: a dashed `var(--border-width)` border in `--negative-color` and the hint text in `--negative-color`. The full view and the table don't style the attribute, so they look the same as today.

### Overview tab

A flex column, padding `var(--space-16)`, gap `var(--space-16)`. Blocks in this order; each block's label is a `h3` (`--font-text2-bold`, `--secondary-text-color`) in a row with an optional right-hand part.

#### 1. Description

- Label "Description". Body: the lazy `DescriptionEditor` with the same props as the full view (`key={item.id}`, `initial`, `readOnly={!canEdit}`, `onSave` through `itemWrites.setDescription`). Suspense fallback: an empty box of `min-block-size: var(--atrium-item-panel-desc-fallback-height)` so the fields don't jump.
- **Toolbar on focus only.** New optional prop `toolbar?: 'always' | 'focus'` on `DescriptionEditor` (default `'always'`, so the full view is unchanged). With `'focus'` the root gets `data-toolbar="focus"`, and the module hides `.toolbar` while the root has no `:focus-within` **and** no popover of its own is open (emoji picker, link popup, slash or mention menu: set `data-popover-open` on the root while any is open). The Expand-to-dialog button stays in the toolbar and works as today.
- **Length rule** (pure function `descriptionMode`): measure the `.ProseMirror` element's height with a `ResizeObserver` (`lineHeight` from its computed style).
  - Up to **12 lines** (`DESCRIPTION_FULL_LINES`): shown in full.
  - Longer: **clamped at 8 lines** (`DESCRIPTION_CLAMP_LINES`): the content host gets `max-block-size: calc(var(--atrium-item-panel-desc-clamp-lines) * var(--atrium-editor-line-height))` and `overflow: hidden`, and a tertiary small button **"Show more"** sits under the box. Pressed, the box shows in full and the button reads **"Show less"**. No fade (a gradient would need colour literals).
  - Focusing the editor (click, Tab) lifts the clamp while focus is inside (`:focus-within`) so nobody edits blind. It doesn't change the "Show more" state.
  - The clamp state resets when the item changes.
- **Empty description:** the editor's own "Add a description..." placeholder in a box of one line (`min-block-size` from the editor's own tokens; don't add height), so the fields move up.

#### 2. Fields

- Label row: "Fields" on the left; on the right, when the item has empty required fields, "1 required empty" / "N required empty" (`--font-text2-normal`, `--negative-color`). The count is the shared `countMissingRequired(board.columns, item.values)` (fillable columns only, the same number the full view shows), **including** key-bar columns: it's about the item, not the grid.
- Body: `FieldsPanel` with the new `layout="grid"` and the grid's columns (`partitionGridFields`, below). Board order, key-bar columns left out.
- **Grid layout** (`layout="grid"`, styles next to `.fields` in `ItemView.module.css`): `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)`, gap `var(--space-4) var(--space-12)`. Each field is a cell with the label **above** the value (`flex-direction: column`, gap `var(--space-4)`), padding `var(--space-4) var(--space-8)`, `--border-radius-medium`, hover background `--primary-background-hover-color`. The label keeps the icon, the title and the red `*`, in `--atrium-meta-font`.
- **Wide types** take the full row (`grid-column: 1 / -1`, `data-wide="true"` on the field): `long_text`, `link`, `files` (`WIDE_FIELD_TYPES`). Values that are status-like pills keep their content width, not the full cell (`justify-self: start` on the value, `max-inline-size: 100%`), so pills sit like the plain values next to them.
- **Cap:** the first **10** grid fields (`GRID_FIELD_CAP`) show; when the grid has more, a tertiary small button **"Show all fields (N)"** (N = all grid fields, key-bar ones not counted; `NavigationChevronDown` icon) follows. Pressed, every field shows and the button reads **"Show fewer"** (`NavigationChevronUp`). The state resets when the item changes. The button has `aria-expanded` and `aria-controls` pointing at the `<dl>` (`FieldsPanel` takes an optional `id`).
- When the grid has **no** fields (every column is in the key bar), the Fields block is not rendered. When the board has **no columns at all**, the block shows `FieldsPanel`'s existing "This board has no columns yet."

#### 3. Subitems row

- One full-width `<button>` (no label above it): `Subitems` icon (`@vibe/icons` `Subitems`, or the closest Vibe icon; `aria-hidden`), the text **"Subitems"** and, muted, **"2 of 5 done"**, then a thin progress bar and a `NavigationChevronRight` icon. Border `var(--border-width)` `--layout-border-color`, `--border-radius-medium`, padding `var(--space-8) var(--space-12)`, hover `--primary-background-hover-color`.
- Counts from `subitemSummary(items, parentId, subitemColumns)`: total, and done by `isRowDone` against the subitem columns. Without a status column among the subitem columns: "5 subitems" and no bar. With no subitems: "Subitems" and muted "None yet", shown only to people who can edit (they can add them in the full view); hidden for viewers.
- The bar: `block-size: var(--atrium-item-panel-progress-height)`, `inline-size: var(--atrium-item-panel-progress-width)`, track `--ui-background-color`, fill `--positive-color`, the fill's width as `transform: scaleX(done / total)` with `transform-origin: left` (no animated layout property). `aria-hidden`: the text says the same.
- Accessible name: "Subitems, 2 of 5 done. Open in the full item".
- **Click:** `openItemFull(boardId, itemId, { section: 'subitems' })`. `openItemFull` gains an optional third argument and passes `section` in the router state next to `fromBoard`. `ItemView` reads `section === 'subitems'` and, once the item has loaded, scrolls its Subitems section into view (`block: 'start'`, `behavior: 'smooth'`, or `'auto'` under `prefers-reduced-motion`) once per open, like `UpdatesFeed`'s focus effect. Give the section `id="item-view-subitems"`.

#### 4. Latest update and "Write an update…"

- Label row: **"Latest update"** on the left and a tertiary link-style button **"All N updates"** on the right (it switches to Updates). With **no** updates the label reads "Updates" and there is no teaser and no link.
- **Teaser** (the newest top-level update, `updates[0]`): a `<button>` card (border `var(--border-width)` `--ui-border-color`, `--border-radius-medium`, padding `var(--space-12) var(--space-16)`, hover `--primary-background-hover-color`). Inside: the author's `UserAvatar` (small), the name (`authorLabel`, bold) and `formatRelativeShort(createdAt)`; the text as plain text (`update.content`, mentions shown as `@name` text, not `MentionedText`, so the button has no interactive children), clamped to **2 lines** (`-webkit-line-clamp: 2`); a meta line with the like count (Vibe `ThumbsUp` icon plus the number, only when above 0) and "1 reply" / "N replies" (only when above 0). Accessible name: "Latest update from <name>, <time>. Open in Updates". Clicking opens the Updates tab with that update focused (`focusUpdateId`, so `UpdatesFeed` scrolls it into view and marks it).
- **"Write an update…" line:** a `<button>` under the teaser (or under the label when there are none), not sticky: `block-size: var(--atrium-item-panel-composer-stub-height)`, border `var(--border-width)` `--layout-border-color`, `--border-radius-medium`, padding-inline `var(--space-12)`, the signed-in user's `UserAvatar` (small) and "Write an update…" in `--placeholder-color`. Accessible name "Write an update". Click: switch to Updates with the composer focused (below). Hidden without a signed-in user (as the composer is).

### Updates tab

- Today's `UpdatesFeed`, plus two props:
  - `autoFocusComposer?: boolean`, passed to `LazyUpdateComposer` as `autoFocus`.
  - `canManage` now passed (`boardRole === 'owner'`, as the full view does) since the panel knows the role.
- The panel holds a one-shot flag: "Write an update…" sets it and switches tab; the feed mounts with `autoFocusComposer`; the flag clears on the next tab change, so returning to Updates later doesn't steal focus.
- The teaser passes `focusUpdateId` the same one-shot way.
- No footer. The header's "Open full item" icon covers it.

### Files tab (PR 3)

- **What it shows:** every file on the item, in two sections, each with a `h3` label:
  1. **"In columns"**: one block per `files` column of the board (board order), the column title as a small label and its live `ItemCell` (the files cell: upload, download, remove, all as in the table). Shown only when the board has a `files` column.
  2. **"In updates"**: for each top-level update with attachments (newest first), a line with the author and the relative time, then `UpdateAttachments` with the update's target and the same `canRemove` rule as `UpdatesFeed`. Data from the `useItemUpdates` the panel already holds; no new listener. Reply attachments are a non-goal.
- **Empty state** (no files column and no attachments, or all empty): "No files yet" (`--font-text1-bold`) and "Files added to this item's file columns or to its updates show up here." (`--secondary-text-color`).
- The tab label is plain "Files" (no count).
- Extract the `canRemove` rule from `UpdatesFeed` into a small exported function in `update-attachments.ts` so the feed and the tab share it.

### Activity Log tab

Unchanged (`ActivityFeed`, listened to only while it shows).

### Narrow panel (below 420 px)

The panel declares `container: item-panel / inline-size` on `.drawer`. Under `@container item-panel (width < 420px)` (a comment says the number is the design's breakpoint; container conditions can't use custom properties):

- **Key bar:** `grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr))`, so four slots wrap to 2 × 2 (three: 2 + 1).
- **Fields:** the grid becomes `FieldsPanel`'s ordinary rows (label left, value right) by resetting the `layout="grid"` rules; the label column is `var(--atrium-item-panel-narrow-label-width)`. Wide types keep label-above, full row. The cap and "Show all fields (N)" work the same.
- **Header:** previous/next and the creator avatar are hidden; the title uses `--atrium-item-panel-title-font-narrow`.
- **Tabs:** the Updates tab hides its icon; "Activity Log" shows as "Activity" (render the label as `Activity<span className={styles.tabLabelTail}> Log</span>` and hide the tail; the accessible name follows what's visible). Tab padding `var(--space-8)`.
- **Footer:** both buttons small. The description is unchanged.
- The dock already makes the panel full width on a phone (`max-width: 100%`), so at 360 or 390 px wide the narrow layout applies.

## Pure functions (unit-tested)

New file `apps/web/src/components/item-card/item-panel-layout.ts`:

```ts
export type KeySlot = 'status' | 'owner' | 'due' | 'priority';
export const GRID_FIELD_CAP = 10;
export const DESCRIPTION_FULL_LINES = 12;
export const DESCRIPTION_CLAMP_LINES = 8; // must match --atrium-item-panel-desc-clamp-lines
export const WIDE_FIELD_TYPES: ReadonlySet<string>; // long_text, link, files

/** The key bar's columns by the slot rule, in slot order; dropped slots are left out. */
export function selectKeyBarColumns(
  columns: readonly ColumnView[],
): { slot: KeySlot; column: ColumnView }[];

/** The grid's fields: board order, key-bar columns removed, capped unless expanded. */
export function partitionGridFields(
  columns: readonly ColumnView[],
  keyBarIds: ReadonlySet<string>,
  options: { expanded: boolean; cap?: number },
): { visible: ColumnView[]; total: number; hasMore: boolean };

export const isWideFieldType = (type: string): boolean => WIDE_FIELD_TYPES.has(type);

/** Key-bar empty hint per type, or undefined for types the bar never holds. */
export function keyBarEmptyHint(type: string): string | undefined;

/** 'full' up to DESCRIPTION_FULL_LINES lines, else 'clamped'. A lineHeight of 0 is 'full'. */
export function descriptionMode(contentHeight: number, lineHeight: number): 'full' | 'clamped';

/** Total subitems of the parent and how many are done (null `done` without a status column). */
export function subitemSummary(
  items: readonly ItemDoc[],
  parentId: string,
  subitemColumns: readonly ColumnView[],
): { total: number; done: number | null };
```

Shared extractions (no copies):

- `components/item-view/use-item-ctx.ts`: `useItemTableCtx({ board, uid, items, boardRole })` returns the `TableCtx` and the `subCtx` exactly as `ItemView` builds them today (refs for `getItems`/`getGroups`), **plus** `board` and `boardRole`, set the way `BoardTable.tsx` sets them (read it and follow it; don't invent). `ItemView` and the panel both use it.
- `components/board-table/required.ts`: `countMissingRequired(columns, values)` (the fillable filter plus `validateRequiredColumns`); `ItemView`'s inline `useMemo` calls it.
- `components/item-view/item-link.ts`: `copyItemLink(board, itemId)` with the same URL and toasts; `ItemView`'s menu and the panel's footer call it.
- `board-table/open-item.ts`: `openItem(boardId, itemId, options?: { tab?: ItemPanelTab })` and `openItemFull(boardId, itemId, options?: { section?: 'subitems' })`.
- `item-card-store.ts`: `type ItemPanelTab = 'overview' | 'updates' | 'files' | 'activity'`; state `tab` (default `'overview'`); `open(boardId, itemId, itemIds?, tab = 'overview')` sets it; `setTab(tab)`; `setActiveItemId` keeps it. `openItemCard` follows `open`. The drawer maps tab ids to Vibe `TabList` indexes from one `PANEL_TABS` array (Files left out until PR 3), so no magic numbers.
- Callers: `ItemRow`'s updates bubble and `KanbanCard`'s updates button pass `{ tab: 'updates' }`; everything else uses the default.

## Components and files

| File                                                               | PR   | Change                                                                                                           |
| ------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/theme/item-panel-tokens.css` (new)                   | 1–2  | tokens below                                                                                                     |
| `apps/web/src/main.tsx`                                            | 1    | import the new token file next to the others                                                                     |
| `apps/web/src/components/item-card/item-panel-layout.ts` (+ test)  | 1, 2 | the pure functions (key bar, grid, hints in 1; `descriptionMode`, `subitemSummary` in 2)                         |
| `apps/web/src/components/item-card/item-card-store.ts` (+ test)    | 1    | `tab`, `setTab`, `open(..., tab)`                                                                                |
| `apps/web/src/components/item-card/ItemCardDrawer.tsx` (+ test)    | 1–3  | data (items, workspace, role, ctx), crumb, header icon, key bar, tabs, footer (1); one-shot flags (2); Files (3) |
| `apps/web/src/components/item-card/ItemCardDrawer.module.css`      | 1–3  | container, crumb, key bar, footer, narrow rules                                                                  |
| `apps/web/src/components/item-card/ItemKeyBar.tsx` (new)           | 1    | the key bar                                                                                                      |
| `apps/web/src/components/item-card/ItemOverview.tsx` (new)         | 1, 2 | description + fields (1); clamp, subitems row, teaser, stub (2)                                                  |
| `apps/web/src/components/item-card/ItemOverview.module.css` (new)  | 1, 2 | Overview blocks, required-empty styling                                                                          |
| `apps/web/src/components/item-card/ItemFilesTab.tsx` (new, + test) | 3    | the Files tab                                                                                                    |
| `apps/web/src/components/item-card/UpdatesFeed.tsx`                | 2, 3 | `autoFocusComposer` (2); shared `canRemove` (3)                                                                  |
| `apps/web/src/components/item-card/update-attachments.ts`          | 3    | exported `canRemoveAttachment`                                                                                   |
| `apps/web/src/components/item-view/FieldsPanel.tsx`                | 1    | optional `layout: 'rows' \| 'grid'` (default `'rows'`), optional `id`, `data-wide` on wide fields                |
| `apps/web/src/components/item-view/ItemView.module.css`            | 1    | the `layout="grid"` rules and their narrow reset                                                                 |
| `apps/web/src/components/item-view/ItemCell.tsx`                   | 1    | optional `emptyHint`; `data-required-empty`                                                                      |
| `apps/web/src/components/item-view/DescriptionEditor.tsx` + module | 2    | optional `toolbar: 'always' \| 'focus'`, `data-popover-open`                                                     |
| `apps/web/src/components/item-view/use-item-ctx.ts` (new)          | 1    | shared ctx hook                                                                                                  |
| `apps/web/src/components/item-view/item-link.ts` (new)             | 1    | `copyItemLink`                                                                                                   |
| `apps/web/src/components/item-view/ItemView.tsx`                   | 1, 2 | use the hook, `countMissingRequired`, `copyItemLink` (1); `section` scroll and the section id (2)                |
| `apps/web/src/components/board-table/required.ts`                  | 1    | `countMissingRequired`                                                                                           |
| `apps/web/src/components/board-table/open-item.ts`                 | 1, 2 | `tab` option (1); `section` option (2)                                                                           |
| `apps/web/src/components/board-table/ItemRow.tsx`                  | 1    | the bubble passes `{ tab: 'updates' }`                                                                           |
| `apps/web/src/components/board-kanban/KanbanCard.tsx`              | 1    | the updates button passes `{ tab: 'updates' }`                                                                   |
| `tests/visual/src/*`                                               | 1–3  | see Tests                                                                                                        |

Not touched: `tokens.css` (hot spot; the panel's width token stays as it is), `firestore.rules`, `packages/shared/**`, `firebase.json`.

## Tokens

All new literals go in `apps/web/src/theme/item-panel-tokens.css` (header comment: "Item side panel (SIDEBAR-overview-tab): sizes Vibe has no token for."; each token with a short trailing comment, as in `settings-tokens.css`). Everything else uses Vibe or existing Atrium variables (`--space-*`, `--border-radius-*`, `--font-text*-*`, `--atrium-meta-font`, the colour roles named above). Stylelint and the ESLint rule must pass with **no new disable comments**.

| Token                                      | Value                                      | Used for                                                    |
| ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| `--atrium-item-panel-crumb-font`           | `400 12px / 16px var(--font-family)`       | the crumb line                                              |
| `--atrium-item-panel-key-label-font`       | `400 11px / 14px var(--font-family)`       | key-bar labels                                              |
| `--atrium-item-panel-key-label-tracking`   | `0.04em`                                   | key-bar labels                                              |
| `--atrium-item-panel-key-cell-height`      | `28px`                                     | key-bar value cells (design 26; see Risks)                  |
| `--atrium-item-panel-title-font-narrow`    | `500 18px / 26px var(--title-font-family)` | the title below 420 px                                      |
| `--atrium-item-panel-narrow-label-width`   | `104px`                                    | field label column below 420 px                             |
| `--atrium-item-panel-desc-clamp-lines`     | `8`                                        | clamp height multiplier (matches `DESCRIPTION_CLAMP_LINES`) |
| `--atrium-item-panel-desc-fallback-height` | `96px`                                     | Suspense box while the editor loads (PR 2: check it)        |
| `--atrium-item-panel-progress-height`      | `6px`                                      | subitems bar (PR 2)                                         |
| `--atrium-item-panel-progress-width`       | `96px`                                     | subitems bar (PR 2)                                         |
| `--atrium-item-panel-composer-stub-height` | `36px`                                     | "Write an update…" line (PR 2)                              |

If a Vibe font token matches one of the fonts above exactly (`--font-text3-normal` or similar), use it and skip the token; say which in the PR.

## Accessibility

- Heading order inside the panel: the title is the dialog's name (`aria-label="Item card"` stays, the visual test uses it); block labels are `h3`, as in the full view.
- The key bar and the grid are `<dl>`s with `role="group"` fields (the `FieldsPanel` pattern); names "Key information" and "Fields".
- Tabs are Vibe's (`role="tablist"`, arrow keys). Wrap each tab's content in `role="tabpanel"` with `aria-label` = the tab's visible name.
- Every new control is a real `<button>` with a visible or `aria-label` name, as listed above. "Show all fields" and "Show more" carry `aria-expanded`; "Show all fields" also `aria-controls`.
- Colour is never the only signal: required-empty cells also have the hint text and the label's `*`; the subitem bar duplicates its text.
- Focus: Escape behaviour unchanged. Switching to Updates from "Write an update…" moves focus into the composer; from the teaser or "All N updates", focus goes to the Updates tab itself (call `.focus()` on it).
- Motion: nothing new animates. The subitem bar's width is a `transform`. Smooth scrolling honours `prefers-reduced-motion`.
- Touch targets: key-bar cells, the subitems row, the stub and the footer buttons are at least 28 px high on desktop; below 420 px the stub and subitems row keep at least 36 px.

## Tests

### Unit (Vitest, next to the code)

- **`item-panel-layout.test.ts`:**
  - `selectKeyBarColumns`: all four slots; slots in slot order when the board order differs (date before status); no `date` uses the first `timeline`; no second `status` uses the first `dropdown`; only one status column fills slot 1 and leaves slot 4 to a dropdown; a dropped slot shrinks the result (3, 2, 1); no match returns `[]`; a column never fills two slots.
  - `partitionGridFields`: key-bar ids removed; board order kept; 12 fields capped to 10 with `total: 12, hasMore: true`; expanded returns all 12; exactly 10 has `hasMore: false`; 0 fields.
  - `isWideFieldType` for `long_text`, `link`, `files` and a negative case; `keyBarEmptyHint` for the five types and `undefined` for others.
  - PR 2: `descriptionMode` at 11, 12 and 13 lines and with `lineHeight` 0; `subitemSummary` with and without a status column, zero subitems, and items of other parents ignored.
- **`item-card-store.test.ts`:** `open` defaults to `'overview'`; `open(..., 'updates')`; `setActiveItemId` keeps the tab; `closeItemCard` then `open` resets it.
- **`ItemCardDrawer.test.tsx`** (update the existing tests that assume Updates is the default; keep every behaviour): opens on Overview; tab order Overview, Updates, Activity Log (PR 3: Files third); `open(..., 'updates')` opens Updates; the key bar shows the four seeded columns' titles with live cells and appears on every tab; a board without status/people/date/dropdown columns has no "Key information" list; key-bar columns aren't in "Fields"; 12 grid fields show 10 and "Show all fields (12)", then all and "Show fewer"; the required count; footer only on Overview; Copy link writes `…/items/<id>` to the clipboard and toasts; "Open full item" (header and footer) calls `openItemFull`; the crumb shows the group and board names. Fictional people: "Avery Quinn" (`avery@example.com`), "Jordan Reyes", "Morgan Kerr".
- PR 2 additions: the subitems row's text and name, and its click calls `openItemFull(..., { section: 'subitems' })`; viewers don't see the "None yet" row; the teaser shows the newest update's author, text and counts, and opens Updates with that update focused; "Write an update…" opens Updates with the composer focused, and a later return to Updates doesn't refocus; with no updates the label is "Updates" and only the stub shows.
- **`ItemCell`** (extend an existing test file or add `ItemCell.test.tsx`): `emptyHint` shows only for an editable empty cell; read-only shows none; required + empty shows the hint (not "Required") and `data-required-empty`.
- **`FieldsPanel`** (with the drawer tests or its own): `layout="grid"` marks wide fields `data-wide`; default layout unchanged.
- **`DescriptionEditor`** (PR 2): `toolbar="focus"` hides the toolbar until focus and keeps it while the emoji picker is open; default unchanged (the existing editor tests must pass untouched).
- **`ItemView.test.tsx`:** state `{ section: 'subitems' }` scrolls the Subitems section into view once (PR 2); Copy link still works through the helper (PR 1).
- **`ItemFilesTab.test.tsx`** (PR 3): both sections with a files column and an update with attachments; only the second without a files column; the empty state; remove permission follows the shared rule.
- **`ItemRow` / `KanbanCard` tests:** the updates buttons open the panel on Updates; the row name opens it on Overview.

### Visual (Playwright)

- **Seed helper** (PR 1, `tests/visual/src/seed.ts`): `addPanelFields()` / `removePanelFields()`, paired like `addGanttView`/`removeGanttView`. It adds eight columns to the roadmap board (positions after `a7`: text "Owner team", numbers "Estimate (h)", timeline "Window", tags "Tags", people "Reviewer", link "Prototype", dropdown "Sprint", `last_updated` "Last updated") with values on `FULL_VIEW_ITEM` (the reviewer is `AVERY`; no real names), so its grid has 12 fields and the cap shows. Leave one required column empty to show the required styling (mark "Spec / PR" required on that item's board only inside the helper, and restore it in `removePanelFields`).
- **Desktop** (`screens.spec.ts`, light and dark):
  - New `board: item card Overview` (`item-card-overview-{theme}`): seed with `addPanelFields`, open the board, click the row name of "Ship the pipeline" (use the same locator the board-table tests use for the name button), wait for the dialog "Item card", the "Key information" list, the description's first heading "Release pipeline" and "Show all fields (12)"; `shoot(..., PARK_IN_HEADER)`; `removePanelFields` in `finally`.
  - New `board: item card Overview, all fields` (`item-card-overview-all-{theme}`) (PR 2, so the teaser is in it): same seed; press "Show all fields (12)", scroll the content to the bottom, wait for "Write an update…".
  - The existing `item-card-activity-{theme}` baseline changes (crumb, key bar, tab order).
- **Phone** (`mobile-screens.ts`, PR 1): a new screen `item-card` ("Item card: Overview"): open the board, click the same row name, wait for the dialog and "Key information". Add it to `MOBILE_SCREENS` (the audit) and to `BASELINE_SCREENS` (`phone-item-card-light-linux.png`), and update the key-screens count wording in `mobile-screens.spec.ts` and `docs/visual-testing.md` to whatever it is on `main` when you rebase (Settings PR 3 also adds a screen).
- The mobile audit must pass with no new entries in `mobile-known-defects.json`.
- **Baselines only through the workflow:** on each PR branch, `gh workflow run update-visual-baselines.yml -f branch=<branch>`, then `gh run watch`; review the image diffs in the PR's Files changed tab and list them in the PR description. Never commit `*-win32.png` or `*-darwin.png`, never hand-edit a `*-linux.png`; on a PNG conflict, rebase and re-run the workflow.

## Acceptance criteria

- [ ] Opening an item from its name, the row menu or a Kanban card lands on **Overview**; the updates bubble and the Kanban updates button land on **Updates**; previous/next keeps the tab.
- [ ] Tabs read Overview, Updates / n, (PR 3) Files, Activity Log; no NEW badge.
- [ ] The key bar sits under the title on every tab, with the slot rule and fallbacks above, the columns' own titles in caps, live cells (the status picker opens from it), "Set status"/"Assign"/"Set date"/"Set dates"/"Choose" on empty editable cells, red on required-empty ones, and no bar at all on a board with no match.
- [ ] Key-bar fields never appear in the grid; the grid keeps board order, puts long text, links and files on full rows, shows 10 fields and "Show all fields (N)" (N counts the grid only), then "Show fewer".
- [ ] A description of up to 12 lines shows in full; a longer one clamps at 8 with "Show more" / "Show less"; editing a clamped one shows it all; the toolbar appears only while editing.
- [ ] The subitems row shows "x of y done" and opens the full item scrolled to its subitems.
- [ ] The teaser shows the newest update (2 lines, likes, replies) and opens it in Updates; "Write an update…" opens Updates with the composer focused; neither is sticky.
- [ ] Copy link and Open full item sit in a footer on Overview only; the header's open icon works on every tab.
- [ ] At 360 and 390 px wide: the key bar is 2 × 2, fields are label-left rows, previous/next and the creator avatar are hidden, the four tabs fit ("Activity"), no sideways scroll (mobile audit).
- [ ] (PR 3) Files lists column files and update attachments, with the empty state when there are none.
- [ ] The full item view looks and behaves as before (its `item-view` baselines don't change).
- [ ] Tokens only: no hex, px or named colours in modules or TSX, no new lint-disable comments; new literals only in `item-panel-tokens.css`.
- [ ] Light and dark compared side by side with monday's item panel (`docs/reference/monday-ui-reference.md`, "Item card") and the approved preview (Opus visual QA); gaps fixed or logged in the VF group.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build` pass; baselines updated through the workflow and listed in the PR.

## Task breakdown (Sonnet-ready)

Three PRs, merged in this order; each starts from fresh `origin/main` (rebased after the previous merge) in its own worktree under `/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>` with its own `ATRIUM_PORT_OFFSET` in `.env.local`. All three touch `ItemCardDrawer.tsx`, its module and `tests/visual/__screenshots__/**`, so never run them in parallel. The Settings layout PRs in flight also change baselines: merge in order and re-run the workflow after a rebase.

| #   | Branch                           | Offset | Depends on | Hot spots                         |
| --- | -------------------------------- | ------ | ---------- | --------------------------------- |
| 1   | `claude/sidebar-overview-shell`  | 10     | none       | `tests/visual/__screenshots__/**` |
| 2   | `claude/sidebar-overview-extras` | 20     | PR 1       | `tests/visual/__screenshots__/**` |
| 3   | `claude/sidebar-files-tab`       | 40     | PR 2       | `tests/visual/__screenshots__/**` |

### PR 1: chrome, key bar, Overview with description and fields, footer, narrow layout

1. `item-panel-tokens.css` (the PR 1 tokens) and its import in `main.tsx`.
2. `item-panel-layout.ts`: `selectKeyBarColumns`, `partitionGridFields`, `isWideFieldType`, `keyBarEmptyHint`, constants; tests first.
3. Extractions: `use-item-ctx.ts`, `countMissingRequired`, `item-link.ts`; switch `ItemView` to them with no visible change (its tests and the `item-view` baselines must not change).
4. Store `tab`/`setTab`, `openItem`'s `tab` option, the two updates buttons.
5. `ItemCell` `emptyHint` and `data-required-empty`; `FieldsPanel` `layout="grid"`, `id`, `data-wide`, and the grid CSS.
6. Drawer: `useItems`, `useWorkspace`, role, `useItemTableCtx`; crumb; header open icon; `ItemKeyBar`; `PANEL_TABS` (Overview, Updates, Activity Log); `ItemOverview` with the description (the full editor, toolbar as today; PR 2 adds the focus mode and clamp) and the fields block with the cap; footer.
7. The container query and the narrow rules.
8. Unit tests as listed; the seed helper; the `item-card-overview` desktop screen and the phone `item-card` screen. All checks, then the baseline workflow.

### PR 2: description rules, subitems row, teaser and composer line

1. `descriptionMode`, `subitemSummary` and their tests; the remaining tokens.
2. `DescriptionEditor` `toolbar="focus"` and `data-popover-open`; the clamp with "Show more" / "Show less" in `ItemOverview`.
3. The subitems row; `openItemFull`'s `section` option; `ItemView`'s scroll and section id.
4. The teaser, "All N updates", the "Write an update…" line, the one-shot flags; `UpdatesFeed` `autoFocusComposer` and `canManage`.
5. Tests as listed; the `item-card-overview-all` screen. Checks, then the baseline workflow.

### PR 3: Files tab

1. `canRemoveAttachment` in `update-attachments.ts`, used by `UpdatesFeed`.
2. `ItemFilesTab.tsx` and its test; Files added to `PANEL_TABS` third; the store's `'files'` tab.
3. Update the drawer tab-order tests. Checks, then the baseline workflow (the Overview screens change only in the tab row).

Each PR: the description says what changed, links the Roadmap item, lists the baseline diffs, has light and dark screenshots (and the phone one for PR 1), and names the model that wrote the code.

## What Ophelia (Opus) reviews

- No duplicated cell or field logic: the key bar and the grid render `ItemCell` and `FieldsPanel`; nothing re-implements a column's display.
- The slot rule matches the table above, case by case, against the tests.
- `ItemView` is unchanged to the eye (baselines) after the extractions, and the shared ctx carries `board` and `boardRole` (column locks apply in both views).
- Tokens only; the narrow rules are all inside the one container query.
- The focus moves (composer, Updates tab) and the tab-panel semantics with a screen reader pass on VoiceOver.
- Baselines came from the workflow and only the item-card screens changed.

## Showcase, provenance, docs

- Showcase: no impact (no new column type or board feature).
- Provenance: nothing copied; no new dependencies.
- Docs: a line in `HANDOFF.md` and a handoff note after PR 3; owner checks in `docs/plans/owner-check-list.md` (Opus, docs PR).

## Owner checks (production)

1. On the board, click an item's name: the panel opens on Overview with Status, Person, Date and Priority under the title; change the status from there.
2. Click a speech bubble instead: the panel opens on Updates, with the same bar on top.
3. On an item with many fields, press "Show all fields" and "Show fewer"; check the long text, link and files fields take the full width.
4. Press the subitems row: the full item opens at its subitems. Back on the board, press "Write an update…": the composer is ready to type.
5. On the phone, open an item: the bar is two by two, the fields are one list, the tabs fit.
6. (After PR 3) Open Files on an item with an attachment.

## Risks

- **Cell density in the key bar.** Vibe cells (status pill, people avatars, timeline bar) were designed for 36 px table rows. If they clip at 28 px, use `var(--space-32)` and tell Opus; don't hand-size inner elements.
- **The editor in the panel.** Opening the panel now loads the TipTap chunk the first time (it was only loaded by the full view). The Suspense box keeps the layout still; check the first open on a slow profile. The panel and the full view never show at once (`openItem` closes the full view; `openItemFull` closes the panel), so two editors never edit the same description.
- **A second items listener.** `useItems(boardId)` in the panel duplicates the board's own query; Firestore shares one watch target for identical queries, so it adds no reads. Check the network panel once.
- **Container queries** need current browsers (all evergreen ones). Don't add a JS fallback.
- **Lock behaviour change.** If the shared ctx now makes a locked column read-only in the full view for a non-owner, that is the intended fix (the rules already refuse the write); mention it in the PR.
- **Visual flake.** The lazy editor and Vibe's lazy icons: wait for the description heading and the key bar, not for network idle.
