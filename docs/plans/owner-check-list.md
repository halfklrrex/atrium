# Owner check list

Live checks only the owner can do, collected per feature while agents build ahead (see `2026-10-31-build-ahead-batch.md`). Agents append a section when a feature merges and tick off what they verified themselves. Delete a section once the owner has signed it off on the Roadmap.

## Merged 2026-11-04 (feature push, live)

- **Gantt view (#83, #88):** on the showcase board add or open a Gantt view. Check the dependency arrows, the baseline bars, the critical path highlight (red arrows) and that the label on a bar stays readable. Drag a bar to move it. Light and dark.
- **Workload view (#91):** add a Workload view to a board with a people, a timeline and an effort column. Check the capacity bars per person, that they change when you edit an item's dates or effort, and the overloaded colour. Light and dark.
- **Board templates (#85, #87):** open **New board** and pick a starter template in the gallery; create the board. Then open a board's options menu, choose **Save as template**, and create another board from it.
- **Favourite drag (#78):** drag a favourite to reorder it and release; the board must not open. Try the same in the main sidebar tree.
- **Readable text on fills (#77):** check status pills and bars on every colour, red included, in light and dark; the text should always be readable.
- **Dashboards data layer (#89) and the P5a automations schemas (#81, #82, #84):** nothing visible yet. The dashboard screens and the automations engine are in progress (the engine is PR #90, held for the ultrareview).

## Merged 2026-11-04 (P5a)

- **Automations engine (P5a):** P5a is backend only: no UI until P5b. Nothing to check in the app yet; recipes can only be created through the Firebase console until the builder lands.

## Merged 2026-11-04

- **Rich text in updates and replies (#74):** open an item card and write an update. Check the toolbar (bold, italic, underline, lists, links), Ctrl+B / I / U, @mentions (the person is notified) and replies, then reopen the item to confirm the formatting stays. Old plain-text updates still render. Light and dark.

## Merged 2026-11-03 (autonomous batch; I could not run the Chrome check, the extension was not connected)

- **Activity log (#63):** open any board's options menu and choose **Activity log**; try the Person, Column and Date filters and click a row to open its item. Open an item card's **Activity Log** tab (it now shows real history, not the placeholder). Edit a cell, rename an item and move it to another group, then watch the entries appear. Defaults I chose (change them if you disagree): entries expire after 90 days, board viewers can read the log, description edits are not logged. Light and dark.
- **Button actions (#65):** in a column's menu choose **Settings** on a Button column and add actions (set a column value, rename the item with `{name}` / `{date}`, move to a group, archive). Click the button on an item and check the result. The showcase board has a "Mark as shipped" button (Status = Done, rename). Known limit: **move to group** keeps the item's position key, so it can land anywhere in the target group, not at the end. A bad action refuses the whole click with a message and changes nothing.
- **Column settings (#66):** in a column's header menu choose **Description & default value**: set a description (shows as a tooltip on the column header and the item field label) and a default value for new items. Empty required cells show a "Required" hint and the item card counts empty required fields. Required is a soft rule (nothing blocked); say if you want a hard rule somewhere.
- **Reorder favourites (#68):** in the sidebar's Favorites, drag a board up or down, or use the row menu (Move up / Move down). Check the drag feel and that a plain click still opens the board. The order is per person.
- **Notify people button action (#72):** needs two accounts. In a Button column's settings add **Notify people**, pick the other account and an optional message, click the button, and check the "Clicked ..." notification in the other account's bell. Also check the new **Button clicks** switch in notification settings, and that a quick double click sends only one notification.
- **Rich text in updates (backend, #69):** nothing visible yet; the composer follows in the next PR. The server now accepts a rich document next to the plain text of an update or reply.

## Already merged and waiting for a look (2026-10-31)

- **Earlier:** two-account notifications and @mentions; drag and drop on Calendar and Timeline.
- Signed off on 2026-11-04 and removed: board sharing and roles (#46, the owner will review it later with an ultrareview), saved views, change column type, Files column, Mirror, description editor passes.

## Decisions waiting for the owner

- **Button column:** answered (configurable multi-step actions). Slice B, "notify people", is merged (#72); see its check above.
- **Required columns:** I made "Required" a soft rule (a hint, nothing blocked). Tell me if you want a hard rule somewhere, for example when an item moves to Done.
