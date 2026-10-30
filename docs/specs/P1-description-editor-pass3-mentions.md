# P1: description editor, pass 3 (@mentions)

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: "Description editor pass 3: @mentions" (3311534270) · Branch `claude/desc-editor-p3-mentions`

Builds on pass 1 (`P1-description-editor-pass1.md`), pass 2 (`P1-description-editor-pass2.md`) and the notifications inbox (`P4-notifications-inbox.md`, merged in #34 and #37), which already delivers `mention` notifications for updates and replies.

## Goal

Typing `@` in an item description opens a member list. Picking a member inserts a mention chip. When the description is saved, each newly mentioned member gets a `mention` notification in their bell.

## Facts (main after #37)

- The description is `{ doc, text }` on `items/{i}.description` (`packages/shared/src/schemas/item.ts`). `doc` is ProseMirror JSON; `text` is plain text for search, capped at 10,000 characters. The client writes it as a field path.
- The editor is `apps/web/src/components/item-view/DescriptionEditor.tsx`. The slash menu (`item-view/slash-menu/`) is the pattern for a `@tiptap/suggestion` list rendered in `AnchoredPopup`.
- The update composer's picker is `item-card/MentionTextarea.tsx` + `item-card/mentions.ts`. It lists workspace members who can read the board (`useWorkspaceMembers`). Reuse its candidate logic: extract the filter into a small shared helper rather than copying it.
- Server: `functions/src/triggers/onItemPeopleAssigned.ts` is an `onDocumentWritten('boards/{boardId}/items/{itemId}')` that returns early unless `values` changed. `functions/src/lib/notifications.ts` has `deliverNotifications` (actor, role and prefs filtering, deterministic ids `${kind}-${eventId}-${uid}`, `create` only).
- A notification with `updateId: null`, `replyId: null` and `columnId: null` is not tied to an update. The shared schema already allows that, so **no `packages/shared` change is needed**.

## Design decisions

1. **The doc stores the member's uid and the label at insert time**, as a `mention` node `{ type: 'mention', attrs: { id: <uid>, label: <display name> } }`. It never stores a colour or a style (same principle as pass 2).
2. **The server reads mentions from the saved doc, not from a client list.** It walks `after.description.doc` for `mention` nodes and diffs the uid set against `before.description.doc`. This means a mention can't be forged separately from the visible text, and the recipient filter (can read the board, not the actor, prefs on) still applies as for updates.
3. **Only newly added uids notify.** Editing other text, or leaving an existing chip in place, never re-notifies. Removing a chip and adding it again later does notify again; that is acceptable.
4. **No new Cloud Function** (each adds about 0.5 vCPU to the deploy peak, see `BUG-deploy-cpu-quota.md`). Extend the existing items trigger: it already receives every item write. The function's name is now narrower than its job; add a doc comment, keep the exported name.
5. **Notification shape:** `kind: 'mention'`, `updateId: null`, `replyId: null`, `columnId: null`, `snippet` = the first 200 characters of `description.text`, `itemName` from the item. The actor is `after.updatedBy`. If the item has no `updatedBy`, skip (never guess).
6. **Autosave is frequent**, so the trigger fires often. Keep the early return cheap: return with no reads unless `description` changed, and do the board read only when the diff has a new uid.

## Web

1. Add `@tiptap/extension-mention` (MIT, same major and minor as the other TipTap packages) and run `pnpm licenses:notices`.
2. **Extension** (`item-view/mention/`): configure `Mention` with `@tiptap/suggestion`, trigger `@`, a list of up to 8 members filtered by what is typed (case-insensitive, name or email local part), keyboard Up, Down, Enter, Tab and Esc like the slash menu. The list shows the avatar and name. No members match: show "No members found".
   - Candidates: workspace members who can read the board, excluding nobody (mentioning yourself is allowed; the server drops it).
   - The editor needs the board's workspace id; `DescriptionEditor` already receives `boardId`. Resolve members the same way `MentionTextarea` does.
3. **Rendering:** the node renders as `<span data-type="mention" data-id=...>@Name</span>`, styled with the same primary-colour treatment as `MentionedText.tsx` in the update feed (tokens only, in `DescriptionEditor.module.css`). Keep it non-editable and atomic (backspace removes the whole chip).
4. **Clear formatting, copy and paste:** a pasted chip within Atrium keeps its attributes. Pasted HTML from elsewhere never creates a mention (parse rules accept only our `data-type="mention"` with a `data-id`).
5. **Read-only viewers** see the chips but get no suggestion list.
6. `docToText` (`item-view/description.ts`) writes a chip as `@label`, so search and the 10,000-character cap see it.
7. **Toolbar and slash menu:** add an "@ Mention" entry to the "/" menu that inserts `@` and opens the list. No toolbar button.
8. **Notification panel and deep link:** a `mention` notification with no `updateId` shows "Mentioned you in a description" and opens the item (no update to scroll to). Update `NotificationCard.tsx` and the click handler in `NotificationsPanel.tsx`.

## Functions

- `functions/src/lib/notifications.ts`: add `mentionedUidsOf(doc: unknown): string[]` (recursive walk, unique, only string `attrs.id`, capped at `NOTIFICATION_LIMITS.mentions`) and `notifyDescriptionMentions(store, event)` which diffs before and after, returns 0 early when nothing is new, and calls `deliverNotifications` with `candidates` of kind `mention`. The store interface already has everything it needs.
- `functions/src/triggers/onItemPeopleAssigned.ts`: after the existing `values` handling, also call `notifyDescriptionMentions` when `description` changed. Do not read anything when neither `values` nor `description` changed.
- Event id: the trigger's `event.id`, as for the other kinds.

## Tests

- **Functions (fakes, like `notifications.test.ts`):**
  - `mentionedUidsOf` finds nested chips, ignores other nodes and non-string ids, de-duplicates;
  - a new chip notifies once with the right snippet and `updateId: null`;
  - an unchanged chip, a removed chip, a self mention, a non-member and a disabled `mention` pref notify nobody;
  - a description edit that adds a second chip notifies only the new one;
  - a retried event creates the same id once;
  - no description change means no reads.
- **Web:**
  - typing `@ja` lists matching members; Enter inserts the chip with `id` and `label`;
  - the chip is atomic (one backspace removes it);
  - pasting foreign HTML with `data-type="mention"` but no `data-id` does not create a chip;
  - read-only shows chips and no list;
  - `docToText` includes `@label`;
  - the panel shows "Mentioned you in a description" and opens the item without an update target.
- **Visual:** extend the full-view seed with one chip; add the suggestion list open to the screens, light and dark. Regenerate baselines with the workflow, not by hand.
- **Showcase:** add a chip to one showcase item description if the seed has descriptions (extend `scripts/showcase/data.mjs`); keep the showcase tests green.

## Out of scope

Team mentions, mentioning by email, mentions in other rich-text fields (long text columns), and editing or hiding notifications once sent.

## Verify

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build`. Hot spots: none touched (no rules, shared or `tokens.css` change expected; if a colour token is missing, add one named token to `theme/editor-tokens.css`, not `tokens.css`). After the merge, Ophelia does the live two-account check with the owner.
