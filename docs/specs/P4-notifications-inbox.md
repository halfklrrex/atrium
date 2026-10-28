# P4: Notifications and the bell inbox

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: P4 "Notifications & inbox" (3306251850) · Branches `claude/p4-notifications` (PR 1), `claude/p4-notifications-web` (PR 2)

## Goal

monday's bell: a personal list of things that concern **you**, with an unread count on the bell. Version 1 covers the three events that matter most for a family-and-friends workspace:

1. **Assigned:** someone adds you to a People column on an item.
2. **Reply:** someone replies to an update you wrote.
3. **Mention:** someone @mentions you in an update or a reply.

You can read, mark read, mark all read and delete notifications, filter them with monday's four tabs, search them, and turn each kind on or off.

**Out of scope:** email (P4 "Email notifications & digests"), push (P4 "PWA & web push"), team mentions (no teams yet), mentions in item descriptions (editor pass 3 builds on this), automations as a source (P5), subscriptions to items or boards, and per-board mute.

## Reference (monday help centre, "Bell Notifications", read 2026-10-28)

- **Panel:** a right-side panel over the page, titled "Notifications", with "Give feedback", `⋯` and close in the header.
- **Tabs:** All · Unread · I was mentioned · Assigned to me. Under them, a search box ("Search all notifications") and "Filter by person".
- **Card:** a 40px avatar, then a line "**Actor name** [small icon] action". For example "Mentioned you in a reply" or "Replied to your update". Under it, the text snippet, then "just now • Item name" in secondary text.
  - **Unread** cards have a light-blue background (Vibe `--primary-selected-color`). Read cards are white.
  - **Hover:** shows a check button that marks the card read. It stays in the list and turns white.
- **Bell:** a small red circle at the top right with the unread count. Opening the panel doesn't mark anything read.
- **Retention:** notifications older than 6 months are deleted.
- **Settings:** `⋯` → Settings, where each kind can be turned on or off.

## Facts (code at `6c0102d`+, main after PR #32)

- **Panel shell:** `apps/web/src/components/AppShell/NotificationsPanel.tsx` exists, mounted in `AppShell.tsx`.
  - It's a right `<aside id="notifications-panel">` with focus handling, Esc and outside-click close.
  - It has tabs All / Mentioned / Assigned to me (state only), a search box and an "Unread only" toggle (both no-ops), and always shows the empty state. Its header settings and `⋯` buttons call `showComingSoon`.
  - Test: `NotificationsPanel.test.tsx`. Empty-state visual: `docs/specs/VF3-empty-states.md`.
- **Bell:** `TopBar.tsx`, an `IconButton` that toggles `useUiStore.notificationsOpen`, with no badge.
- **Path:** `users/{uid}/notifications/{id}` is reserved in `docs/architecture.md` §5.6. Per-user subcollection rules to copy: `users/{userId}/favorites` and `recents` (`firestore.rules` ~122-150).
- **Updates:**
  - Paths: `boards/{b}/items/{i}/updates/{u}` and `.../updates/{u}/replies/{r}`. Schemas are in `packages/shared/src/schemas/update.ts`.
  - Content is a **plain string** in a textarea. There are no mentions today.
  - Writes are client-only (`apps/web/src/data/updates.ts`). The rules (~558-636) have strict key whitelists. Replies carry no `boardId` or `itemId`; those come from the path.
- **People column:** the value is `{ personsAndTeams: [{ id, kind: 'person' | 'team' }] }`, written as the field path `values.<colId>`. Clearing writes `null`.
- **Triggers:** only `onItemCreated` and `onBoardColumnsWritten` exist; nothing reacts to value changes.
  - Declare triggers like they do: `database: FIRESTORE_DATABASE_ID`, `region: 'europe-west1'`, with `retry: true` for side effects.
  - Every function adds about 0.5 vCPU to a deploy's peak (`BUG-deploy-cpu-quota.md`). The three new functions below bring it to about 13.5 of 20.
- **Member names and photos:** `workspaces/{ws}/members/{uid}` (Functions-written). The web reads them through `useUserLookup`.
- **Functions pattern:** pure logic in `functions/src/lib/<x>.ts` behind a narrow injected interface, Admin adapters in `lib/*admin*.ts`, and fake-based unit tests (`item-seq.test.ts`).

## Design decisions (log on the Decisions board when PR 1 merges)

1. **Functions write notifications; clients never create them.** The rules refuse create. The recipient may only set `readAt` or delete.
2. **One doc per recipient per event**, at `users/{uid}/notifications/{id}`.
   - The id is deterministic, `${kind}-${eventId}-${uid}`, from the trigger's `event.id`. A retried trigger then overwrites the same doc instead of duplicating it.
   - Writes use `create`, and a retry that hits "already exists" counts as done. Never use `set`: a retry must not reset a `readAt` the user has already set.
3. **Recipients are filtered on the server:**
   - never the actor;
   - only users whose board role (`resolveBoardRole`) can **read** the board;
   - only if that kind is enabled in their preferences.

   A forged mention of a non-member therefore notifies nobody, and the rules don't need to check mention ids.

4. **Mentions are explicit ids, not parsed text.** Updates and replies get an optional `mentions: string[]` (uids, max 20, unique). The composer fills it from the @ picker, and the text keeps a readable "@Name".
5. **Denormalised display fields.** Each notification stores `actorName`, `actorPhotoURL`, `boardName` and `itemName` at write time, plus a `snippet` (the first 200 characters of the update or reply). The panel then needs no extra reads. A later rename doesn't rewrite old notifications, as in monday.
6. **Preferences** live on `users/{uid}.notificationPrefs = { assigned: boolean, reply: boolean, mention: boolean }`. Missing means all on. The user can change it, and it's added to the self-update whitelist.
7. **Retention:** a daily scheduled sweep deletes notifications older than 180 days (a collection-group query on `createdAt`).

## Data (PR 1, `packages/shared`)

`packages/shared/src/schemas/notification.ts`:

```
notificationKindSchema = z.enum(['assigned', 'reply', 'mention'])
notificationSchema = {
  kind, actorId: uid, actorName: string ≤ 200, actorPhotoURL: url | null,
  workspaceId, boardId, boardName ≤ 200, itemId, itemName ≤ 500,
  updateId: string | null,          // reply and mention: the update (thread) to open
  replyId: string | null,           // when the event is a reply
  columnId: string | null,          // assigned: the People column
  snippet: string ≤ 200,            // '' for assigned
  createdAt: timestamp, readAt: timestamp | null,
}
notificationPrefsSchema = { assigned: boolean, reply: boolean, mention: boolean } (all default true)
NOTIFICATION_LIMITS = { mentions: 20, snippet: 200, retentionDays: 180, pageSize: 50 }
```

- **`update.ts`:** `mentions: z.array(uidSchema).max(20).refine(unique).optional()` on `itemUpdateSchema`, `updateReplySchema` and both create-input schemas.
- **`user.ts`:** `notificationPrefs: notificationPrefsSchema.optional()`.
- Export everything from the package index. Add unit tests for the schemas (limits, uniqueness, defaults).

## Rules and rules tests (PR 1)

- **`users/{userId}/notifications/{id}`:**
  - read: `uid() == userId`;
  - create: false;
  - update: `uid() == userId`, changed keys only `readAt`, and `readAt` is either `request.time` or `null` (mark unread);
  - delete: `uid() == userId`.
- **`users/{uid}` self-update:** also allow `notificationPrefs`: a map with only the three boolean keys.
- **Updates and replies:** allow the optional `mentions` key on create, as a list of at most 20. It isn't changeable on update (no mention edits in v1).
- **Tests:**
  - the owner reads their own notifications; another user can't read or list them;
  - create is refused for everyone;
  - the owner marks read and unread, and can't change any other field;
  - the owner deletes, and others can't;
  - prefs: the self update is accepted, while wrong keys or non-booleans are refused;
  - `mentions`: accepted up to 20, refused at 21 or as a non-list, and refused when changed on update.

## Functions (PR 1)

Pure logic in `functions/src/lib/notifications.ts`, with an Admin adapter and fake-based tests, like `item-seq`.

1. **`onItemPeopleAssigned`:** `onDocumentWritten('boards/{boardId}/items/{itemId}')`, `retry: true`.
   - Return early, with no reads, unless `values` changed. Then read the board once, and for each column of type `people` diff the before and after `personsAndTeams` person ids. On create, "before" is empty.
   - Added ids become recipients of `assigned`. The actor is `after.updatedBy`, or `createdBy` on create.
   - Skip subitems' parent lookups: a subitem uses its own `subitemColumns` defs when `parentItemId` is set.
2. **`onUpdateCreated`:** `onDocumentCreated('boards/{boardId}/items/{itemId}/updates/{updateId}')`. Each `mentions` id gets `mention`, with the snippet from `content`.
3. **`onReplyCreated`:** `onDocumentCreated('.../updates/{updateId}/replies/{replyId}')`.
   - The parent update's author gets `reply`.
   - Each `mentions` id gets `mention`. If someone qualifies for both, send **one** `mention`, not two.
4. **Shared filter** for all three:
   - drop the actor and duplicates;
   - for each recipient, read the workspace and board once per event and check `resolveBoardRole(board, uid, wsRole)` is not null;
   - read `users/{uid}.notificationPrefs`;
   - read `members/{actorId}` for the actor's name and photo, falling back to the update's `authorName`/`authorPhotoUrl`.
   - Batch the writes.
5. **`purgeOldNotifications`:** `onSchedule('every day 04:00')`, `timeZone: 'UTC'` (like the other schedules). A collection-group query on `notifications` with `createdAt < now − 180d`, deleting in batches of 400.
   - Add the collection-group index exemption or index entry the query needs to `firestore.indexes.json`.
6. Export all four from `functions/src/index.ts`. Every trigger sets `database: FIRESTORE_DATABASE_ID` (`scripts/database-id.test.mjs` checks this).

**Unit tests:**

- assigned: add, remove (nothing sent), self-assign (nothing), a non-member (nothing), a disabled pref (nothing), and a create with a pre-filled people value;
- reply to your own update (nothing) and to someone else's;
- mention plus reply deduplicates to one;
- a retry writes the same id once (`create` already exists → no error);
- the purge deletes only old docs.

## Web (PR 2, `claude/p4-notifications-web`, after PR 1 merges)

1. **Data** (`apps/web/src/data/notifications.ts`):
   - a live query of the user's notifications ordered by `createdAt desc`, `limit(50)`, with "Load more" pagination;
   - a live unread count from `where('readAt', '==', null)` with `limit(100)`, shown as "99+" above 99. Add the composite index;
   - writes: `markRead(id)`, `markUnread(id)`, `markAllRead()` (batched, the loaded unread ones), `remove(id)`, and `setPrefs(prefs)` on `users/{uid}`.
2. **Bell badge:** a red count circle on the bell (Vibe `Counter`, or a token-styled badge), hidden at 0. The bell's `aria-label` includes the count ("Notifications, 3 unread").
3. **Panel** (fill `NotificationsPanel.tsx`, keeping its focus and close behaviour):
   - tabs **All · Unread · I was mentioned · Assigned to me**, replacing the "Unread only" toggle;
   - the search filters the loaded notifications by actor, item, board or snippet, and highlights matches with `Highlight`;
   - "Filter by person": a dropdown of actors present in the list;
   - the card layout from the reference. Action text: "Assigned you to an item", "Replied to your update", "Mentioned you in an update" / "in a reply";
   - unread cards use `--primary-selected-color`; hovering shows a check (mark read) and a `⋯` with mark unread and delete;
   - clicking a card marks it read and navigates to `/boards/{boardId}/items/{itemId}`, opening the item view. For reply and mention it opens the Updates tab with that update scrolled into view;
   - `⋯` in the header: "Mark all as read" and "Notification settings" (a small dialog with the three switches, using `ui-store`'s `dialog`). The settings icon opens the same dialog;
   - the empty states stay (VF3), with a per-tab message ("No unread notifications").
4. **@mentions in the composer** (`UpdatesFeed.tsx`, the reply composer in `UpdateReplies.tsx`):
   - typing `@` opens a small `AnchoredPopup` list of the workspace members who can read the board (`useWorkspaceMembers`), filtered as you type;
   - picking one inserts "@Display Name " into the text and adds the uid to the `mentions` sent with the create. Ids whose "@Name" was deleted from the text before sending are dropped;
   - rendered updates show "@Name" in the primary colour wherever a mentioned member's name appears after an @.
5. **Tests:**
   - the data hooks with a mocked Firestore;
   - the panel: tabs filter, search, mark read on hover and on click, navigation target, mark all read, settings dialog;
   - the badge: 0 hidden, "99+";
   - the composer: the @ list filters, picking inserts and records the id, deleting the text drops the id.
6. **Showcase and visual:**
   - seed three notifications for the showcase owner, one of each kind, unread and read mixed, so the owner sees a populated panel;
   - add a visual screen `notifications-panel` (light and dark) next to the existing empty one.

## Not in these PRs

Email, push, desktop notifications, team mentions, description mentions (pass 3), item and board subscriptions, per-board mute, automation notifications, an "Inbox" (update feed) page, and editing mentions after posting.

## Verify (each PR)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build`.
- **PR 1:** emulator check with two users. User A assigns user B, and B's `users/{B}/notifications` gets one `assigned` doc. A replies to B's update, then mentions B, and B gets one doc per event.
- **PR 2:** visual QA against the reference in light and dark, and the Linux baselines through the workflow.
- **After the PR 2 merge,** Ophelia does a live two-user check and re-runs the showcase.
- **Hot spots:** PR 1 changes `firestore.rules`, `tests/rules/**` and `packages/shared/**`. Open it only while no other PR touching them is open (Ava's Calendar PR 1 touches the same files).
