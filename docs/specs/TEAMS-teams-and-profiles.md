# TEAMS: teams and user profiles

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: "Teams and user profiles" (Opus creates or updates the item) · Builds on: `docs/specs/P4a-workspace-membership-invites.md`, `docs/specs/P3-my-work-global-search.md`, `docs/specs/P4-notifications-inbox.md`, `docs/specs/SETTINGS-layout-a.md`, `docs/specs/PRIVACY-1-notice-and-complaints.md` · Status: spec, nothing built

## Goal

Atrium is used by a family and a few friends. Two things they ask monday-style tools for and Atrium can't do yet:

1. **Teams:** assign an item to a group of people at once ("Kids", "Parents", "Garden crew") instead of picking each person, and see "my team's" items in My Work. The People column value already allows `{ id, kind: 'team' }` (monday's `personsAndTeams` shape), but nothing creates teams and the web only writes `kind: 'person'`.
2. **User profiles:** a small "who is this" card when you click someone's avatar: name, photo, a title, a short "about", where they are and their local time, and the teams they belong to. Today the only person data members see is the name, photo and email copied into `workspaces/{ws}/members/{uid}`.

Everything here is Firestore, rules, Cloud Functions and web code. **No secret, no paid provider, no IAM change, no new dependency.**

## Decisions this spec makes (the owner can overrule them)

- **Teams belong to a workspace**, not to the whole site. Atrium has no "account" level, People cells already pick from the board's workspace members, and a family usually has one shared workspace. A team in workspace A can't be assigned on a board of workspace B.
- **Only workspace owners and admins create, edit and delete teams.** Every member sees them and can assign them. (monday lets admins choose; this is the safe default.)
- **A team holds only current workspace members.** Removing someone from the workspace removes them from its teams.
- **Profile fields are few and optional:** title, about, location, birthday (day and month, no year) and "show my local time". **No phone number**: it is the one field that would make the privacy notice materially heavier, and nobody asked for it.
- **Profiles are written through a callable** (`setMyProfile`), not by a direct client write to `users/{uid}`. The callable validates, saves to `users/{uid}.profile` and copies the shared part to the person's member doc in every workspace. Reasoning: `users/{uid}` stays self-read only, the rules for `users` don't change, and there is no Firestore trigger firing on every theme or `lastWorkspaceId` write.
- **My Work includes items assigned to my teams**, marked "via <team>". The board's Person quick filter lists teams after people; picking a person matches direct assignments only (monday's behavior for its person filter).
- **Assigning a team notifies its members** with the normal `assigned` notification (one per person, the actor excluded, at most 50 people per write), so a team assignment is not silent.

## Facts this design rests on (checked against `origin/main` at `de83912`)

- **People value:** `peopleValueSchema` is `{ personsAndTeams: { id, kind: 'person' | 'team' }[] }` (max 200), in `packages/shared/src/columns/people.ts`. `toText` lists ids. The web writes `kind: 'person'` only (`apps/web/src/columns/people.tsx`); `apps/web/src/lib/cell-display-text.ts` already renders a team through `names.teamName?.(id) ?? 'a team'`.
- **Index:** `assigneeUidsOf` (`packages/shared/src/item-index.ts`) keeps only `kind: 'person'` ids. `syncItemIndexFields` (`functions/src/lib/item-index.ts`) maintains `assigneeUids`, `nameTokens` and `dateKeys` on every item from the `onItemPeopleAssigned` trigger. The fields are in neither item key list of `firestore.rules`, so clients can't write them.
- **My Work** (`apps/web/src/data/my-work.ts`): per board, `items where assigneeUids array-contains me and state == 'active'`, re-checked against the board's current columns.
- **Assigned notifications:** `addedPeople` in `functions/src/lib/notifications.ts` compares person ids before and after, per People column.
- **Filters:** `packages/shared/src/filters/engine.ts` matches the Person quick filter and the `people` conditions by `personsAndTeams[].id`, so team ids already work as filter values once the UI offers them.
- **Members:** `workspaces/{ws}/members/{uid}` (`displayName, photoURL, email, role, joinedAt, updatedAt`) is written only by Functions and read by any member (`firestore.rules` around line 394). The web reads it through `useWorkspaceMembers` and `useUserLookup` (`apps/web/src/data/members-store.ts`). Writers: `bootstrapUser`, `createInvite`, `acceptInvite`, `changeMemberRole`, `removeMember`, `leaveWorkspace` (`functions/src/lib/membership.ts`).
- **`users/{uid}`:** self read; self update limited to `timezone, locale, lastWorkspaceId, theme, notificationPrefs` (`firestore.rules` around line 145). Settings > Profile (`apps/web/src/pages/settings/ProfileTab.tsx`) shows the Google identity, the time zone and the user ID.
- **Members dialog** (`apps/web/src/components/membership/MembersDialog.tsx`): tabs "Members" and "Invites".
- **monday reference:** `docs/reference/monday-ui-reference.md` has no Teams or profile-card section. Opus captures monday's team picker section, team avatar and the person mini-card with Claude in Chrome (read-only, owner-approved 2026-10-23) and adds a `## Teams and profile card` section before PR 3's visual QA. Until then the layouts below are the target.

## Scope

- Teams: data, rules and rules tests, a Teams tab in the Members dialog, teams in the People picker, cell and filters, the index field and My Work, notifications, membership cleanup.
- Profiles: the `profile` fields, the `setMyProfile` callable and fan-out, an "About you" card in Settings > Profile, and a profile card on avatar click.
- Privacy notice text for the new fields.
- Showcase: a team assigned on the showcase board.

## Non-goals

- Teams across workspaces, nested teams, team owners other than workspace admins, team pages, team avatars from uploaded pictures.
- Board sharing with a team (board `access` stays per person), automations "assign to team", inviting a team.
- Profile phone, pronouns, cover image, "working status" (out of office), a full profile page. The card is the profile.
- MCP connector tools for teams and profiles (a later MCP gap batch can add `atrium_list_teams`).
- Showing profiles to people who share no workspace with the person.

## Data model

### Teams: `workspaces/{workspaceId}/teams/{teamId}`

```
name: string            // 1 to 60 characters, trimmed
color: string           // '#rrggbb', from the label palette (same choices as group colors)
memberUids: string[]    // unique, at most 100, each a current workspace member
createdAt, createdBy, updatedAt, updatedBy
```

- Shared schema: `packages/shared/src/schemas/team.ts` with `teamSchema`, `teamWriteSchema`, `TEAM_LIMITS = { name: 60, members: 100, perWorkspace: 50 }`, exported from the package index. `perWorkspace` is a client-side limit (rules can't count documents); the dialog disables "New team" at 50.
- Team ids are Firestore auto-ids. A team id never collides with a uid in practice, and every People entry carries `kind`, so code always branches on `kind`, never on the id's shape.

### Profiles

`users/{uid}.profile` (self-only, written by the callable):

```
profile?: {
  title: string | null            // "Mom", "Treasurer", "Designer"; at most 80
  about: string | null            // plain text, at most 500
  location: string | null         // free text, "Lyon", at most 80
  birthday: { month: 1..12, day: 1..31 } | null   // no year; validated as a real date in a leap year
  showLocalTime: boolean          // default false
  updatedAt
}
```

`workspaces/{ws}/members/{uid}.profile` (the shared copy, written only by Functions):

```
profile?: { title, about, location, birthday, timeZone: string | null, updatedAt }
```

`timeZone` is the person's `users/{uid}.timezone` when `showLocalTime` is true, else `null`. Members see the local time computed from it; nobody sees the zone when it is off.

Shared schema: `packages/shared/src/schemas/profile.ts` (`userProfileSchema`, `memberProfileSchema`, `PROFILE_LIMITS`, `memberProfileOf(profile, timezone)` pure). `workspaceMemberSchema` gains the optional `profile`.

### Item index: `assigneeTeamIds`

`boards/{b}/items/{i}.assigneeTeamIds?: string[]`: sorted unique ids of the `kind: 'team'` entries across the item's People columns. Pure `assigneeTeamIdsOf(columns, values)` next to `assigneeUidsOf` in `packages/shared/src/item-index.ts`; `itemIndexFields` returns it too. Maintained by the same `syncItemIndexFields` (one more field in its diff and its single `update`). Like `assigneeUids` it is in neither item key list, so **no rules change** is needed to keep clients out (a rules test proves it). Index hint, not authority: the web re-checks it against the current columns.

## Security rules

New match inside `match /workspaces/{workspaceId}`:

```
match /teams/{teamId} {
  function validTeam(d, ws) {
    return d.name is string && d.name.size() >= 1 && d.name.size() <= 60
      && d.color is string && d.color.matches('^#[0-9a-fA-F]{6}$')
      && d.memberUids is list && d.memberUids.size() <= 100
      && d.memberUids.toSet().size() == d.memberUids.size()
      && d.memberUids.hasOnly(ws.memberIds);
  }
  allow read: if signedIn() && isWsMember(workspaceId);
  allow create: if signedIn() && isWsAdmin(workspaceId)
    && request.resource.data.keys().hasOnly(['name','color','memberUids','createdAt','createdBy','updatedAt','updatedBy'])
    && request.resource.data.keys().hasAll(['name','color','memberUids','createdAt','createdBy','updatedAt','updatedBy'])
    && validTeam(request.resource.data, get(wsPath(workspaceId)).data)
    && request.resource.data.createdBy == uid() && request.resource.data.updatedBy == uid()
    && request.resource.data.createdAt == request.time && request.resource.data.updatedAt == request.time;
  allow update: if signedIn() && isWsAdmin(workspaceId)
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name','color','memberUids','updatedAt','updatedBy'])
    && validTeam(request.resource.data, get(wsPath(workspaceId)).data)
    && request.resource.data.updatedBy == uid() && request.resource.data.updatedAt == request.time;
  allow delete: if signedIn() && isWsAdmin(workspaceId);
}
```

- One workspace `get()` per request (the same document `isWsAdmin` reads, so it counts once).
- **Known limit:** an update that only renames a team still needs every listed member to be a current workspace member. The membership cleanup (below) keeps that true; if a stale uid slips through, the admin's next edit is refused and the dialog says "Someone in this team left the workspace. Remove them and save again." with that person pre-unchecked.
- `users/{uid}` rules: **no change** (the callable writes `profile` with the Admin SDK; `profile` is not in the self-update list, so a client can't forge it). `members/{uid}`: no change (already `write: false`).
- New `tests/rules/src/teams.test.ts`: outsider can't read; member reads; member, viewer and outsider can't create, update or delete; admin and owner can; forged `createdBy`, a non-member uid, duplicate uids, 101 members, a bad color, an extra key are refused; and the item rules refuse a client write of `assigneeTeamIds` on create and update (extend `item-index.test.ts`), and a client write of `users/{uid}.profile` (extend the users tests).

## Cloud Functions

- **`setMyProfile`** callable (`functions/src/callable/setMyProfile.ts`, logic in `functions/src/lib/profile.ts` behind an injected store; region `europe-west1`, default memory, no `minInstances`, owner decision 2026-11-16). Request `userProfileWriteSchema` (the profile without `updatedAt`). Approved callers only (the usual account gate). Steps: validate; read `users/{uid}` for `timezone`; write `users/{uid}.profile`; query `workspaces where memberIds array-contains uid`; update `members/{uid}.profile` with `memberProfileOf(...)` in batches of 400, skipping workspaces whose member doc is missing (they heal on the next `bootstrapUser`). Returns `{ workspaces: n }`. Idempotent.
- **Time zone change:** when the person changes their time zone in Settings and `showLocalTime` is on, the web calls `setMyProfile` again with the current profile (so no trigger on `users`). PR 4 wires this in `ProfileTab`.
- **Member doc writers copy the profile:** `bootstrapUser` (its refresh of up to 20 workspaces), `acceptInvite` and `createInvite`'s self-heal set `members/{uid}.profile` from `users/{uid}` with `memberProfileOf`. Pure helper shared so all paths agree.
- **Membership cleanup:** `removeMember` and `leaveWorkspace` remove the uid from every team of the workspace (`arrayRemove`, in follow-up batches after the transaction, like the board `access` housekeeping). Unit tests in `membership.test.ts`.
- **Index:** `syncItemIndexFields` adds `assigneeTeamIds` (same early return, same precondition, same single write). Migration: extend `scripts/migrations/2026-11-backfill-item-index.mjs` to fill it (dry run unless `--apply`; owner approval for the production run, though a dry run will likely show 0 because no team exists before PR 2 ships).
- **Notifications:** `addedPeople` also expands added team ids: it reads the board's workspace teams once per event (only when a team was added), adds each member as `{ uid, kind: 'assigned', columnId, viaTeamId }`, keeps the person entry when someone is both added directly and via a team, excludes the actor, and stops at 50 people. The notification card reads "Avery assigned you (via Kids) to …" when `viaTeamId` is set. `notificationSchema` gains optional `viaTeamId` and `viaTeamName` (denormalized). Notification rules: check that the new optional keys don't break the users' notification read or the mark-read update (only `read`/`readAt` change); add a test.

## Web

### Teams tab (Members dialog)

```
| Members (6) | Invites | Teams (2) |
|----------------------------------------------------------|
| [K] Kids          3 members   (Ava) (Ben) (Cal)    [...] |
| [P] Parents       2 members   (Dee) (Eli)          [...] |
|                                                          |
| [+ New team]                       (owners and admins)   |
```

- A row: the team avatar (a circle in the team color with the first one or two letters, `TeamAvatar`), the name, "N members", an avatar stack, and a `⋯` menu (Edit, Delete) for owners and admins. Members see the list read-only.
- "New team" and Edit open `TeamDialog`: name, color swatches (the label palette), and a searchable checklist of workspace members. Save writes the team doc (`data/teams.ts` `teamWrites.create/update/remove`). Delete asks "Delete Kids? Items assigned to Kids keep the entry but show 'Deleted team'."
- `useWorkspaceTeams(wsId)`: one cached listener per open workspace, like `useWorkspaceMembers`. `useTeamLookup(wsId)` returns `id -> { name, color, memberUids }`.

### People column, filters and display

- **Picker** (`columns/people.tsx`): a "Teams" section under the people list (hidden when the workspace has no teams), with the same search box. Choosing a team writes `{ id, kind: 'team' }`. "Single person" columns accept a team as their one entry (monday does).
- **Cell:** team entries render a `TeamAvatar` in the avatar stack; the tooltip and `cellDisplayText` show the team name (pass `teamName` from `useTeamLookup`). A deleted team shows a grey avatar with "Deleted team".
- **Person quick filter** (board toolbar): teams listed after people under a "Teams" label. Conditions builder for `people`: team ids offered as values.
- **Group by People:** a team is its own group.
- **CSV and Excel export:** team names through the same name resolver (`cellDisplayText` with `teamName`).
- **My Work:** a second query per board, `items where assigneeTeamIds array-contains-any <my team ids in that board's workspace (at most 30)> and state == 'active'`, only when I belong to a team there. Merge with the person results by item id; a row found only through a team shows a small "via Kids" tag. New composite index in `firestore.indexes.json`: `items` (`COLLECTION`) `assigneeTeamIds` CONTAINS + `state` ASC. The web PR that queries it merges after the index is `READY` (`gcloud firestore indexes composite list --database=atrium-1`).

### Profile

- **Settings > Profile, new card "About you"** under the identity card: Title, About (textarea with a counter), Location, Birthday (month and day selects plus "Clear"), and a switch "Show my local time to people in my workspaces". "Save" calls `setMyProfile`; toast "Profile saved." or the callable's message. Hint text: "People in your workspaces see this on your profile card."
- **Profile card** (`components/profile/ProfileCard.tsx`, an `AnchoredPopup`): opens on click (and Enter) on a member avatar or name in the Members dialog, the update and reply author line, the People picker rows and the board presence avatars. Content: 56 px avatar, name (Poppins), title, "Local time 14:05 (Lyon)" when shared, location, birthday ("Birthday: 12 March"), about, the person's teams in this workspace as chips, and their email with a copy button. Esc closes, focus returns to the trigger.
- Data comes from the member doc (`useUserLookup` extended to return `profile`); no extra read.

## Tokens

New `apps/web/src/theme/teams-tokens.css` (imported in `main.tsx`; **not** `tokens.css`): `--atrium-team-avatar-size-sm`/`-md`, `--atrium-team-avatar-radius` (circle), `--atrium-profile-card-width` (about 320 px), `--atrium-profile-card-avatar` (56 px), with dark values where Vibe's variables don't already switch.

## Privacy

`apps/web/src/pages/privacy/privacy-content.ts` gains: the profile fields (all optional, shown to people in your workspaces), the local time only when switched on, teams (the names and which members belong, visible to the workspace). The notice is checked line by line against the code (PRIVACY-1), so PR 4 updates it in the same PR. When GDPR-2 (download and delete) is built, its export must include `users/{uid}.profile` and the person's team memberships, and deletion must strip the uid from teams (the same helper as `removeMember`); note it in that spec's open items.

## PR breakdown (small, shippable, in order)

Each PR starts from fresh `origin/main` in its own worktree (`/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>`, own `ATRIUM_PORT_OFFSET`).

| #   | Branch                   | Offset | Depends on | Hot spots touched                                                                                                                            |
| --- | ------------------------ | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `claude/teams-1-data`    | 10     | none       | `packages/shared/**`, `firestore.rules`, `tests/rules/**`                                                                                    |
| 2   | `claude/teams-2-dialog`  | 20     | PR 1       | `tests/visual/__screenshots__/**` (new screens only)                                                                                         |
| 3   | `claude/teams-3-people`  | 40     | PR 2       | `packages/shared/**` (index), `tests/rules/**` (index test), `tests/visual/__screenshots__/**`                                               |
| 4   | `claude/profiles-1`      | 50     | PR 1       | `packages/shared/**`, `tests/rules/**` (users test), `tests/visual/__screenshots__/**` (`settings-profile`, `phone-settings-profile` change) |
| 5   | `claude/profiles-2-card` | 60     | PR 4, PR 2 | `tests/visual/__screenshots__/**` (new screen)                                                                                               |

Not touched by any: `apps/web/src/theme/tokens.css`, `firebase.json`, `pnpm-lock.yaml` (no new dependency). `firestore.indexes.json` changes in PR 3 only. PRs 1, 3 and 4 all touch `packages/shared/**`: merge in that order and rebase.

### PR 1: team data, rules, membership cleanup

1. `schemas/team.ts` with tests; export.
2. The `teams` rules and `tests/rules/src/teams.test.ts`.
3. `removeMember` and `leaveWorkspace` strip the uid from the workspace's teams; unit tests.
4. `data/teams.ts`: refs, converter, `useWorkspaceTeams`, `useTeamLookup`, `teamWrites`; unit tests. No UI yet.

### PR 2: the Teams tab

1. `TeamAvatar`, `TeamDialog`, the Teams tab (read-only for members), delete confirmation, the stale-member refusal message.
2. Tokens file.
3. Tests: `TeamDialog.test.tsx` (create, edit, delete, member search, 100-member cap, 50-team cap), Members dialog tab test.
4. Visual: seed two teams in `tests/visual/src/seed.ts`; new screens `members-teams-{theme}` and `team-dialog-{theme}`. No existing baseline should change (the seed adds teams but no screen shows the Members dialog today; if one does, re-run the workflow and explain the diff).

### PR 3: teams in People cells, filters, My Work, notifications

1. `assigneeTeamIdsOf` and `itemIndexFields` (shared, tests); `syncItemIndexFields` writes it; extend the backfill script; rules test that clients can't write it.
2. Composite index in `firestore.indexes.json`. **Merge the index part first or wait for `READY` before deploying the My Work query** (split into 3a, index plus Functions, and 3b, web, if the index build is slow).
3. People picker Teams section, cell rendering, display names in `cellDisplayText`, quick filter, conditions, group-by, exports.
4. My Work second query and "via" tag.
5. `addedPeople` team expansion, `viaTeamId`/`viaTeamName`, notification card copy; tests.
6. Showcase: a team in `scripts/showcase/data.mjs` (created in the showcase workspace by the seeder) and assigned on one row (`docs/showcase.md`, rule 10).
7. Visual: `board-people-team-picker-{theme}` (new). The board seed gains a team assignment only on a new row in a new group if needed, so the `board-*` baselines don't move; if they must, re-run the workflow and explain.

### PR 4: profile fields and Settings

1. `schemas/profile.ts`, `memberProfileOf`, tests.
2. `setMyProfile` callable and `lib/profile.ts` with emulator tests (writes the user doc, fans out to every workspace, skips missing member docs, refuses invalid dates and long text, refuses pending and blocked accounts); export in `functions/src/index.ts`.
3. `bootstrapUser`, `acceptInvite`, `createInvite` self-heal copy the profile; tests.
4. "About you" card; time zone change re-sends the profile when local time is shared.
5. Rules test: a client can't write `users/{uid}.profile` or `members/{uid}.profile`.
6. Privacy notice text.
7. Visual: `settings-profile-*` and `phone-settings-profile-*` change on purpose; re-run the workflow and show the diff.

### PR 5: the profile card

1. `ProfileCard` and its triggers (Members dialog, update author, People picker rows, presence avatars), keyboard and focus handling.
2. Teams chips from `useTeamLookup`; local time from `Intl.DateTimeFormat` with the member's `timeZone`.
3. Tests: `ProfileCard.test.tsx` (fields hidden when empty, local time only when shared, Esc and focus return).
4. Visual: `profile-card-{theme}` (new).

Each PR description: what changed, the Roadmap item, light and dark screenshots for UI work, the baseline diffs, and the model that wrote the code.

## Acceptance checks

1. An owner or admin creates "Kids" with three members; every member sees it in the Teams tab; a member or viewer can't create, edit or delete (UI hidden, rules refuse).
2. A People cell can hold a team; the cell shows the team avatar and name; CSV and Excel show the team name.
3. Assigning "Kids" sends one `assigned` notification to each member except the actor, reading "via Kids".
4. My Work lists items assigned to my teams, marked "via <team>", and drops them when I leave the team.
5. The Person quick filter offers teams; picking one shows only items with that team.
6. Removing a member from the workspace removes them from every team there.
7. Filling "About you" and saving shows the fields on my profile card in every workspace I'm in; local time appears only with the switch on; clearing a field hides it.
8. A client write of `profile`, `assigneeTeamIds` or a member doc is refused by the rules (tests).
9. The privacy notice lists the new fields.
10. No change to `tokens.css`, `firebase.json` or `pnpm-lock.yaml`; no secret, provider or IAM change; tokens only (`pnpm lint`); light and dark compared with the monday capture, gaps fixed or logged in VF.

## What Ophelia (Opus) reviews

- The rules diff: one new `teams` match; nothing else loosened.
- `assigneeTeamIds` and `profile` are written only by Functions; `syncItemIndexFields` still does one read and at most one write.
- The notification expansion is capped, reads teams only when a team was added, and never notifies the actor.
- No profile field reaches a person who shares no workspace with its owner (member docs only).

## Risks

- **Stale team members.** If the cleanup batch fails after a removal, the team keeps a uid and the next edit is refused. The dialog message covers it; a re-run of the removal heals it.
- **`array-contains-any` cap (30).** Someone in more than 30 teams of one workspace sees only the first 30 in My Work. Unrealistic for a family; the query logs a console warning if it happens.
- **Profile fan-out.** A person in many workspaces makes one batch per 400 workspaces; fine at family scale.
- **Index lag.** Items assigned to a team before PR 3's backfill run don't show in My Work until they are next edited or the backfill runs.

## What needs the owner

- Confirm or overrule the decisions above (especially: admins-only teams, no phone field, team notifications on).
- Approve the production backfill run for `assigneeTeamIds` (dry run first; likely 0 items).
- Check live after PR 3 and PR 5 (Roadmap item set to In review with Actionable = Yes): create a team, assign it, see My Work and the notification; fill "About you" and open your card from another account.
- Nothing else: no secret, no paid service, no IAM role.
