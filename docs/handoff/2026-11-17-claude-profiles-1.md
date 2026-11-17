# 2026-11-17 Claude: Profiles PR 4 (profile fields and setMyProfile)

Branch `claude/profiles-1`, spec `docs/specs/TEAMS-teams-and-profiles.md` (PR 4).

## Done

- Shared: `schemas/profile.ts` (`PROFILE_LIMITS`, `birthdaySchema` validated in a leap year, `userProfileWriteSchema` strict and trimming, `userProfileSchema`, `memberSharedProfileSchema`, pure `memberProfileOf`, `SET_MY_PROFILE_CALLABLE`). `userSchema.profile` and `workspaceMemberSchema.profile` are optional. The member type is named `MemberSharedProfile` because Functions already has a `MemberProfile` interface.
- Functions: `setMyProfile` callable (europe-west1, default memory, no `minInstances`, approved callers only through `actorFromRequest`). Logic in `lib/profile.ts` behind a `ProfileStore`; Firestore adapter in `lib/admin-profile.ts`. It writes `users/{uid}.profile`, then copies the shared part (time zone only when `showLocalTime`) to every workspace member doc that exists (batches of 400, missing member docs skipped).
- Self-heal: `bootstrapUser` (up to 20 workspaces), `acceptInvite` and `createInvite` call `syncProfileToWorkspaces` after their work (best effort, only writes when the member doc differs and the person saved a profile). It is a post-step, not part of the membership transaction, so `membership.ts` and its fakes are untouched.
- Web: "About you" card (`AboutYouCard.tsx`, `profile-form.ts`) on Settings > Profile; changing the time zone re-sends the profile when `showLocalTime` is on.
- Rules: no change. `tests/rules/src/profile.test.ts` proves a client can't write `users/{uid}.profile` or `members/{uid}.profile` and who can read them.
- Privacy notice: profile fields, teams and the wider "who can see it" line; date 17 November 2026; "favourite" fixed to "favorite".
- GDPR-2 spec: open question 6 (export and deletion must cover the profile and team memberships).

## Gotchas

- Vibe `TextField` renders `id="input"` unless you pass `id`: two fields in one form share a label target. `AboutYouCard` passes `useId` ids.
- Vibe `Button` disabled state is `aria-disabled`, not the `disabled` attribute (tests use `toHaveAttribute('aria-disabled', 'true')`).
- New callable `setMyProfile`: after the first deploy check its public invoker binding (delete and recreate it if missing).

## Next (PR 5)

Profile card reads `members/{uid}.profile` through `useUserLookup` (extend it to return `profile`) and `useTeamLookup`.
