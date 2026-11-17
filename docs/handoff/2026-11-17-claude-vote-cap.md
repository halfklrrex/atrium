# 2026-11-17 Claude: vote column cap everywhere

Follow-up to vote integrity (#279). The rules check only the first 10 entries of `boards.voteColumnIds` (`VOTE_COLUMN_RULE_CAP`) and refuse writes to an 11th, so an 11th vote column would be unusable.

## What changed

- `@atrium/shared` (`derived-ids.ts`): one helper `voteCapExceeded(toType, board)` (columns and sub-item columns together) and one message `VOTE_COLUMN_CAP_MESSAGE` ("A board can have at most 10 vote columns.").
- Web: `vote-cap.ts` now delegates to the shared helper (add and duplicate column paths unchanged); the message is shorter and shared.
- `changeColumnType` Cloud Function logic: a new conversion (not a resume) to `vote` is refused with `failed-precondition` and the shared message when the board already has 10 vote columns. The web shows it through its existing error toast. Undo of a type change is not capped (it restores an earlier state).
- MCP `addColumn`: refuses `vote` past the cap with the shared message. Note that `vote` is not in `CREATABLE_COLUMN_TYPES` today, so this is a guard for when it becomes creatable; the MCP has no change-type tool.
- No rules change: the rules already fail closed; the cap is enforced in clients and the callable.

## Gotchas

- A direct client write to `columns` (as the architecture doc's residual risk notes) can still exceed the cap; the rules stay closed for the 11th.
