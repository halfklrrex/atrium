# 2026-10-31 (evening): Ophelia: activity backend and polish batch 2 merged

Follows `2026-10-31-ophelia-p4b-and-owner-feedback.md`. Short session, run on very little usage: only reviewed and merged.

## Merged and deployed

- **#58 Activity log backend.** Events, board and item triggers, `boards/{id}/activity` readable by everyone who can read the board (clients still can't write it), indexes, and a legacy-activity migration script. Spec: `docs/specs/P4-activity-audit-log.md`.
  - **Rules change:** every client board update must send `updatedBy == uid()`. Web writers were updated in the same PR, and a follow-up fix stamps it when deleting a folder re-parents its boards. Any new client board write path must send `updatedBy`, or the rules refuse it.
  - **Not run:** `scripts/migrations/2026-11-delete-legacy-activity.mjs`. Dry run first; run on production only when the owner agrees.
- **#57 Polish batch 2.** Submenu scroll, sticky Timeline bar names, the save-view toast shows the error code, a real `Loading…` assertion. Merged on the passing workflow-dispatch CI run (the pull-request run was blocked after the baselines commit, as expected).
- `main` CI and Deploy were green on `chore: update visual baselines` (8e7ee80).

## Next, in this order

1. **Start of session:** delete `docs/specs/P4b-board-sharing.md` by hand in `atrium-cl` (the auto-mode classifier refuses `rm`; the file is already on `main`), then `git pull --ff-only`. Do the usual start-of-session routine.
2. **Activity web UI** (Roadmap 3306251299): item "Activity" tab and a board-level log. The spec's PR split is in `docs/specs/P4-activity-audit-log.md`. Web-only, no hot-spot files, so it can run alongside anything else.
3. **Button column first slice** (3306219470): "set another column to a value", then "notify people". Still waiting on the owner's choice; the plan says build the recommended default and note it in the check list.
4. **Column settings sign-off** (3306293031): one small PR (use `validateCell`; emptiness for vote and long_text), then In review.
5. Bug sweep: the 🐞 Bugs group has about 15 old items whose statuses were not re-checked. Confirm which are still open.

## Owner to-do

- Live check of the `updatedBy` rule: delete a folder that has boards, edit a column, change a group, rename a board.
- Everything in `docs/plans/owner-check-list.md`, and the Button decision.

## Gotchas

- The Roadmap column-values query returned empty when I passed guessed column ids; call `get_board_info` with `filters.columns.only` first for the real ids.
- Roadmap items were not updated this session (no Status or Actionable changes).
