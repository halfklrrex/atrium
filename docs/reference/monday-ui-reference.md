# monday.com in-app UI reference (light theme)

Captured 2026-10-23 from the owner's monday account using Claude in Chrome. Read-only: nothing in the account was changed.

- **Screenshots:** in `docs/reference/monday/`, which is gitignored because they show the owner's private account.
- **Measurements:** read from the live DOM with `getComputedStyle`, in CSS px at a 1718px-wide viewport. The screenshots are downscaled, so trust the numbers here over pixel-measuring the images.

Dark theme was not captured (switching it would change the owner's account setting). Use Vibe's dark and black theme tokens as the equivalents.

| File                           | Shows                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `01-board-table.jpg`           | Board page: header, view tabs, toolbar, groups, table, status cells, footer batteries |
| `02-workspace-switcher.jpg`    | Workspace switcher dropdown in the sidebar                                            |
| `03-add-to-workspace-menu.jpg` | "+" (Add to workspace) menu                                                           |
| `04-home.jpg`                  | Home page                                                                             |
| `05-workspace-page.jpg`        | Workspace page (cover, avatar, tabs)                                                  |
| `06-item-card.jpg`             | Item card side panel (Updates tab, empty state)                                       |
| `07-status-cells-zoom.png`     | Close-up of status/priority cells and header row                                      |
| `08-board-options-menu.jpg`    | Board "⋯" options menu                                                                |

## Global

- **Fonts:** Figtree for all UI. Poppins for titles: board title, group titles, workspace title, item card title. Base body size 15px/22.5px, with most UI text at 14px/20px.
- **Text colour:** primary `#323338`, secondary `#676879`.
- **App background:** `#EDF1FC` (rgb 237,241,252). This is the colour behind the top bar.
- **Below the top bar:** a single white surface with a **12px top-left radius** contains the sidebar and the page. On the board page the content area is white. On Home, the content sits on a light grey area (`#F6F7FB`-ish) inside white rounded cards.
- **Primary blue:** `#0073EA`. Border/grid colour `#D0D4E4`. Radius 4px on controls and 8px on cards and menus.

## Shell layout, re-measured 2026-10-23 (supersedes the "Global" notes above)

- `surface`: the whole app below any banner, background **`#EDF1FC`**.
- **Top bar:** 48px, transparent, on the surface.
- **Left pane:**
  - Starts 12px from the left edge, directly under the top bar. 255px wide, full height.
  - Radius **12px on the top-left corner only**.
  - Background `linear-gradient(135deg, #FFFFFF 5%, #EDF1FC 100%)`, so it fades into the surface toward the bottom-right. There is no border.
- **Content panel:** starts right where the left pane ends (no gap). White, radius **12px top-left only**, filling to the right and bottom edges. When the left pane collapses, the panel starts 12px from the left edge.
- **Section labels in the sidebar** ("Favorites ›", "Workspace", "monday AI ⌄"): Figtree **12px weight 600** `#323338`. Sections are separated by spacing (about 16–24px), **not by divider lines**.
- **Workspace switcher:** a bordered box, **1px `#C3C6D4`, radius 4px, 32px tall**, about 174px wide. Inside: a 20px avatar, the name in Figtree 16px weight 600, and a chevron. The blue **32×32** "+" button sits 8px to its right.
- **Top bar icons:** **40×40** buttons on a 44px pitch with 20px line icons. The app-grid icon has extra space before it, then the account logo and avatar.
- **Logo text:** "monday" is **Poppins 16px weight 700**, followed by "work management" in a regular weight. For Atrium, use "Atrium" in Poppins 16/700 and "workboards" in Figtree 16/400 in secondary text colour.
- **Board table wrapper:** radius 8px.

## Top bar

- 48px tall, padding `0 24px 0 4px`, sitting on the `#EDF1FC` background.
- Left: an app-grid/logo mark, then the product name: "monday" bold plus "work management" regular, about 16px.
- Right: a row of 20px line icons in 32px ghost buttons with about 4px between them: notifications, inbox, invite, apps, search, help. Then a divider, the account logo and a 32px round avatar.

## Sidebar (≈256px)

- Background white, which is part of the rounded surface. Top items are Home, My work and More: 32px tall rows with a 20px icon and 14px/20px text. Labels are `#676879` until active.
- **Selected row:** background `rgba(194,213,255,0.4)` (light blue), radius 4px, text `#323338`, row width ≈214px with 8px side insets.
- **Hover:** a light grey background (Vibe `--primary-background-hover-color`).
- **Section labels** ("Favorites ›", "Workspace"): about 13–14px, secondary colour. Collapsible sections have a chevron.
- **Workspace row:**
  - Header "Workspace", with `⋯` and a search icon right-aligned.
  - Below it the switcher: a 20–24px rounded-square avatar (letter, workspace colour), then the name in **Figtree 16px weight 600**, then a chevron.
  - To its right a **blue 32×32 "+" button** (`#0073EA`, radius 4px, white icon).
- **Board rows:** 32px tall with a 16px board icon and 14px name. The active board uses the selected style.
- **Workspace switcher dropdown** (`02`):
  - A card with radius 8px and a shadow.
  - A search input "Search for a workspace", then "Recent workspaces" and "My workspaces" sections with 20px avatars. The current workspace has a light-blue background.
  - Footer actions: "Browse all" and "+ Add workspace".
- **Add menu** (`03`):
  - Title "Add to workspace" in small grey text.
  - Items with icons: Board ›, Doc ›, Dashboard, Folder, Template center, More ›.
  - A divider, then "Add to account" → New workspace.
  - Rows are about 28px with 14px text.

## Board page (`01`, `07`, `08`)

- **Header:**
  - The board name in **Poppins 24px/30px weight 500**, followed by a chevron (board info).
  - Right side: ghost buttons Integrate and Automate (icon + 14px label), a members avatar, an "Invite / N" outlined small button, a link icon and `⋯`.
- **View tabs:** "Main table" with a `⋯` and a "+" after it. 14px. The active tab has a 2px blue underline. A 1px divider spans the full width under the tabs.
- **Toolbar** (about 16px below the tabs):
  - **New item:** a primary split button, 32px tall, padding `4px 8px`, 14px, radius `4px 0 0 4px`, plus a 32px dropdown-arrow segment.
  - Then 32px ghost buttons with 16px icon + 14px label: Search, Person, Filter ⌄, Sort, Hide, Group by, `⋯`.
  - A collapse chevron sits at the far right.
- **Groups:**
  - **Title row:** a chevron in the group colour, then the title in **Poppins 18px/24px weight 500 in the group colour**. About 40px of vertical space between groups.
  - **Group colour bar:** a vertical bar about 6px wide at the left edge of the group's header row and all of its item rows. The header row's top-left corner is rounded about 4px.
- **Table grid:**
  - **Header row:** 36px. Column titles are Figtree 14px `#323338`, centred, except Item, which is left-aligned. There's a "+" add-column cell at the end.
  - **Item rows:** 36px. Every cell has a **1px `#D0D4E4` bottom border** and a right border between columns.
  - **Columns:** the Item column is ≈400px and includes a checkbox column (≈36px) on its left plus an "add update" bubble icon at its right edge. Regular columns are ≈140px; text columns are wider (≈300px).
  - **Row hover:** a light grey background, with a `⋯` row menu appearing in the left gutter.
  - **Selected/open row:** a light-blue background.
- **Status and priority cells:** the colour fills the whole cell (full-bleed, no padding, no radius), with a white 14px centred label. A small folded-corner triangle appears on hover. Observed colours:
  - Done / green `#00C875`
  - Working, Building, High / orange `#FDAB3D`
  - Stuck, Critical / red `#DF2F4A`
  - Not started / dark grey `#757575` (the default empty label is light grey `#C4C4C4`)
  - Medium / blue `#579BFC`
  - In review / light blue
- **Other cells:**
  - **Dropdown:** small pill tags (light-blue background, 12–13px text, radius 4px).
  - **Link:** blue text.
  - **Long text:** a truncated single line with an ellipsis.
- **"+ Add item" row:** 36px, 14px secondary text, indented to align with the item names. The colour bar continues, faded.
- **Footer summary row:** 36px, with no bottom-left border. Under status-type columns is a **battery**: a horizontal stacked bar about 24px tall showing each label's share in its colour, with 4px insets.
- **Board options menu** (`08`):
  - A card with radius 8px and a shadow, titled "Board options".
  - Items: Power-Ups ›, AI suggestions, then a divider, then Activity log, Discussion, then a divider, then Notifications, Permissions, Settings ›, More actions ›, then a divider, then Archive board, Delete board, then a divider, then View archive / trash ›, Give feedback.

## Item card (`06`)

- A right-hand panel about 42% of the viewport wide and the full height below the top bar. White, with a left shadow. The board stays visible and the open row is highlighted.
- **Header:**
  - A close "X", then the item name in **Poppins ~24px weight 500**.
  - Right side: an assignee avatar, a "subscribe/updates" icon and `⋯`.
- **Tabs:** Updates (with a home icon), Files, Activity Log, "+". Under them a secondary row with "Update via email" and "Give feedback" links.
- **Composer:** a bordered box (radius 8px, blue focus border) with a rich-text toolbar row, an empty body about 80px tall, and a bottom row of @ / attach / emoji / AI icons with a blue **Update** split button.
- **Empty state:** an illustration, then "No updates yet" (bold 16px), then two lines of secondary text.

## Item card: updates thread (`11`), measured 2026-10-26

Measured on an item with 4 updates and replies, at a 1920px-wide viewport. Positions are relative to the panel's top-left corner.

- **Panel:** 700px wide (≈36% of 1920) and full height below the top bar. White, with shadow `0 4px 8px rgba(0,0,0,.2)`, no border, square corners.
- **Title:** an `h2` at (57, 21), **Poppins 24px/34px weight 500**, primary text. It is inline-editable: transparent 1px border, 4px radius, `0 4px` padding (the border shows on hover).
- **Tabs** at y≈73: "Updates / 4" (the count follows a slash), Files, Activity Log, "+". Figtree 14px/24px. The active tab has a blue underline.
- **Sub-actions row** at y≈107: "Update via email" and "Give feedback" as tertiary buttons, 32px tall, 14px secondary text, `4px 8px` padding, 4px radius, with a thin vertical divider between them.
- **Composer (collapsed):** at (16, 143), 653×92, 1px `#D0D4E4` border, 8px radius. Placeholder "Write an update and mention others with @" in 15px secondary text, with a bottom row of @ / attach / emoji / AI icons. The rich-text toolbar and the "Update" button appear only once it is focused (see `06`).
- **Update card:** at (16, 251), 653 wide, 1px `#C3C6D4` border, **8px radius, no shadow**, white. The cards are stacked about 16px apart.
  - **Header** (padding 16px): a 40px round avatar with a 1px white ring at (34, 269); the author name **Figtree 14px/20px weight 700**; the relative time ("1d", "17h") 14px secondary right after the name. Icon buttons on the right: mark-as-read, copy link, `⋯`.
  - **Body:** 15px/22.5px primary text, padding `0 16px 16px`. Links are `#1F76C2` with no underline. "Edited" sits at the bottom right in 14px secondary.
  - **Reaction summary:** a small "👍 1" chip under the body.
  - **Action row:** separated from the body by a full-width 1px divider. 48px tall, padding `8px 8px 8px 16px`, gap 4px. It holds a like icon button (36×32) and a "Reply" tertiary button (icon + text, 14px secondary, `4px 8px`, 4px radius).
- **Replies** (inside the same card, below the action row):
  - Each reply is a 32px avatar plus a **grey bubble** (`#F6F7FB`, 8px radius, 12px padding), starting at x=65 and 595 wide.
  - Inside the bubble: the name in 14px/20px weight 700 and the time in secondary text on one line, then the text in **14px/21px** (one step smaller than the update body).
  - Under each bubble there is a small like / "Reply" row, with no divider.
  - At the bottom, a reply composer: a 32px avatar plus a field with a 1px `#C3C6D4` border, 8px radius, 16px padding and 40px left margin, and the placeholder "Write a reply and mention others with @".
- **Overall feel:** flat cards with no shadows, a single grey only for reply bubbles, and one font (Figtree) everywhere except the Poppins title.

## Home (`04`)

- **Header strip:** white, holding the greeting "Good night, <name>!" (14px) above "Quickly access your recent boards, Inbox and workspaces" (larger, about 18px weight 500). Right side: "Give feedback" (ghost) and "Quick Search" (primary).
- **Main column** (white card, radius 8px, on the grey background), with collapsible sections that each have a chevron and a 16px weight 500 title:
  - **Recently visited:** a grid of cards about 230×165. Each card has a light-blue thumbnail with a stylised board illustration, then a board icon + name + star, then a breadcrumb "work management > Workspace" in 12px grey.
  - **Update feed (Inbox):** with a blue count badge.
  - **My workspaces:** a 2-column grid of bordered cards (radius 8px). Each card has a 40px rounded-square avatar, the name in 16px, and the product label under it.
- **Right rail (≈300px):** cards for a profile checklist, a templates promo, and "Learn & get inspired" links.

## Workspace page (`05`)

- **Cover:** a light grey banner across the top, about 200px.
- **Avatar:** about 72px, a rounded square (radius 8px) with a large white letter on the workspace colour. It overlaps the banner's bottom edge on the left.
- **Name:** **Poppins ~32px weight 500**, with a chevron. "Add workspace description" sits beneath it in secondary 14px.
- **Right side:** "Feedback", a member avatar stack, a primary small "Invite / N" button and `⋯`.
- **Tabs:** Recents, Content, Permissions, each icon + label. The active tab has a blue underline. A full-width 1px divider runs under them.
- **List rows:** about 40px each, with a board icon, the name in 14px and a star at the right. Rows are separated by a 1px divider.
