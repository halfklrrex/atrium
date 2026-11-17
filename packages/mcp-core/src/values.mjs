// Converts the plain values Claude writes ("Done", "2026-11-05") to the stored cell shape, then runs
// the column registry's own validation, so the connector cannot write what the web app rejects.
import { columnRegistry } from '@atrium/shared';
import { McpUserError } from './errors.mjs';

/** Column types the connector may create (spec: simple, user-editable types only). */
export const CREATABLE_COLUMN_TYPES = [
  'text',
  'long_text',
  'numbers',
  'status',
  'dropdown',
  'date',
  'timeline',
  'checkbox',
  'link',
  'people',
  'tags',
  'rating',
];

const norm = (text) => String(text).trim().toLowerCase();

function labelList(input, what) {
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) return [];
  return list.map((entry) => {
    if (typeof entry !== 'string') throw new McpUserError(`${what} must be label texts.`);
    return entry;
  });
}

function oneStatus(column, input) {
  const labels = column.settings.labels ?? [];
  if (typeof input === 'number') return { index: input };
  if (input && typeof input === 'object') return input; // {index} or {label}
  const wanted = norm(input);
  const found = labels.find((l) => norm(l.label) === wanted);
  if (!found) {
    const known = labels.map((l) => `"${l.label}"`).join(', ');
    throw new McpUserError(
      `Status "${input}" is not a label of column "${column.title}". Labels: ${known}.`,
    );
  }
  return { index: found.index };
}

function dropdown(column, input) {
  const labels = column.settings.labels ?? [];
  const ids = labelList(input, 'A dropdown value').map((text) => {
    const found = labels.find((l) => norm(l.label) === norm(text));
    if (!found) {
      const known = labels.map((l) => `"${l.label}"`).join(', ');
      throw new McpUserError(
        `"${text}" is not an option of column "${column.title}". Options: ${known}.`,
      );
    }
    return found.id;
  });
  return { ids };
}

function tags(column, input) {
  const known = column.settings.tags ?? [];
  const ids = labelList(input, 'A tags value').map((text) => {
    const found = known.find((t) => norm(t.name) === norm(text));
    if (!found) {
      const names = known.map((t) => `"${t.name}"`).join(', ');
      throw new McpUserError(
        `"${text}" is not a tag of column "${column.title}". Add it first with ` +
          `atrium_update_column_settings (addLabels). Tags: ${names}.`,
      );
    }
    return found.id;
  });
  return { tag_ids: ids };
}

/** The text of a team reference: `"team:<name or id>"` or `{ team: "<name or id>" }`, else `null`. */
function teamRefOf(entry) {
  if (typeof entry === 'string' && /^team:/i.test(entry.trim())) {
    return entry.trim().slice('team:'.length).trim();
  }
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry) && 'team' in entry) {
    return typeof entry.team === 'string' ? entry.team.trim() : '';
  }
  return null;
}

/** True when a people input is a list of entries (not the native `{ personsAndTeams }` value). */
function isPeopleEntries(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return true;
  return 'team' in input;
}

const entriesOf = (input) => (Array.isArray(input) ? input : [input]);

/** True when a people input names someone by email (so the caller must load the member profiles). */
export function peopleInputHasEmail(input) {
  if (!isPeopleEntries(input)) return false;
  return entriesOf(input).some(
    (entry) => typeof entry === 'string' && teamRefOf(entry) === null && entry.includes('@'),
  );
}

/** True when a people input names a team (so the caller must load the workspace's teams). */
export function peopleInputHasTeam(input) {
  return isPeopleEntries(input) && entriesOf(input).some((entry) => teamRefOf(entry) !== null);
}

function oneTeam(ref, ctx) {
  const teams = ctx.teams ?? [];
  const names =
    teams
      .map((t) => `"${t.name}"`)
      .sort()
      .join(', ') || 'none';
  const byId = teams.find((t) => t.id === ref);
  if (byId) return byId;
  const matches = teams.filter((t) => norm(t.name) === norm(ref));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new McpUserError(
      `More than one team is called "${ref}" (ids: ${matches.map((t) => t.id).join(', ')}). Use the team id.`,
    );
  }
  throw new McpUserError(`No team "${ref}" in this workspace. Teams: ${names}.`);
}

function people(column, input, ctx) {
  const list = entriesOf(input).map((entry) => {
    const teamRef = teamRefOf(entry);
    if (teamRef !== null) {
      if (teamRef === '')
        throw new McpUserError('Give the team as a name or an id: "team:<name>".');
      return { id: oneTeam(teamRef, ctx).id, kind: 'team' };
    }
    let uid = entry;
    if (entry === 'me') uid = ctx.uid;
    // An email is matched against the workspace members only; a non-member and an unknown address
    // fail with the same message as an unknown uid, so this cannot probe accounts.
    else if (typeof entry === 'string' && entry.includes('@')) {
      uid = ctx.emailToUid?.get(entry.trim().toLowerCase()) ?? entry;
    }
    if (typeof uid !== 'string' || !ctx.memberUids.includes(uid)) {
      throw new McpUserError(
        'People cells take workspace member uids, the email of a workspace member, "me" for yourself, ' +
          'or a team as "team:<name or id>".',
      );
    }
    return { id: uid, kind: 'person' };
  });
  if (column.settings?.singlePerson === true && list.length > 1) {
    throw new McpUserError(`Column "${column.title}" holds one person or team.`);
  }
  return { personsAndTeams: list };
}

/**
 * Plain input -> stored value for one column. `null` clears the cell. Values that already have the
 * type's native JSON shape pass through. The result is NOT yet validated: see {@link toValidCell}.
 */
export function convertCellValue(column, input, ctx) {
  // Even null: clearing the cell would erase everyone's votes, and a raw value could add or remove
  // someone else's. Only the vote tools write these cells, and only the caller's own uid.
  if (column.type === 'vote') {
    throw new McpUserError('Use atrium_vote_item or atrium_unvote_item for vote columns.');
  }
  if (input === null || input === undefined) return null;
  switch (column.type) {
    case 'status':
      return oneStatus(column, input);
    case 'dropdown':
      return typeof input === 'object' && !Array.isArray(input) ? input : dropdown(column, input);
    case 'tags':
      return typeof input === 'object' && !Array.isArray(input) ? input : tags(column, input);
    case 'date':
      return typeof input === 'string' ? { date: input } : input;
    case 'timeline':
      return Array.isArray(input) ? { from: input[0], to: input[1] } : input;
    case 'checkbox':
      return typeof input === 'boolean' ? { checked: input } : input;
    case 'long_text':
      return typeof input === 'string' ? { text: input } : input;
    case 'link':
      return typeof input === 'string' ? { url: input } : input;
    case 'rating':
      return typeof input === 'number' ? { rating: input } : input;
    case 'people':
      return isPeopleEntries(input) ? people(column, input, ctx) : input;
    default:
      return input;
  }
}

/** Converts, then validates with the column registry. Throws a `McpUserError` with the reason. */
export function toValidCell(column, input, ctx) {
  const stored = convertCellValue(column, input, ctx);
  const result = columnRegistry.validateCell(column, stored);
  if (!result.ok) {
    throw new McpUserError(`Column "${column.title}" (${column.type}): ${result.message}`);
  }
  if (stored === null) return null;
  const parsed = columnRegistry.parseValue(column.type, stored);
  return parsed.success ? parsed.data : stored;
}

export const DELETED_TEAM_NAME = 'Deleted team';

/**
 * A readable form of a stored cell for `atrium_get_board`. `ctx` carries what a bare value cannot:
 * `{ boardId, item, columns }` for calculated columns (computed with the registry's own
 * `computeValue`, like the web's filter engine), and `{ people, teams }` (uid -> name, team id ->
 * team) to name people and teams.
 */
export function readableCell(column, value, ctx) {
  if (columnRegistry.isDerived(column.type)) return derivedCell(column, ctx);
  if (value === null || value === undefined) return null;
  try {
    if (column.type === 'people') {
      return (value.personsAndTeams ?? []).map((p) => {
        const kind = p.kind === 'team' ? 'team' : 'person';
        const name =
          kind === 'team'
            ? ctx?.teams
              ? (ctx.teams.get(p.id)?.name ?? DELETED_TEAM_NAME)
              : null
            : (ctx?.people?.get(p.id) ?? null);
        return { id: p.id, kind, name };
      });
    }
    if (column.type === 'checkbox') return value.checked === true || value.checked === 'true';
    if (column.type === 'rating') return value.rating;
    const text = columnRegistry.toText(column.type, value, column.settings);
    return text === '' ? null : text;
  } catch {
    return value;
  }
}

/** The text of a calculated column for one item; `null` without the item context or a result. */
function derivedCell(column, ctx) {
  if (!ctx?.item) return null;
  try {
    const { item } = ctx;
    const computed = columnRegistry.computeValue(column, {
      boardId: ctx.boardId ?? '',
      item: {
        id: item.id ?? '',
        values: item.values ?? {},
        createdAt: item.createdAt,
        createdBy: item.createdBy,
        updatedAt: item.updatedAt,
        updatedBy: item.updatedBy,
        groupId: item.groupId,
        seq: item.seq,
        boardSeq: item.boardSeq,
      },
      columns: ctx.columns ?? [],
    });
    if (computed === null || computed === undefined) return null;
    const text = columnRegistry.toText(column.type, computed, column.settings);
    return text === '' ? null : text;
  } catch {
    return null;
  }
}
