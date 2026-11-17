# 2026-11-17 Claude: Profiles PR 5 (the profile card)

Branch `claude/profiles-2-card`, spec `docs/specs/TEAMS-teams-and-profiles.md` (PR 5).

## Done

- `components/profile/`: `ProfileCard` (an `AnchoredPopup`), `ProfileLink` (a button that opens the card, plain children for automations), `profile-format.ts` (birthday, local time and city from the IANA zone; a bad zone gives no line instead of an error).
- `useUserLookup` now returns the member's shared `profile` (`PersonInfo.profile?`). The card reads only the member doc and the cached teams, no extra read.
- Triggers: Members dialog rows, update and reply authors (Updates feed), People picker rows (the avatar is its own button next to the option), presence avatars. `MembersDialog` is wrapped in `PopupLayer`, otherwise the card paints under the modal.
- Fields are hidden when empty; the local time line shows only when the member doc carries a `timeZone` (the callable writes it only when the switch is on). Teams chips come from `useWorkspaceTeams`, email has a Copy button.
- Focus: the card takes focus on open, Escape closes only the card and returns focus to the trigger.
- Visual: `profile-card-{light,dark}` (new), opened from the Members dialog. The seed gains a member doc for the signed-in person with a profile (and `clearSeededData` removes it).
- Tests: `ProfileCard.test.tsx`, a Members dialog test.

## Gotchas

- The shared type is `MemberProfile` (not `MemberSharedProfile`).
- The card shows the city from the time zone name ("Paris"), because only the zone is stored, not a free-text city.
- Birthday reads "March 12" (American order), not "12 March" as the spec example.
- `pnpm test:visual:update` hardcodes `--project=chromium --project=mobile-webkit`; to run one project use `pnpm --filter @atrium/visual-tests exec playwright test --project=<name>`.
