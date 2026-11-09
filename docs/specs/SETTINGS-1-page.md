# SETTINGS-1: the Settings page (S1) and the display-name override (S2)

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: "Settings S1: the page" (3341463097) and "Settings S2: display-name override" · Plan: `docs/plans/2026-11-09-next-steps.md` ("Settings page and data protection", items 7 and 10) · Owner decisions: 2026-11-09 (below) · Related: `docs/specs/PRIVACY-1-notice-and-complaints.md`, `docs/specs/GDPR-2-export-and-deletion.md` · Status: spec, nothing built

## Goal

One place for everything about "me": a `/settings` page with five tabs, **Profile**, **Appearance**, **Notifications**, **Account** and **Privacy and data**, linked from the profile menu. S1 is web only and changes no rules. S2 lets a person choose the name other people see, and that name shows everywhere, past content included.

## Owner decisions (2026-11-09, final)

1. **The theme follows the account across devices** (`users/{uid}.theme`). The account value wins at sign-in. (Answer 5.)
2. **A renamed person's new name shows on past updates, replies, activity entries, mentions and notifications too.** (Answer 4, which reverses the planner's default.)
3. Seasonal and country themes are a later Roadmap item, no work now. (Answer 9.)
4. Fonts are self-hosted (done in `20f8d81`), so no setting is needed for them.

## Facts this design rests on (checked against `main` at `88d648f`)

- **Theme today.** `apps/web/src/theme/theme.ts` keeps the preference in a zustand `persist` store (localStorage key `atrium.theme`, `{ state: { preference }, version: 1 }`). `startThemeSync()` runs in `main.tsx` before React renders and puts `light-app-theme`, `dark-app-theme` or `black-app-theme` on `<html>`. The localStorage read is synchronous, so React never renders with the wrong theme, but the HTML paints before `main.tsx` runs, so a dark user can see a light first paint while the bundle loads. `index.html` has a fixed `<meta name="theme-color" content="#edf1fc">`.
- `users/{uid}.theme` exists (`userSchema`, `themePreferenceSchema`), `bootstrapUser` creates it as `'system'` for every account, and the rules already let the owner write it: `allow update` on `users/{userId}` accepts `timezone`, `locale`, `lastWorkspaceId`, `theme`, `notificationPrefs`. Nothing in the web reads or writes it today. **S1 needs no rules change.**
- **The theme switcher** is four `MenuItem`s under a "Theme" title in `apps/web/src/components/AppShell/UserMenu.tsx`.
- **Notification settings** are a dialog, `apps/web/src/components/dialogs/NotificationSettingsDialog.tsx` (bell switches, then `DeviceSection` and `PushSwitches` from `PushSettings.tsx`, device state from `push-device.ts`, including the iPhone "install first" hint). It opens only from the bell panel: `NotificationsPanel.tsx` calls `openDialog({ type: 'notificationSettings' })` from the gear icon and from a menu item.
- `users/{uid}.timezone` and `.locale` are set once by `bootstrapUser` from the browser's hints and are writable by the owner. `timezone` is used by scheduled automations (`useUserTimezone`, P5d). Nothing shows or edits them.
- **About and the source offer:** `AboutDialog.tsx` (version, AGPL source, licence and notices links from `lib/about.ts`), and `LoginPage.tsx` links `SOURCE_REPO_URL`.
- **How names are stored and drawn today** (the basis of the S2 design):

  | Where                                       | Stored                                                                                                                                                                                              | Drawn from                                                                                                                                                                                              |
  | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `workspaces/{ws}/members/{uid}`             | `displayName`, `photoURL`, `email` (Functions only; any member reads)                                                                                                                               | `useUserLookup(wsId)` in `data/members-store.ts`, one cached listener per workspace                                                                                                                     |
  | Updates and replies                         | `authorId`, `authorName`, `authorPhotoUrl` (client writes `user.displayName` from Google at post time)                                                                                              | `UpdatesFeed.tsx`, `UpdateReplies.tsx`: `UserAvatar` with the stored name and `authorLabel(authorId, authorName, uid)`; **no lookup**                                                                   |
  | Mentions in rich posts and descriptions     | TipTap node `{ type: 'mention', attrs: { id: uid, label: name at insert time } }`                                                                                                                   | `RichText.tsx` prints `@{label}`; the description editor prints the label; **no lookup**                                                                                                                |
  | Mentions in plain posts (before P1d)        | the text `@Name` plus `mentions: uid[]`                                                                                                                                                             | `MentionedText.tsx` highlights `@Name` for the **current** names of the mentioned uids (lookup)                                                                                                         |
  | Activity (`boards/{b}/activity`)            | `actorId`, `actorName`, `actorPhotoUrl` (from the member doc at write time), `data.targetUid` + `data.targetName`, People `fromText`/`toText` as names, raw `fromValue`/`toValue` when at most 2 KB | `ActivityRow.tsx`: avatar with the stored name, `activitySentence` uses `actorName` and `targetName`; values drawn with the column's cell when the raw value is stored (the People cell looks names up) |
  | Notifications (`users/{uid}/notifications`) | `actorId`, `actorName`, `actorPhotoURL` from the member doc at send time; `snippet` (text, may contain `@Name`)                                                                                     | `NotificationCard.tsx` (stored name), `notification-filter.ts` (search and the "people" filter use `actorName`)                                                                                         |
  | Inbox threads and messages                  | `senderName`, `authorName` from the token at send time                                                                                                                                              | `components/inbox/MessageList.tsx`, admin list                                                                                                                                                          |
  | Presence (`boards/{b}/presence/{uid}`)      | `displayName` and `photoURL`, which the rules force to equal the token's `name` and `picture`                                                                                                       | presence avatars                                                                                                                                                                                        |
  | Pending invites                             | `invitedByName` from the token                                                                                                                                                                      | invite page and Members dialog                                                                                                                                                                          |

- **Member docs are refreshed from the Google token**: `syncMemberProfiles` (`functions/src/lib/membership.ts`) runs in `bootstrapUser` for approved callers and overwrites `displayName`, `photoURL` and `email` from `actorProfile(actor)` on up to `MEMBER_SYNC_LIMIT` (20) workspaces. `createInviteInTransaction` (`ensureMemberDoc`) and `acceptInviteInTransaction` (`addMember`) also write `actorProfile(actor)`. Activity and notifications copy the name from the member doc (`notifications.ts` `getMemberProfile`, `activity.ts` `getMemberProfiles`), with the stored post name as fallback.
- **Who may read whose profile:** `users/{uid}` is self-only. Member docs are readable by every member of that workspace. Board readers are always members of the board's workspace: `boardRole()` in `firestore.rules` returns null unless `isWsMember(board.workspaceId)`. So anyone who can see an update, reply, activity entry or mention can read the member docs of that board's workspace.
- `UserAvatar` (`components/UserAvatar.tsx`): an explicit `name` and `photoURL` win, otherwise the active workspace's lookup.
- **`inbox_reply` notifications use the recipient's own uid as `actorId`** with `actorName: 'Site Administrator'` (ADMIN-4 T6). Account and inbox notifications use `workspaceId = boardId = 'account'` (`ACCOUNT_NOTIFICATION_REF`, `functions/src/lib/account-admin.ts`). Any name resolution for notifications must skip them, or the card would show the recipient's own name.

## Part S1: the page (web only, no rules change)

### Routes and navigation

- `App.tsx`, inside `AppShell`: `settings` redirects to `settings/profile`; `settings/:tab` with `tab` in `profile | appearance | notifications | account | privacy`; an unknown tab redirects to `profile`.
- **Profile menu** (`UserMenu.tsx`): a new **Settings** item (Vibe icon `Settings`) right under the email title. The four theme items stay as a shortcut (the plan's "a short theme shortcut stays"); they write through the same store, so they sync to the account too.
- **Bell panel** (`NotificationsPanel.tsx`): the gear icon and the "Notification settings" menu item navigate to `/settings/notifications` and close the panel. Remove the `notificationSettings` dialog type from `ui-store.ts` and `DialogHost.tsx`.
- The page title is "Settings" (document title "Settings · Atrium").

### Layout (desktop, tablet and phone)

- Width 768 px and up: a left column of tabs (Vibe `Tabs` / `TabList` in vertical layout, or a `nav` list styled like the admin page tabs if Vibe's vertical tabs do not fit), the panel on the right, a readable max width for the content (token, about 720 px).
- Below 768 px (the mobile pass is under way, `docs/plans/2026-11-09-mobile-audit.md`): **one column**. The tabs become a horizontal tab bar that scrolls sideways inside itself (`overflow-x: auto`, `overscroll-behavior-x: contain`), never the page. Sections stack full width with the 16 px side gutter from tokens, and the page keeps `env(safe-area-inset-bottom)` padding at the bottom. Text inputs and selects use a 16 px font so iOS does not zoom (M1 item 6 adds this globally; if S1 merges first, add the rule scoped to `.settingsPage`). Toggles stay at least 44 px tall rows.
- Tokens only: put new literals in a new `apps/web/src/theme/settings-tokens.css` (imported in `main.tsx`), not in the hot-spot `tokens.css`.
- Each tab is a component in `apps/web/src/pages/settings/`: `SettingsPage.tsx` (routing, tabs), `ProfileTab.tsx`, `AppearanceTab.tsx`, `NotificationsTab.tsx`, `AccountTab.tsx`, `PrivacyTab.tsx`, `Settings.module.css`, each with a test.
- **monday reference:** before building, capture monday's "My profile" page (Personal info, Notifications, Language and region) read-only with Claude in Chrome (owner approved, `CLAUDE.md`) into `docs/reference/monday/` and add a short measured section to `docs/reference/monday-ui-reference.md` (Opus does this; the reference has no profile page yet).

### Profile tab

- Google photo (64 px avatar), the name, the email, all read-only in S1, with the note "From your Google account."
- **Time zone** (include now; no rules change): a select of `Intl.supportedValuesOf('timeZone')` with the current value from `users/{uid}.timezone`, and a "Use this device's time zone" link that fills in `Intl.DateTimeFormat().resolvedOptions().timeZone`. Saved straight away with a field write `{ timezone }`; hint: "Used for scheduled automations." A stored zone that is not in the list stays selected (shown as-is).
- S2 adds the display-name field here (below).

### Appearance tab

- **Theme**: four large radio cards System, Light, Dark, Black (each with a small preview swatch drawn with that theme's tokens), bound to `useThemeStore`. Hint: "Your choice follows your account on every device."
- Room for later: a "More themes" note is **not** shown (no placeholder UI for unbuilt features).

### Theme sync with the account (owner decision 1)

New `apps/web/src/theme/account-theme.ts` with `useAccountThemeSync(uid)`, mounted once in `AppShell` (approved, signed-in sessions only):

1. **First paint without a flash.** Add a tiny inline `<script>` at the top of `<head>` in `apps/web/index.html` that reads `localStorage['atrium.theme']`, resolves `system` with `matchMedia('(prefers-color-scheme: dark)')`, adds the theme class to `document.documentElement`, sets `style.colorScheme`, and sets the `theme-color` meta to the theme's background. Wrapped in `try/catch` (private mode). It must stay byte-for-byte in line with `resolveTheme` and `applyTheme`: a test extracts the script from `index.html`, runs it in jsdom for each stored value and compares with `applyTheme` (`apps/web/src/theme/theme-boot.test.ts`). No CSP header is set today (`firebase.json`), so an inline script is allowed; if a CSP is added later it needs the script's hash.
2. **localStorage is the device cache; the account is the source.** At sign-in the hook listens to `users/{uid}` (`useDocSnapshot(refs.user(uid))`). On the first snapshot:
   - If the account's `theme` differs from the local preference, **the account wins**: `setPreference(doc.theme)` (marked as remote so it is not written back).
   - **One-time adoption for existing users:** every account was created with `theme: 'system'` and nobody could change it, so a person who picked Dark in the menu before S1 would be switched back to System. Rule: if the account's theme is `'system'`, the local preference is not `'system'`, and the device flag `atrium.themeAdopted.<uid>` is absent, write the local preference to the account instead. Then set the flag. (No rules change: the flag lives in localStorage. Two devices with different old choices: the first one signed in wins, the second adopts it.)
3. **Local change** (Appearance tab or the menu): update the store at once (instant), then write `{ theme }` to `users/{uid}` (`userWrites.setTheme`, a new field write next to `notificationWrites.setPrefs`), only when it differs from the last account value; a failure shows the toast "Couldn't save your theme to your account." and keeps the local choice.
4. **Live:** later snapshots that change `theme` (another device) apply it here too.
5. Signed out (login page, the blocked and waiting screens): local value only. Sign-out keeps the local value (the device's last theme).

### Notifications tab

- Move the body of `NotificationSettingsDialog` into `NotificationsTab.tsx` unchanged in behaviour: "In the bell" switches, `DeviceSection` ("On this device", including the iPhone install hint from `push-device.ts`) and `PushSwitches`. Keep `KINDS`, `usePushDevice`, `notificationWrites.setPrefs` and the "saved straight away" behaviour. Delete `NotificationSettingsDialog.tsx`; move its tests to `NotificationsTab.test.tsx`.
- The mobile audit's notification-settings screen (`tests/visual/src/mobile-screens.ts`, `notification-settings`) and the desktop visual `notification settings dialog, push not supported` (`screens.spec.ts`) move to the page (`settings-notifications`), and `mobile-known-defects.json` drops the dialog's entries if they no longer apply.

### Account tab

- "Signed in with Google" and the email; the provider list from `auth.currentUser.providerData` (today always `google.com`).
- **Sign out** (the existing `signOut` from `useAuth`, which also removes this device's push token).
- Site admins only: a line "You are a site admin." (no actions).
- S2 adds nothing here. G2 adds nothing here (deletion lives in Privacy and data).

### Privacy and data tab

- **Privacy notice**: a link to `/privacy` (PRIVACY-1).
- **Download my data** and **Delete my account**: placeholders in S1 ("Coming soon. Until then, use Send feedback → Complaint or data request.", with a button that opens the Feedback dialog on that category once PRIVACY-1 has landed, otherwise on Other). G1 and G2 replace them.
- **Source code**: the `aboutLinks()` source link (AGPL section 13) and **About Atrium** (opens the existing About dialog).

### Further settings: recommendation

| Include now (S1, no rules change)              | Later (each its own Roadmap item)                                                                                                                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time zone (Profile), with "use this device's"  | **Clear this device's offline copy on sign-out** (Firestore `persistentLocalCache` keeps board data in IndexedDB after sign-out; `terminate` + `clearIndexedDbPersistence` + reload). Privacy-relevant on shared computers: first in this list.                      |
| Theme synced to the account                    | Language and date format (`users.locale` exists; needs every formatter in `lib/format.ts` to take it)                                                                                                                                                                |
| Notifications moved here, bell gear links here | First day of the week (calendar, timeline; a new field means a rules change)                                                                                                                                                                                         |
| Source code and About in Privacy and data      | Default start page (Home, My work or a workspace)                                                                                                                                                                                                                    |
|                                                | Keyboard shortcuts help (a read-only list of the shortcuts the app has)                                                                                                                                                                                              |
|                                                | Sign out of all devices (a callable: `revokeRefreshTokens` plus deleting every push token)                                                                                                                                                                           |
|                                                | Reduced motion override (today the app follows `prefers-reduced-motion`)                                                                                                                                                                                             |
|                                                | Working status / out of office (monday has it)                                                                                                                                                                                                                       |
|                                                | Email notifications and digests (its own epic)                                                                                                                                                                                                                       |
|                                                | **Seasonal and country themes** (owner decision 3): extra Vibe-token overlays on top of light and dark (for example winter, a national-day palette), chosen in Appearance; a later Roadmap item, no work now. The Appearance tab's card layout leaves room for them. |

## Part S2: the display-name override

### Design decision: resolve names when drawing, not by rewriting old documents

Two designs could satisfy owner decision 2.

**(A) Resolve at read time (chosen).** Old documents keep the name they were written with, as a fallback only. Wherever a person is drawn, the web looks the uid up in the member docs of the board's workspace (the per-workspace listener `useUserLookup` already holds) and uses the stored copy only when the person is not found.

**(B) A callable that rewrites every denormalised copy.** On rename, find and rewrite `authorName` on every update and reply, `actorName` on every activity entry and on notifications in other people's bells, `targetName`, and the `label` of every mention node inside other people's `contentDoc` and descriptions.

Why A:

- **Correctness.** A is always current, including names that changed through Google (today only the next sign-in's member sync fixes those, and only for new content). B has to find every copy: mention labels sit inside other people's ProseMirror JSON, which no query can find without scanning every item and update, and rewriting another person's post content also changes what they wrote. B also races with posts written during the rewrite.
- **Cost.** A costs no new reads on board screens (the member listener is already open for avatars, people cells and filters). The bell panel opens one member listener per distinct workspace among the loaded notifications (a handful). B costs a write per update, reply, activity entry and notification the person ever touched, on every rename, plus collection-group indexes and a long-running job.
- **Rules.** A reads only what readers can already read: anyone who sees an update or activity entry is a member of that board's workspace (`boardRole()` requires `isWsMember`) and may read its member docs. No new read rule is needed. B needs no new client rules either, but it is a mass Admin-SDK writer over other people's content, which is the kind of code that needs the most review.

So S2 has **no migration and no backfill**: old documents are not touched.

**What still shows the old name (honest limits, documented in the UI help and here):**

- Text, not people: the plain-text `content` mirror of posts (search, snippets), notification and activity `snippet`s, People names inside activity `fromText`/`toText` when the raw value was not stored (over 2 KB) or the column changed type, legacy plain-text posts from before P1d whose text contains `@Old name`, and copies made by copy and paste.
- People who are no longer in the workspace (no member doc): the stored copy, as today.
- Push notifications already delivered, and pending invites' `invitedByName` (they expire after 14 days).
- Text written by other people ("Thanks, Sam!").

### Data model (`packages/shared`)

- `users/{uid}`: `displayNameOverride?: string | null` (1 to 80 characters after normalisation; `null` or absent means "use my Google name") and `profileChanges?: { day: 'YYYY-MM-DD', count: int }` (server-owned rate limit). Add both to `userSchema` as optional. **Neither is in `userProfileUpdateSchema`**, and neither is in the rules' client-editable list, so only the callable writes them.
- `packages/shared/src/profile.ts` (new):
  - `DISPLAY_NAME_MAX = 80`, `PROFILE_LIMITS = { renamesPerDay: 5 }`.
  - `normalizeDisplayName(raw)`: NFC, trim, collapse runs of whitespace to one space, strip control and format characters the way `normalizeInboxText` does (keep ZWJ and ZWNJ), no newlines.
  - `RESERVED_DISPLAY_NAMES`: `Site Administrator` (`INBOX_ADMIN_LABEL`), `Automations` (`AUTOMATION_ACTOR_NAME`, move the constant to shared or repeat it with a test that they match), `Deleted user` (GDPR-2), `Atrium`, `Someone`, `Board member`, `Unknown member`; compared case-insensitively after normalisation. A reserved name is refused with reason `reserved-name`.
  - `effectiveDisplayName({ override, googleName, email })`: override, else Google name, else email, else `''`.
  - `UPDATE_PROFILE_CALLABLE = 'updateProfile'`, `updateProfileRequestSchema = z.object({ displayNameOverride: z.string().transform(normalizeDisplayName).pipe(z.string().min(1).max(80)).nullable() }).strict()`, result `{ displayName: string, membersUpdated: number, complete: boolean }`.
  - Error reasons `reserved-name`, `rename-limit` (shared enum).

### Rules (`firestore.rules`): no change, tests only

The `users/{userId}` update rule's `hasOnly([...])` list already excludes `displayNameOverride` and `profileChanges`, so clients cannot write them. Add rules tests (`tests/rules/src/users.test.ts` or the existing users test file): the owner cannot set, change or remove `displayNameOverride` or `profileChanges`; another user cannot either; the owner can still change `theme` on a document that carries `displayNameOverride`; member docs stay Functions-only.

### Callable `updateProfile` (`functions/src/callable/updateProfile.ts`, logic `functions/src/lib/profile.ts`)

`actorFromRequest(request)` (approved only), `parseInput(updateProfileRequestSchema, ...)`, then:

1. **Transaction on `users/{uid}`:** read it; refuse a reserved name; if the value equals the stored one, skip the write (but still run step 2, so a retry after a partial sync finishes the sync); else check `profileChanges` (reset when `day` is not today, UTC; at most 5 a day, reason `rename-limit`) and write `displayNameOverride` and `profileChanges`.
2. **After the commit, sync the member docs** of **every** workspace the person belongs to (`workspaces where memberIds array-contains uid`, paged by 100, no 20 cap): set `displayName` to `effectiveDisplayName(...)` and `updatedAt` only where it differs (compare first). Uses the existing `MemberProfileStore`, extended with a paged `listAllMemberships(uid)`.
3. **Sync the person's Inbox threads:** `inbox where senderUid == uid` (single-field index): set `senderName`. Messages are not rewritten; `MessageList.tsx` shows `thread.senderName` for sender messages instead of `message.authorName` (they are the same person by construction).
4. Returns `{ displayName, membersUpdated, complete }`. A failure in steps 2 or 3 is logged and returns `complete: false`; the web says "Saved. Some places will show your new name after a moment." and offers Retry (the same call).

Notifications, activity, updates and replies are **not** rewritten (design A).

### Every member-doc writer applies the override

`actorProfile(actor)` in `functions/src/lib/membership.ts` becomes `memberProfileOf(actor, override)`; the callers read `users/{uid}.displayNameOverride` first:

- `syncMemberProfiles` (`bootstrapUser`): read the user doc once (the store gets `getDisplayNameOverride(uid)`); without this, every sign-in would put the Google name back.
- `createInviteInTransaction` (`ensureMemberDoc` heal) and `acceptInviteInTransaction` (`addMember`): the transaction reads the user doc (one more read, before any write).
- `bootstrapUserInTransaction` `createMember` for a brand-new personal workspace: the user doc is read in the same transaction already; use its override if present.
- `inbox.ts` `senderFields` (new threads and replies): use the override when present (read the user doc inside the existing transaction).
- `membership.ts` `invitedByName`: use the effective name.
- Presence keeps the token name (the rules force it); presence avatars resolve through the lookup instead (below).

Unit tests for each: the override wins over the token name; `null` falls back to the token name.

### Web: one resolver, used everywhere a person is drawn

- `apps/web/src/data/people.ts` (new): `usePersonResolver(workspaceId)` returns `resolve(uid, stored?: { name?: string | null; photoURL?: string | null }) => PersonInfo`:
  1. an automation actor (`isAutomationActor`) is "Automations";
  2. the workspace's member doc (`buildUserLookup`), so the **current** name and photo;
  3. the signed-in person themself: their **effective** name (override from their `users/{uid}` doc, read once by a small `useMyProfile()` hook), not the raw Google name;
  4. the stored copy;
  5. `UNKNOWN_PERSON_NAME`.
- **Callers pass the resolved name and photo to `UserAvatar` explicitly** (no change to `UserAvatar`'s "explicit wins" contract, so other callers are unaffected):
  - `UpdatesFeed.tsx`, `UpdateReplies.tsx`: avatar and author label (replace `authorLabel` with the resolver, keeping "You" off: monday shows the name).
  - `ActivityRow.tsx` and `activity-format.ts`: `activitySentence` takes the resolved actor name and resolved `targetName` (by `data.targetUid`); People values keep drawing through the People cell, which already looks names up.
  - `RichText.tsx`: a `mention` node prints `@{resolve(attrs.id, { name: attrs.label }).name}`; `plainText` keeps the label (copy text).
  - The description editor and the update composer: a React node view for the mention node (`ReactNodeViewRenderer`, `apps/web/src/components/item-view/mention/MentionChip.tsx`) that resolves the same way; the stored `label` is not changed.
  - `NotificationCard.tsx` and `notification-filter.ts` (search and the people filter): resolve with the notification's `workspaceId` **only when it is not `'account'`** (account and Inbox kinds keep their stored actor; `inbox_reply` must keep "Site Administrator"). The panel retains the member listeners of the distinct workspaces among the loaded notifications; a listener that fails (the person left the workspace) falls back to the stored name.
  - Presence avatars on the board header (`components/presence/PresenceAvatars.tsx`, `formatPresence.ts`): resolve by uid.
  - `MessageList.tsx`: sender messages show `thread.senderName` (step 3 above).
  - `UserMenu.tsx`: the menu shows the effective name.
- **New writes carry the effective name** as their fallback copy: `UpdatesFeed` and `UpdateReplies` write `authorName` from `useMyProfile()` (today `user.displayName`).
- **Profile tab:** a "Display name" field (`TextField`, 16 px on phones) under the Google name, with "Shown to everyone in your workspaces, on old posts too." and two buttons, **Save** and **Use my Google name** (sends `null`). Live counter "n / 80", reserved-name and limit errors with exact text, Save disabled while unchanged or in flight.

### Tests (S2)

- **Shared:** `normalizeDisplayName` (spaces, control characters, emoji with ZWJ kept, 80 limit after normalising), reserved names (case and spacing), `effectiveDisplayName`, the request schema.
- **Functions:** `profile.test.ts`: write, no-op, rate limit edge (5th rename passes, 6th fails, a new UTC day resets), reserved name, member sync over more than 20 workspaces, partial failure returns `complete: false`, inbox `senderName` sync; `membership.test.ts` and `bootstrap.test.ts`: the override wins in sync, invite, accept and bootstrap; `inbox.test.ts`: sender fields use the override.
- **Emulator e2e** (`tests/rules/src/profile.e2e.test.ts`): rename, then the member docs in two workspaces show it; a second account in one of them reads the new name.
- **Rules:** as above.
- **Web:** `people.test.ts` (resolution order, automations, account notifications not resolved); `UpdatesFeed`, `UpdateReplies`, `ActivityRow`, `RichText` (mention by id, unknown id keeps the label), `MentionChip`, `NotificationCard` (an `inbox_reply` card keeps "Site Administrator"), `ProfileTab` (save, clear, errors).

## Tests (S1)

- `theme-boot.test.ts` (the inline script matches `resolveTheme`/`applyTheme` for each stored value, bad JSON and no storage); `account-theme.test.ts` (account wins; one-time adoption with and without the flag; a local change writes once; a remote change applies without a write-back; a write failure keeps the local choice and shows the toast); `theme.test.ts` unchanged.
- `SettingsPage.test.tsx` (redirects, unknown tab, tab switching keeps the URL in sync), each tab's test, `UserMenu.test.tsx` (Settings item), `NotificationsPanel.test.tsx` (the gear navigates to `/settings/notifications`).
- **Visual:** new desktop screens "settings: profile", "settings: appearance", "settings: notifications, push not supported" in light and dark, and phone screens `settings-profile` and `settings-notifications` in `mobile-screens.ts`; the old notification settings dialog screenshots are removed. Baselines through **Actions → Update visual baselines**, never by hand.

## PR split and order

Branches start from fresh `origin/main` in their own worktree (`/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>`) with their own `ATRIUM_PORT_OFFSET` (10, 20, 40, ...; avoid 30). S1 starts after mobile M1 has merged (the plan's wave 3) so the phone rules exist.

| #   | Branch                        | What                                                                                                                                                            | Hot spots                                        | Depends on    |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------- |
| 1   | `claude/settings-spec`        | This spec (and PRIVACY-1, GDPR-2)                                                                                                                               | none                                             | none          |
| 2   | `claude/settings-page`        | S1a: routes, page, five tabs, Profile (read-only + time zone), Appearance (store only), Notifications moved, Account, Privacy placeholders, menu and bell links | `tests/visual/__screenshots__/**`                | M1 merged     |
| 3   | `claude/theme-account-sync`   | S1b: `index.html` inline script, `account-theme.ts`, `userWrites.setTheme`, adoption rule, tests                                                                | none (baselines only if the first paint changes) | PR 2          |
| 4   | `claude/people-resolver`      | S2a: `usePersonResolver`, `useMyProfile`, every caller listed above, mention node view; no backend                                                              | baselines if a screenshot shows a name change    | PR 2          |
| 5   | `claude/display-name-backend` | S2b: `packages/shared/src/profile.ts`, user schema fields, `updateProfile`, the member-doc writers, inbox sender fields, rules tests, e2e                       | `packages/shared/**`, `tests/rules/**`           | PR 4          |
| 6   | `claude/display-name-ui`      | S2c: Profile tab field, `MessageList` sender name, `callables.ts` `profileCalls`                                                                                | baselines (Profile tab)                          | PR 5 deployed |

- PR 5 shares `packages/shared` and `tests/rules` with the icon-set build (plan item 4): merge them one after the other, the later one rebases.
- PR 5 adds one function (`updateProfile`). Every function adds about 0.5 vCPU to the deploy peak (`docs/specs/BUG-deploy-cpu-quota.md`; 50 are exported today): watch the deploy, re-run once if it hits the quota.

## What Ophelia (Opus) reviews

- PR 3: no flash for a dark user on a cold load (throttled network in Chrome), adoption cannot loop (one write per device and account), the toast on a refused write.
- PR 4: no notification of kind `inbox_*` or `account_*` is ever resolved; automations stay "Automations"; a member who left still shows the stored name.
- PR 5: the override is applied by **every** member-doc writer (search for `actorProfile(` and `displayName:` in `functions/src`); no client can write the new fields (rules tests); the sync is paged and has no 20 cap; reserved names are checked after normalisation.
- All: tokens only (Stylelint and the ESLint rule pass), visual QA in light and dark against the monday profile capture, baselines through the workflow.

## Showcase, provenance, docs

- Showcase: no impact (no board feature or column type).
- Provenance: nothing copied.
- Docs: `docs/architecture.md` §5.1 (`displayNameOverride`, `profileChanges`, theme sync) and §5.2a (member docs carry the effective name, every writer applies the override) in PR 5; a "Settings" line in `HANDOFF.md` after PR 2; owner checks in `docs/plans/owner-check-list.md` (a separate docs PR by Opus).

## Owner checks (production)

1. Profile menu → Settings: five tabs; on a phone, the tabs scroll sideways inside their bar and nothing else scrolls sideways.
2. Appearance → Dark on the computer. Open Atrium on the phone (signed in): it turns dark within a few seconds. Reload the phone: no light flash.
3. The bell's gear opens Settings → Notifications; the switches and "On this device" work as before.
4. After S2: Profile → Display name "Sam (test)", Save. On a board, your old updates, replies, @mentions of you, the Activity log and the bell (on the second account) show "Sam (test)". **Use my Google name** puts it back everywhere.

## Out of scope

- Changing the photo or the email (they come from Google).
- Rewriting stored names (design A) and the honest limits listed in S2.
- Everything in the "Later" column above.

## Risks

- **Theme adoption picks the "wrong" device** for someone who chose different themes on two devices before S1. Low impact (one click to change), and documented.
- **More member listeners in the bell panel.** Bounded by the distinct workspaces among the loaded notifications (page size 50); each is the same cached listener the board uses.
- **Impersonation by display name.** Reserved names block the system labels; two people may still share a name (as in monday). The Members dialog and the People picker keep showing the email under the name.

## Open questions (recommended defaults)

1. Keep the four theme items in the profile menu as a shortcut next to the new Settings item? **Default: yes** (the plan's "short theme shortcut stays").
2. Rename limits: 80 characters, 5 changes a day, the reserved list above. **Default: yes.**
3. Should the time zone be editable in S1 (it only affects scheduled automations today)? **Default: yes**, with "Use this device's time zone".

## Acceptance checks

- [ ] `/settings` redirects to `/settings/profile`; every tab has its own URL; unknown tabs redirect.
- [ ] Profile menu has Settings; the bell's gear and menu item open `/settings/notifications`; the `notificationSettings` dialog type is gone.
- [ ] The Notifications tab behaves exactly like the old dialog (existing tests moved and passing).
- [ ] Theme: account wins at sign-in, one-time adoption works, a change syncs to another device, no light flash on a cold load for a dark user (inline script test passes).
- [ ] Phone (375 and 390 wide): one column, the tab bar scrolls inside itself, no page overflow in the mobile audit, inputs at 16 px, bottom safe-area padding.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build` pass; visual baselines updated through the workflow.
- [ ] S2: a rename shows on past updates, replies, rich and description mentions, activity rows and sentences, and other people's bell cards; `inbox_reply` cards still say "Site Administrator"; clearing it restores the Google name; a sign-in does not put the Google name back on member docs; clients cannot write `displayNameOverride` (rules tests); reserved names and the daily limit are refused with exact messages.
