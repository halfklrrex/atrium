# 2026-11-07 (early hours), Ophelia: gate live, drag fix, Automation center rebuilt

## Merged and live
- **ADMIN-1b the account gate (#143, replaces #138):** the owner said "Ship the gate" in chat. Only `acct == 'approved'` tokens can read or write; `ACCOUNT_APPROVAL_REQUIRED` stays OFF. Verified in Chrome with the owner's session. The owner still has the 2-minute sign-out/in check (monday item 3335038323, In review / Yes). Rollback: revert #143.
- **Favourites drag fix (#145):** dnd-kit's post-drag click listener only stopped propagation, so the browser followed the `<a href>` (full reload, empty-looking sidebar). `dragClickGuard` now cancels the click in a window-capture listener; `useBoardsByIds` is order-independent and incremental; listener errors show "Could not load workspaces / favorites" with Retry; `rememberWorkspace` only for member workspaces. Verified live with a synthetic drag (no reload, order restored).
- **Automation center redesign (P5e WP1 to WP4, #146, #147):** header, Create tab and catalog, Manage tab, Needs attention chip, Run history, sentence builder with Reads-as panel. Gap list: `docs/specs/P5e-fidelity-gaps.md` (including lead decisions: filter button dropped, default Vibe switches, "Turn on" kept, opens on Create). Showcase re-seeded (only the breaker recipe keeps a `disabledReason`). Dark mode checked in Chrome; light mode not yet.
- Also earlier today: Export to CSV (#139), bulk edit of selected rows (#141), 14px view tabs (#140).

## Production facts
- The Functions runtime account needs `roles/firebaseauth.admin` (owner granted it); without it `listAccounts` and claim writes fail.
- The monday owner-reply trap: owner replies are threaded under agent updates and are NOT in `get_updates` text; the owner and agents post from the same account (agent updates are prefixed "Ophelia:"). Never treat Actionable = Agents as a sign-off without reading the replies (use a GraphQL query for `replies`, see `all_monday_api`). I closed 22 items wrongly once; an Opus agent reopened 11.

## Open
- Owner checks (monday, Actionable = Yes): gate, favourites drag, Automation center, CSV export, bulk edit, view tabs font, flag emoji on Windows (left In review by the owner's request), P5 items reopened (time-based triggers, event triggers, actions library, templates relabel, post_update author).
- Follow-ups: new-row highlight after saving an automation (`RecipesTab` accepts `highlightId`, nothing passes it), light-mode QA of the Automation center, the popover z-index in the builder (custom list, untested above the modal), Manage sentence chips via `describeAutomationParts`.
- Still waiting on go-aheads: `requiredColumnIds` backfill, legacy activity cleanup, `dateKeys` backfill. Forms: anonymous submissions question unanswered (sign-in only is the default).
- Unstarted epics needing a spec: Teams & profiles, Email notifications, PWA/web push, Docs editor, Map and Files gallery views, print styles, P8 API.

## Gotchas
- Browsers can keep the old JS chunk after a deploy: hard-reload (Cmd+Shift+R) before judging a UI change.
- Force-push is blocked: rebase onto main by opening a replacement PR from a new branch.
- The baselines workflow's push does not trigger CI: push an empty commit after it.
- Cherry-pick parallel work packages onto one branch (conflicts in shared test files) instead of merging them separately.
