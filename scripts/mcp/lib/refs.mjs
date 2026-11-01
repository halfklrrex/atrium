// Finds columns and groups by id or title, so callers never need raw slugs.
import { McpUserError } from './errors.mjs';

const norm = (text) => String(text).trim().toLowerCase();

function pick(list, ref, what, titleOf) {
  if (typeof ref !== 'string' || ref.trim() === '') {
    throw new McpUserError(`Give the ${what} as an id or a title.`);
  }
  const byId = list.find((entry) => entry.id === ref);
  if (byId) return byId;
  const byTitle = list.filter((entry) => norm(titleOf(entry)) === norm(ref));
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1) {
    const ids = byTitle.map((entry) => `${entry.id}`).join(', ');
    throw new McpUserError(
      `More than one ${what} is called "${ref}" (ids: ${ids}). Use the id instead.`,
    );
  }
  const known = list.map((entry) => `"${titleOf(entry)}"`).join(', ') || 'none';
  throw new McpUserError(`No ${what} "${ref}" on this board. Available: ${known}.`);
}

/** A column of the board by id or case-insensitive title; refuses unknown and ambiguous names. */
export function findColumn(board, ref) {
  return pick(board.columns, ref, 'column', (c) => c.title);
}

/** A group of the board by id or case-insensitive title. */
export function findGroup(board, ref) {
  return pick(board.groups, ref, 'group', (g) => g.title);
}

const byPosition = (a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/** Groups or columns in display order. */
export const sortedByPosition = (list) => [...list].sort(byPosition);
