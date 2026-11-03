# Owner check list

Live checks only the owner can do, collected per feature while agents build ahead (see `2026-10-31-build-ahead-batch.md`). Agents append a section when a feature merges and tick off what they verified themselves. Delete a section once the owner has signed it off on the Roadmap.

## Merged 2026-11-03 (autonomous batch; I could not run the Chrome check, the extension was not connected)

- **Activity log (#63):** open any board's options menu and choose **Activity log**; try the Person, Column and Date filters and click a row to open its item. Open an item card's **Activity Log** tab (it now shows real history, not the placeholder). Edit a cell, rename an item and move it to another group, then watch the entries appear. Defaults I chose (change them if you disagree): entries expire after 90 days, board viewers can read the log, description edits are not logged. Light and dark.
- **Button actions (#65):** in a column's menu choose **Settings** on a Button column and add actions (set a column value, rename the item with `{name}` / `{date}`, move to a group, archive). Click the button on an item and check the result. The showcase board has a "Mark as shipped" button (Status = Done, rename). Known limit: **move to group** keeps the item's position key, so it can land anywhere in the target group, not at the end. A bad action refuses the whole click with a message and changes nothing.
- **Column settings (pending, PR #66):** after it merges, check the column menu's **Description & default value** and the soft "Required" hint.

## Already merged and waiting for a look (2026-10-31)

- **Board sharing (#46):** two accounts. Make a board Private, add the second account as Viewer, confirm read-only access, remove them. Leave board from the board menu.
- **Saved views (#47):** hide a column and save to the view; save on Kanban, Calendar and Timeline views.
- **Change column type (#48):** convert a Progress or Formula column on a test board, then Undo.
- **Polish (#49):** the Time tracked total ticks each second; Add column list is alphabetical; multi-word @mention search in the description; Mirror settings empty state.
- **Earlier:** two-account notifications and @mentions; drag and drop on Calendar and Timeline; Files upload and download; Mirror chips in light and dark.

## Decisions waiting for the owner

- **Button column:** answered (configurable multi-step actions). Slice B, "notify people", is still to build; it needs a new notification kind.
- **Required columns:** I made "Required" a soft rule (a hint, nothing blocked). Tell me if you want a hard rule somewhere, for example when an item moves to Done.
