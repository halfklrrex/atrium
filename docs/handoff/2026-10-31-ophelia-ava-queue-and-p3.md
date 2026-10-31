# 2026-10-30 to 2026-10-31: Ophelia (Opus 5.5): notifications UI, Ava's queue, @mentions, Calendar, Timeline, Mirror, change column type

Ava is on a break with no end date, so Ophelia works alone. This session landed the notifications UI, took over everything Ava left, and built the next group of epics with Sonnet subagents (one worktree and branch each; Opus specs, reviews and merges).

## What landed (all merged and deployed, newest last)

- **#36** handoff note for 2026-10-30.
- **#37 Notifications bell UI** (P4 PR 2): badge, panel with four tabs, search, person filter, mark read and unread, mark all read, settings dialog, `@mentions` in update and reply composers. Showcase seeds three notifications.
- **#38 Files, Button, Time tracking cells** (Ava's finished "PR B", rebased). Review fix: uploader and session names were raw uids; now names or "Unknown member".
- **#39 Description `@mentions`** (editor pass 3): mention chips in the description; the server reads mention nodes from the saved doc and notifies only **new** uids (no new Cloud Function: `onItemPeopleAssigned` now also handles description mentions). Spec: `docs/specs/P1-description-editor-pass3-mentions.md`.
- **#40 Formula, Dependency, Board relation cells** (Ava's finished "PR C", rebased). `formula` is now `derived: true`.
- **#41 Calendar view** (P3 PR 1) plus the `calendar` and `timeline` view types in shared and rules.
- **#42 Timeline view** (P3 PR 2, web only). A review round fixed the scroll content bleeding into the left gutter.
- **#43 Mirror column** (spec `docs/specs/P2-mirror-web.md`): `mirror` is derived; read in the cell through a shared linked-item session cache (60 s staleness refresh, no live listeners).
- **#44 Change a column's type** (spec `docs/specs/P2-change-column-type.md`, updated): `changeColumnType` and `revertColumnType` callables with a verified snapshot, resumable, 30-day undo, Functions-only `columnSnapshots`.

The showcase on production was re-seeded after each merge (all columns, a Calendar, a Timeline and the linked demo board are there).

## Audit of Ava's work (done)

- Column locks and the time/location cells (her PR A) were already on `main` through rebased copies (#30 and earlier). Her stale branches `ag/column-locks`, `ag/cells-time-location`, `ag/cells-server-actions`, `ag/cells-relations-formula` are fully superseded. Do not push to them; they can be deleted.
- Her Roadmap items (Files, Button, Connect boards, Column settings, Calendar, Timeline) are now Agent = Claude.

## Where things stand

- **Open PRs:** none at the time of writing, except whatever P4b becomes (see below).
- **In progress: P4b board sharing.** Spec `docs/specs/P4b-board-sharing.md` (now in `main` only if its PR merged; otherwise it ships with the PR). A Sonnet subagent builds it in the worktree `D:\DevProjects\Atrium\atrium-cl-wt\p4b-board-sharing` (branch `claude/p4b-board-sharing`, offset 55). Next steps if you find it unfinished: review the diff, push, run the baseline workflow, merge, then the live two-account check.
- **Roadmap (monday):** In review with Actionable = Yes: Notifications & inbox, Files, Button, Connect boards & mirror, Description editor pass 3, Calendar, Timeline, Change a column's type, plus the older owner-review list. Column settings & column permissions (3306293031) is still marked Building and Agent = Claude: the editors landed in the cells PRs and locks in #30, so it probably just needs a check against its spec and a sign-off.

## What to check live (nothing below has been exercised by a human or against deployed Functions)

- **Two accounts:** assign, reply and @mention (bell), and mention in a description. The trigger logic is covered only by fake-based tests.
- **Drag and drop** on Calendar and Timeline (pointer drag, resize, "+N more"), tested only in jsdom.
- **Files upload and download, time tracking start and stop, the Button**: the callables are deployed but I never clicked them on the live site.
- **Change a column's type** on a test board: text to Status and back, then Undo. It ran end to end on the emulator with 1000 items and with crash injection, not against production.
- **Mirror** chips and totals in light and dark.

## Decisions to log on the Decisions board (not done yet; the board is for the owner and lead)

- Notifications: server-written, deterministic ids, server-side recipient filter, explicit mention ids, denormalised display fields, preferences, 180-day retention (listed in `docs/specs/P4-notifications-inbox.md`).
- Description mentions: the server trusts the saved doc, not a client list.
- Mirror is derived and computed in the cell; no sort, filter or group on it in v1.
- Change column type: snapshot-first, stale-takeover after 10 minutes, locked columns owner-only.

## Tech debt and polish noted

- `formula.compute` in `packages/shared/src/columns/formula.ts` has a redundant lookup for an identical expression in another formula column (harmless).
- `computeMirror` keys `targetColumns` by column id only; two linked boards that use the same id with different types would clash.
- Timeline: a bar name that starts off-screen is clipped at the pane edge instead of sticking.
- `tests/visual/src/screens.spec.ts` line about `'Loading…'` has a corrupted ellipsis (U+FFFD) that has been there since before this session, so the assertion is vacuous.
- The calendar and timeline visual screens use the Date column only (the roadmap seed has no Timeline column).
- Mirror cells refresh on remount (60 s), not live.
- The "Add column to the right" and "Change column type" submenus run past the bottom of the viewport (about 33 entries).

## Gotchas learned

- **Never pass non-ASCII text through a Windows Python script** to write a test file: an en dash became U+FFFD and failed a visual test. Use the Write tool or `\u2013` escapes.
- **Playwright and Vibe menu items:** a submenu item ignores a click that arrives together with the pointer move. `await item.hover(); await item.click();` in visual tests.
- **Rebase merges** change SHAs: when a stacked branch (Timeline on Calendar) is rebased after its base merges, git drops the duplicate commits; the push then needs `--force-with-lease` on your own branch only.
- **Baseline workflow:** the first PR CI run fails the visual job until the baselines workflow has pushed its commit; wait for the CI run on that commit. The workflow's own run can finish without a commit when no screenshot changed.
- **Untracked draft specs in the home copy** break `git merge --ff-only` once the same file merges. Delete the draft after the subagent has copied it into its branch.
- **Hot-spot discipline worked:** Calendar (rules, shared), Mirror (shared flag), Change column type (shared, rules, indexes) and P4b (shared, rules tests) ran strictly one at a time; web-only work (Timeline) ran alongside.
- **Offsets in use** for worktrees: 20, 40, 45, 50, 55, 60, 70, 80, 90 (old ones can be removed; I could not remove the merged worktrees myself because the auto-mode classifier denied the removal, so `git worktree list` still shows them).
- **Subagent habits to correct in review:** they report "green" from jsdom; always ask what ran in a real browser. This session that caught raw uids shown in two popups, a corrupted test string (which I first misread as a date problem), content bleeding into a gutter and a test that never clicked a Vibe submenu properly.
