# 2026-11-17 Claude: Teams PR 3 (teams in People cells, My Work, notifications)

Branch `claude/teams-3-people`, spec `docs/specs/TEAMS-teams-and-profiles.md` (PR 3).

## Done

- `assigneeTeamIds` index field: `assigneeTeamIdsOf` and `itemIndexFields` (shared), `syncItemIndexFields` (Functions, same single read and single write), the backfill script, the composite index (`assigneeTeamIds` CONTAINS + `state`). Clients still can't write it (rules tests).
- People picker "Teams" section, team avatar in cells, deleted team shown as "Deleted team", Person quick filter and the conditions builder offer teams, group by People gives a team its own group, CSV and Excel write the team name (`data/person-or-team-name.ts`).
- My Work: a second per-board listener on `assigneeTeamIds array-contains-any <my teams in that workspace>` (at most 30), merged by item id, "via <team>" tag.
- Notifications: `addedTeams` and `teamMemberCandidates` expand an added team into one `assigned` notification per member (actor excluded, direct entry wins, 50 people cap, teams read only when a team was added); `viaTeamId` and `viaTeamName` on the notification; card reads "Assigned you (via Kids) to an item".
- Showcase: team "Website crew" (owner only) assigned on "Design new pricing page".

## Order of deploys (index first)

1. Merge and deploy the index (`firestore.indexes.json`) and the Functions. Wait until `gcloud firestore indexes composite list --database=atrium-1 --project=atrium-board` shows the new `items` index as `READY`.
2. The web query for My Work fails (and My Work drops only the team part) until the index is `READY`.
3. Run the backfill (dry run first, owner approval for `--apply`).

## Gotchas

- Showcase fake people aren't workspace members, so the showcase team holds only the owner (a team may only hold current members).
- Items assigned to a team before the backfill don't show in My Work until edited or backfilled.
