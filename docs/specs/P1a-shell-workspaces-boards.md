# P1a: monday-accurate app shell, Home, workspaces, folders, boards

Author: Opus 5.5 · Implementer: Sonnet 5.5 (high effort) · Status: ready to build
Roadmap epics: VF "App shell parity", P1 "Workspaces & folders", P1 "Boards CRUD" (header only; the table is P1b).

P1 is split into three specs:

- **P1a (this spec):** the shell, workspaces, folders and boards.
- **P1b:** the board table, groups, items and core columns.
- **P1c:** the item card, updates, filters and undo.

## 0. Visual target and process (read first)

The user's top priority is that Atrium looks like monday's **in-app** UI. "Vibe-styled" isn't enough. Build to the reference below, then run the **visual QA gate**:

1. Run `pnpm dev`. Sign in through the Auth emulator with a test account you create there.
2. Screenshot every screen in this spec in light and dark.
3. Compare against the reference description. Fix the gaps.
4. In your report, list any remaining gaps.

Use Vibe CSS variables for every colour, spacing step, radius, shadow and font. Put any Atrium-specific values in one tokens file (`apps/web/src/theme/tokens.css`). Don't hard-code hex values or pixels in components; layout sizes (sidebar width etc.) go in the tokens file too.

### 0.1 Reference layout: monday's shell, light theme

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [⋮⋮⋮] [logo] Atrium            (top bar, 48px, on surface grey)  🔔 📥 👤+ ⋮⋮ 🔍 ? │ [avatar] │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ 🏠 Home        │╭────────────────────────────────────────────────────────────╮│
│ ☑ My work      ││                                                            ││
│ ─────────────  ││        MAIN CONTENT: white panel, top-left radius           ││
│ ★ Favorites  ⌄ ││        --border-radius-big (16px), no border, shadow        ││
│ ─────────────  ││        --box-shadow-xs; fills to right + bottom edges        ││
│ Workspaces ⋯ 🔍││                                                            ││
│ [S] Avery's… ⌄+││                                                            ││
│   ▤ Board one  ││                                                            ││
│   ▸ 📁 Folder  ││                                                            ││
│     ▤ Board 2  ││                                                            ││
│ (sidebar 256px,││                                                            ││
│  surface grey) ││                                                            ││
└───────────────┴╰────────────────────────────────────────────────────────────╯┘
```

- **Page background (top bar and sidebar):** monday's light surface grey, Vibe `--allgrey-background-color` (#F6F7FB). In dark it's `--primary-background-color` of the dark theme, with the content panel one step lighter (`--secondary-background-color`). In black, use the black theme equivalents. The sidebar is **not** dark in light mode. This replaces the current dark sidebar.
- **Top bar (48px):**
  - Left: an app-switcher grid icon button, then the Atrium mark plus wordmark (Poppins 600, 16px).
  - Right, as 32×32 ghost icon buttons with tooltips: Notifications (bell), Inbox, Invite members, Search, Help. They're placeholders that open a "Coming soon" tooltip or toast.
  - A 1px vertical divider, then the user avatar (32px circle, Google photo or initials) that opens the existing account menu (theme, sign out).
- **Sidebar (256px, collapsible to 0 with a chevron button on its right edge like monday's):**
  - Nav items are 36px tall with 8px horizontal padding, `--border-radius-small` (4px), icon 20px plus label, Figtree 14px, text `--primary-text-color`.
  - Hover background is `--primary-background-hover-color`. Selected background is `--primary-selected-color` with `--primary-color` text.
  - Items: Home, My work (placeholder route `/my-work`, empty state), a divider, Favorites (collapsible section, lists favourited boards), a divider, then the Workspaces section.
- **Workspaces section:**
  - A header row reading "Workspaces", with a "⋯" menu (Browse all workspaces → `/workspaces`) and a search icon that filters the board list below.
  - **Workspace switcher:** a full-width button showing the workspace avatar, the workspace name (truncated) and a chevron.
    - The avatar is a 24px rounded square (`--border-radius-small`) in the workspace colour, with a white initial or emoji, Poppins 600.
    - Clicking it opens a Vibe Dialog/Menu: a search field, the list of my workspaces with avatars and a check on the current one, and "+ Add workspace" at the bottom (opens the existing create modal).
  - A "+" icon button next to the switcher opens the **Add menu**: New board, New folder.
  - **Content tree** for the current workspace:
    - Folders are collapsible: a chevron, a folder icon in the folder colour, the name, and a count shown on hover.
    - Boards are a board icon plus name.
    - Ordered by `position`, folders first at each level, matching monday.
    - Each row has a "⋯" button on hover that opens the context menu (section 4).
    - The active board is highlighted.
- **Content panel:** the routed page renders inside it, with 24–32px inner padding on Home and workspace pages, and none on board pages (the board manages its own layout).
- **Typography:** Figtree for UI text and **Poppins** for page titles. Load both weights from Google Fonts: Figtree 400/500/600 and Poppins 500/600.

### 0.2 Home page (`/`)

monday's Home:

- A greeting in Poppins 24px ("Good evening, Avery!", by time of day using the first name), with a subtitle in secondary text: "Quickly access your recent boards and workspaces".
- **Recently visited:** a responsive grid of board cards. Each card has a thumbnail area (light grey with a board icon), the board name, and "Workspace name" underneath with a small workspace avatar. Clicking opens the board. Store recents in `users/{uid}/recents/{boardId}` with `visitedAt`, capped to the last 12 client-side. Empty state: a friendly line plus a "Create board" button.
- **My workspaces:** rows with avatar, name, and "Open" on hover.
- Redirect rules: `/` no longer redirects to the last workspace. Home is the landing page, as in monday.

### 0.3 Workspace page (`/workspaces/:workspaceId`)

- **Header:**
  - A 56px workspace avatar, then the workspace name in Poppins 32px (inline-editable for owner/admin) and the description underneath (inline-editable, placeholder "Add workspace description").
  - On the right: a "⋯" menu with Workspace settings (dialog: name, icon/emoji, colour palette of the 10 Vibe workspace colours, description).
- **Tabs (Vibe TabList):** "Recents" and "Content".
  - **Content:** a table-like list of folders and boards (name, type icon, last updated, created by avatar). Folders expand inline.
  - **Recents:** this user's recently visited boards in this workspace.
- **Primary button** "+ Add" (Vibe Button with dropdown): New board, New folder.
- **Empty state** (no boards): a centred illustration area (use a simple original SVG composed from the Atrium mark shapes; no monday artwork), the line "This workspace is empty" and a "Create board" button.

## 1. Data model changes (update `packages/shared` schemas and types)

Board (`boards/{boardId}`) adds:

- `accessUids: string[]`. It must always equal `Object.keys(access)` and is rule-enforced (§2).
- `position: string`. A fractional index used for ordering within its folder or the workspace root.
- `icon: string | null`, reserved (default null).

New subcollections:

- `users/{uid}/favorites/{boardId}`: `{ boardId, workspaceId, addedAt, position }`. Self only.
- `users/{uid}/recents/{boardId}`: `{ boardId, workspaceId, visitedAt }`. Self only. Written when a board page opens.

Folder: unchanged, except it needs `position` sorting and nested `parentFolderId`. Allow one level of nesting in the UI (monday allows sub-folders; one level is enough for now).

Also update the `docs/architecture.md` §5.4 field list to include `accessUids`, `position` and `icon`. You may edit that one section only.

**Default new board** (monday's default), created client-side in one batch:

- `columns`, in this order:
  - `person` (type `people`, title "Person"). The P1b column types exist only in shared so far. Add `people`, `date`, `numbers`, `dropdown`, `checkbox`, `link` and `long_text` modules to the shared registry now, with settings and value schemas plus `toText` and `compare` that match monday's value JSON. No editors yet.
  - `status` (type `status`, labels "Working on it" orange `working_orange`, "Done" green `done_green`, "Stuck" red `stuck_red`, and the empty/default label grey).
  - `date` (type `date`, title "Date").
- `groups`:
  - "Group Title" with Vibe group colour `--color-bright-blue` / monday blue
  - "Group Title" (second) with `--color-grass_green`
- Items: none (P1b adds "Item 1..3" seeding when the table exists).
- `subitemColumns`: `[]`. `itemTerminology`: "item". `access`: `{[uid]: 'owner'}`. `accessUids`: `[uid]`. `kind` comes from the create dialog.

## 2. Security rules (`firestore.rules` and `tests/rules`)

- **Board create:** requires `accessUids == [uid()]` along with the existing `access == {uid: 'owner'}`, a valid `position` (string, 1–64 chars) and `icon == null`.
- **Board update:**
  - If `access` changes, `accessUids` must change too, and `request.resource.data.accessUids.toSet() == request.resource.data.access.keys().toSet()` must hold. If `accessUids` changes, `access` must also change consistently (same check).
  - `position` and `folderId` may be changed by editors.
  - If `folderId` is set, it must reference an existing folder in the same workspace: `exists(/databases/$(database)/documents/workspaces/$(resource.data.workspaceId)/folders/$(folderId))`.
- **Board list:** allow if (`kind == 'main'` && workspace member) **or** `uid() in resource.data.accessUids`. The client runs two listeners and merges them, deduped by id:
  - main boards: `where workspaceId == X and kind == 'main'`
  - my boards: `where accessUids array-contains uid and workspaceId == X`

  Add the composite indexes these queries need to `firestore.indexes.json`.

- **Workspace membership:** a user who is no longer a workspace member must not read a board through `access` alone. Change `boardRole` so explicit access only counts while the user is still a workspace member (`isWsMember(board.workspaceId)`). This implements the accepted decision "Removing a workspace member must also revoke their board access".
- **Favorites and recents:** read and write by the owner only. Keys and types are validated.
- **Folder delete:** allowed for workspace admins (as now). The client first moves the folder's boards to the root (batch update of `folderId: null`), then deletes the folder.
- **Tests:** add tests for each new or changed rule: accessUids consistency (forged accessUids denied), list via accessUids for a private board, a non-member with stale access denied, cross-workspace folderId denied, and favorites/recents being self-only.

## 3. Board page (`/boards/:boardId`): header only in P1a

monday's board header, inside the content panel:

- **Top row (24px padding):**
  - Board name in Poppins 24px 500, inline-editable on click (Vibe EditableHeading), for editors.
  - A chevron next to the name opens a popover with the description (editable) and board info: workspace, owner, created date.
  - Right side:
    - "Integrate" and "Automate" ghost buttons (placeholders with "Coming soon" tooltips)
    - an avatar stack of board members (from `access`) plus "Invite / N" (placeholder)
    - a "⋯" board menu (same as the sidebar context menu)
    - a star toggle (favourite)
- **Views row:** a Vibe TabList with a "Main table" tab with a table icon, plus a "+" button (placeholder for P3 views). A 1px divider underneath.
- **Toolbar row:**
  - "New item" primary button with a split dropdown arrow (disabled until P1b, tooltip "Coming in the next update")
  - ghost buttons Search, Person, Filter, Sort, Hide and Group by, each with an icon and label, all disabled placeholders for P1b/P1c, matching monday's spacing (8px gaps, 32px height)
- **Body:** an empty state that says the table arrives in the next update. Show the board's groups as monday-style group headers so the user sees structure: a coloured chevron, the group title in the group colour (Figtree 18px 500), and an item count. No table yet.
- Opening a board writes the `recents` doc and sets `users/{uid}.lastWorkspaceId`.

## 4. Board, folder and workspace actions

| Object    | Action                     | Implementation                                                                                                                    |
| --------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Board     | Rename                     | Inline in header and sidebar (double-click or menu → Rename)                                                                      |
| Board     | Add/remove favourite       | Star in header, menu item                                                                                                         |
| Board     | Duplicate (structure only) | New board doc, name "<name> (copy)", same columns/groups, caller as owner                                                         |
| Board     | Move to folder             | Submenu listing folders in the workspace, plus "Workspace root"                                                                   |
| Board     | Archive / Delete           | Set `state` to `archived` / `deleted` with `deletedAt`; hidden from lists; toast with **Undo** that restores `state: 'active'`    |
| Board     | Change kind                | Board menu → "Board permissions" dialog with radio buttons Main / Private / Shareable and descriptions like monday's (owner only) |
| Folder    | Create / rename / recolour | Menu; the colour palette uses the same 10 workspace colours                                                                       |
| Folder    | Delete                     | Confirm dialog "Boards inside will move to the workspace root"                                                                    |
| Workspace | Create                     | Existing modal, restyled to monday's "Add workspace" dialog (name, privacy Open/Closed, icon + colour)                            |
| Workspace | Settings                   | Dialog (§0.3)                                                                                                                     |

**Reordering:** drag-and-drop of boards and folders in the sidebar tree using `@dnd-kit` (reorder within a level and drop a board into a folder). Write a single `position` / `folderId` update per move using `fractional-indexing`.

All lists stay live via Firestore listeners. Use optimistic UI where cheap.

## 5. Out of scope for P1a

The table, items, columns UI, the item card, filters, real search, notifications, invites and member management are not in this spec. Leave tidy "Coming soon" placeholders for them.

## 6. Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (add component tests for sidebar tree rendering, the board create dialog, accessUids merging and the Home greeting), `pnpm test:rules` and `pnpm build` all pass.
- The visual QA gate has been run (§0). The report lists screens checked in light and dark, and any remaining gaps.
- No deploy, no commit or push. Don't edit CLAUDE.md or HANDOFF.md. In docs, edit only architecture §5.4.
