import { VOTE_COLUMN_RULE_CAP, type ColumnDef } from '@atrium/shared';

/** The refusal text when a board would get more vote columns than the rules can protect. */
export const VOTE_CAP_MESSAGE = `A board can have at most ${VOTE_COLUMN_RULE_CAP} vote columns (including sub-item columns). Delete another vote column first.`;

/**
 * Throws when adding a column of `type` would push the board (columns and subitem columns together)
 * past the rules' vote cap: the rules refuse writes to the 11th or later vote column, which would
 * make it impossible to vote there.
 */
export function assertVoteCapAllows(
  type: string,
  state: { columns: readonly ColumnDef[]; subitemColumns: readonly ColumnDef[] },
): void {
  if (type !== 'vote') return;
  const count = [...state.columns, ...state.subitemColumns].filter((c) => c.type === 'vote').length;
  if (count >= VOTE_COLUMN_RULE_CAP) throw new Error(VOTE_CAP_MESSAGE);
}
