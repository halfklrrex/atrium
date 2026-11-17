import { VOTE_COLUMN_CAP_MESSAGE, voteCapExceeded, type ColumnDef } from '@atrium/shared';

/** The refusal text when a board would get more vote columns than the rules can protect. */
export const VOTE_CAP_MESSAGE = VOTE_COLUMN_CAP_MESSAGE;

/**
 * Throws when adding a column of `type` would push the board (columns and subitem columns together)
 * past the rules' vote cap: the rules refuse writes to the 11th or later vote column, which would
 * make it impossible to vote there.
 */
export function assertVoteCapAllows(
  type: string,
  state: { columns: readonly ColumnDef[]; subitemColumns: readonly ColumnDef[] },
): void {
  if (voteCapExceeded(type, state)) throw new Error(VOTE_CAP_MESSAGE);
}
