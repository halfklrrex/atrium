# Owner check list

Live checks only the owner can do, collected per feature while agents build ahead (see `2026-10-31-build-ahead-batch.md`). Agents append a section when a feature merges and tick off what they verified themselves. Delete a section once the owner has signed it off on the Roadmap.

## Bulk edit v2: range select and immediate apply

On a scratch board, not your real boards:

- **Range select:** tick one row, then shift+click the checkbox of another row several rows below it. Everything in between is selected, including across a group boundary, and a collapsed group's rows are skipped. A plain click moves the starting point.
- **Bulk edit:** with 3 or more rows selected, change a Status on one of them. All selected rows change at once, with no popup. A toast says "Updated N items" with Undo (a slow write first shows "Updating N selected items" with a spinner). Undo puts every value back in one go.
- **One row:** deselect down to one row (or edit a row that is not selected): only that row changes.
- Try it in light and dark and compare with the monday recording.

## P5e fix: automation builder pickers (web)

- **What changed:** every blue blank in the recipe builder now opens a visible list or editor above the Automation center, and long lists are no longer cut off.
- **To check (showcase board, Automate, Create from scratch, light and dark, after a hard reload):** every blue blank opens a visible list or editor and the choice sticks: trigger column and label, condition value, action column, a status / people / date value, a create-item value, a notify person. A list with nothing to choose from says "Nothing to choose from" instead of showing a blank panel.
- **Manage:** save a test recipe switched off, see its row highlighted in Manage, then delete it.

## Site admin, the gate (ADMIN-1b) - DO NOT MERGE until you say so

- **What it is:** the rules start refusing everyone whose sign-in token lacks the approved claim. Everyone already has it (backfill applied, verified), so nothing should change for you.
- **Before the merge:** confirm the backfill dry run still says `to change 0`.
- **After the merge and deploy:** (1) the Actions deploy is green; (2) sign out and in once and check the app loads your workspaces and boards as before; (3) if anything shows empty or errors, tell the agent to revert the PR (the claims stay harmless).
- **Testing the pending screen with a second Google account:** `ACCOUNT_APPROVAL_REQUIRED=true` is set by the committed file `functions/.env.atrium-board`, so it goes live when the PR that sets it is merged to `main` and CI deploys. To switch it off, merge a PR that sets it to `false`. Sign in with the second account: it must show "Waiting for approval" and nothing else. Approve it in `/admin`: it enters without a reload. Block it: it is signed out. Then decide whether to leave the flag on (the intended end state).
- Full rollout order and rollback: `docs/specs/ADMIN-site-admin-role.md`, section "ADMIN-1b".

## Site admin, web (ADMIN-3)

- **Nothing is visible yet:** the waiting and blocked screens only appear for an account whose status is pending or blocked, and the admin screen and menu link only for an account with the `admin` claim. Until `ACCOUNT_APPROVAL_REQUIRED` is flipped, the backfill has run, the rules gate (ADMIN-1b) has shipped and `pnpm admin:grant` has been run for you, every account is approved and the app looks exactly as before. Check that first: sign in as usual and confirm there is no "Site admin" item in the account menu and nothing else changed.
- **To try it once all of that is live:** (1) With the admin claim, open the account menu: "Site admin" opens `/admin` with every account (Pending first), search, the status tabs, Approve, Block (asks "Block <name>? ..." first) and Unblock. A non-admin who types `/admin` sees the "We couldn't find that page" screen. (2) Sign in with a second Google account: it shows "Waiting for approval" with its name and a Sign out button, and no app behind it. You get a bell notification "<name> asked for access" that opens `/admin`. (3) Approve that account in `/admin`: the waiting screen should move into the app within a few seconds without a reload, and that person gets "approved your account" in their bell (clicking it goes nowhere). (4) Block it: it must be signed out, and a new sign-in attempt is refused. Light and dark.

## P5d: time-based automations (web + showcase)

- **Date arrives and Recurring in the builder:** on the showcase board open **Automate**, then Manage, and look at the two new seeded recipes "Due date heads-up" and "Monday review". Their sentences must name the zone, for example "Every Monday at 09:00 (UTC), then create an item ...". They are seeded **off** (with a reason) so nothing fires by surprise; switch one on to try it.
- **Create a "Date arrives" recipe:** Automate > Create from scratch > When "Date arrives": pick Due date, "days before", 3, a time, add a Notify action, and check the "Reads as" sentence shows the zone (your profile zone, else the browser's). Save, then open Manage and check the sentence in the table.
- **Create a "Recurring" recipe:** When "Recurring": try Every day, Every week (pick a weekday) and Every month (day 1 to 28). Check that "Add action" offers only Create item and Notify people, and that the sixth scheduled recipe on a board is refused with "A board can have at most 5 scheduled automations".
- **After the scheduler runs (within 5 minutes of the set time, once the Functions PR is live):** open Manage > Run history. A recurring run shows "Scheduled for <date and time>" instead of an item; a date run shows the item it fired for. Check the created item or the notification arrived.
- **Create tab:** the Dates & deadlines templates (date arrives, overdue, every Monday) are now "Ready" and open the builder prefilled; the "Planned · P5d" badge is gone.

## Required columns as a hard rule (REQ-3, web)

- **Required is now enforced:** on the showcase board the Status column is required. (1) Clear a required cell (select it and press Delete, or pick the empty option): the edit is refused with a toast like "Owner is required" and the cell snaps back. (2) Open a column's menu: under "Required column" a note says how many items are empty ("3 items are empty; they stay as they are but can't be saved empty again"). (3) On an item with an empty required cell, set Status to a Done label: the web app refuses with "Fill in Owner, Due date before setting Status to Done". (4) Optional, needs a second client or the MCP connector: set Done from outside the table; the item should flip to Done for a moment and then be reverted, with an "Atrium" entry in the board's Activity log explaining why (the revert is eventual, not atomic). (5) Mark 10 columns Required, then try an 11th: it is blocked with a warning, because the security rules only check 10. Light and dark. Item creation stays exempt (quick add still works).

## P5c: more triggers and actions (web + showcase)

- **New triggers and actions in the recipe builder:** on the showcase board open **Automate**. Check the two new seeded recipes ("Say it when work lands in Done" on the Item moved trigger with a Post an update action, and "Follow-up for new owners" on the Person assigned trigger with a Create item action). Then create one recipe per new type yourself: a trigger "Item moved" (with a group and with "Any group"), a trigger "Person assigned" (People column, with and without a chosen person), an action "Create item" (name with `{name}` / `{date}`, a group, up to 10 values) and an action "Post an update". Trigger each (move an item to Done, add a person to the Owner cell), then open **Run history** and see an `ok` run; the new item should appear, and the update should show the author "Automations". Check that these two actions are NOT offered in a Button column's settings. Light and dark. The Functions side (P5c-2) must be live for the runs to appear.

## Merged 2026-11-05 (live)

- **Automations (#90 engine, #97 center, #100 builder):** on the showcase board open **Automate**. Check the two seeded recipes ("Heads-up on new items" on, "File finished items" off with a reason). Create a recipe from a starter or from scratch (for example "When Status changes to Done, then notify me"), save it, set an item's Status to Done and open the **Run history** tab: an `ok` run should appear within seconds and the notify action should reach the bell. Also try an off switch, Edit, Duplicate and Delete. Light and dark. Not verified in a browser by the agent (Chrome was not connected).
- **Dashboards (#96, #99, #102):** open the "📊 Showcase overview" dashboard in the sidebar. Check the five widgets (Numbers, Battery, Chart, Table, Workload), adding and editing a widget, dragging and resizing, **Share**, and that a deleted dashboard appears in Trash and can be restored. Light and dark.
- **Forms (#98, #101):** open the "Request intake" Form view on the showcase board. Check the builder (questions, required, thank-you text) and the public form page; its link is closed by default (Accepting responses off), so switch it on to test a submission.

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

- **Dashboard sharing, server-side check (`claude/dashboard-access-callable`):** open a dashboard, **Share**, add a workspace member as editor, change their role, remove them, and switch the type between main, private and shareable. It should look and behave as before. Then try the limits: you cannot make the last owner leave a private dashboard, and a viewer-level workspace member cannot be made editor (a clear message appears). A person outside the workspace cannot be added (they are not in the list).

- **Attachments in updates (`claude/update-attachments-web`):** on the showcase board open an item, write an update, click the new **paperclip** after `@` in the composer's bottom row, pick two files (one image) and post. The files upload one after another and the chips disappear when done; under the post you see a chip per file (the image shows a small thumbnail). Click a chip to download it, then remove one with its **x** (no confirmation, no undo). Try a file over 25 MB (a message names the limit) and an 11th file (limit of 10). Do the same on a reply. Check that the author and a board owner see the **x**, and that a viewer sees the chips and can download but has no **x** (and cannot post). An update still needs some text; files alone cannot be posted. Check light and dark. The showcase seed cannot hold files (they need Storage), so there is nothing to seed.

- **Site admin, Functions (ADMIN-2):** nothing changes for anyone until the Functions param `ACCOUNT_APPROVAL_REQUIRED` is flipped and the rules gate (ADMIN-1b) has shipped. With the param off, a new sign-up is simply stored as approved and given the approved claim. Do not flip it before the backfill, the gate and the web screens are live.

## Owner decisions, 2026-11-05 (answered in the session; work not yet scheduled)

- **Required columns:** a **hard rule** (the server refuses an empty required cell). Needs a spec: rules and `validateCell` changes, rules tests, and how it treats items on existing boards.
- **Flag emoji on Windows (done in PR `claude/flag-emoji-fallback`, display components; the TipTap editor nodes are a follow-up):** add a **CDN picture fallback** (for example Twemoji). Needs a licence entry in `THIRD_PARTY_NOTICES.md` or `docs/PROVENANCE.md`, and a note that it makes an external request.
- **Legacy-activity migration:** a **dry run only** is approved. Run it read-only, report what it would change, and wait for the owner's go-ahead before a real run.
- **Live checks:** the agent checks what it can read-only in Chrome; the owner still does anything that writes data and the two-account notify check.
- **Site admin role** (bug inbox, 2026-11-05, Roadmap item 3335038323): waiting on two questions on the item.

## Decisions waiting for the owner (older, now answered above where noted)

- **Button column:** answered (configurable multi-step actions). Slice B, "notify people", is merged (#72); see its check above.
- **Required columns:** answered 2026-11-05/06 (hard rule: both rules, eventual revert, no bypass). See the REQ-3 check above.
