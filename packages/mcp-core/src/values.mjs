// Converts the plain values Claude writes ("Done", "2026-11-05") to the stored cell shape, then runs
// the column registry's own validation, so the connector cannot write what the web app rejects.
import {
  columnRegistry,
  computeMirror,
  getWeekDateRange,
  isValidTimezone,
  mirrorSettingsSchema,
  parseHour,
} from '@atrium/shared';
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
  // Added in batch 2 PR 6. `button` stays out (its actions belong with automations).
  'email',
  'phone',
  'country',
  'location',
  'hour',
  'week',
  'world_clock',
  'color_picker',
  'vote',
  'progress',
  'formula',
  'item_id',
  'auto_number',
  'creation_log',
  'last_updated',
  'board_relation',
  'mirror',
  'dependency',
  'files',
  'time_tracking',
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

// ---- the simple new types ----------------------------------------------------------------------

let regionNames;
let countryCodesByName;
function countryNames() {
  regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
  if (!countryCodesByName) {
    countryCodesByName = new Map();
    for (let a = 65; a <= 90; a += 1) {
      for (let b = 65; b <= 90; b += 1) {
        const code = String.fromCharCode(a, b);
        let name;
        try {
          name = regionNames.of(code);
        } catch {
          continue;
        }
        if (name && name !== code) countryCodesByName.set(name.toLowerCase(), code);
      }
    }
  }
  return { regionNames, countryCodesByName };
}

function country(input) {
  if (typeof input !== 'string') return input;
  const text = input.trim();
  const { regionNames: names, countryCodesByName: byName } = countryNames();
  const code = /^[a-z]{2}$/i.test(text) ? text.toUpperCase() : byName.get(text.toLowerCase());
  const name = code ? names.of(code) : undefined;
  if (!code || !name || name === code) {
    throw new McpUserError(
      `"${input}" is not a country. Give a two-letter ISO code ("NL") or the English name ("Netherlands").`,
    );
  }
  return { countryCode: code, countryName: name };
}

function hour(input) {
  if (typeof input !== 'string') return input;
  const parsed = parseHour(input);
  if (!parsed) throw new McpUserError(`"${input}" is not a time. Use "14:30" or "2:30 PM".`);
  return parsed;
}

/** `"2026-W47"` or a date (`"2026-11-19"`) -> the week range, starting on the column's first day. */
function week(column, input) {
  if (typeof input !== 'string') return input;
  const text = input.trim();
  const first = column.settings?.firstDayOfWeek === 'sunday' ? 'sunday' : 'monday';
  const iso = /^(\d{4})-?W(\d{1,2})$/i.exec(text);
  let date = text;
  if (iso) {
    const year = Number(iso[1]);
    const weekNumber = Number(iso[2]);
    if (weekNumber < 1 || weekNumber > 53) {
      throw new McpUserError(`"${input}" is not a week. Use "2026-W47" or a date.`);
    }
    // ISO week 1 holds January 4th; weeks start on Monday.
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(
      jan4.getTime() + (-((jan4.getUTCDay() + 6) % 7) + (weekNumber - 1) * 7) * 86400000,
    );
    // The week of its Thursday is the ISO week; for a Sunday-first column the week starts a day earlier.
    date = new Date(monday.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    const range = getWeekDateRange(date, 'monday');
    if (first === 'monday') return { week: range };
    const start = new Date(new Date(`${range.startDate}T00:00:00Z`).getTime() - 86400000);
    return { week: getWeekDateRange(start.toISOString().slice(0, 10), 'sunday') };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new McpUserError(`"${input}" is not a week. Use "2026-W47" or a date "YYYY-MM-DD".`);
  }
  return { week: getWeekDateRange(date, first) };
}

function location(input) {
  if (typeof input === 'string') {
    throw new McpUserError(
      'Location cells need coordinates: pass { lat, lng, address? } (Atrium cannot look up an address text).',
    );
  }
  if (Array.isArray(input)) return { lat: input[0], lng: input[1] };
  return input;
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
    case 'email':
      return typeof input === 'string' ? { email: input.trim() } : input;
    case 'phone':
      if (typeof input === 'string') return { phone: input.trim() };
      if (input && typeof input === 'object' && 'country' in input) {
        const { country: code, ...rest } = input;
        return { ...rest, countryShortName: code };
      }
      return input;
    case 'country':
      return country(input);
    case 'location':
      return location(input);
    case 'hour':
      return hour(input);
    case 'week':
      return week(column, input);
    case 'world_clock':
      if (typeof input !== 'string') return input;
      if (!isValidTimezone(input.trim())) {
        throw new McpUserError(
          `"${input}" is not a time zone. Use an IANA name such as "Europe/Amsterdam" or "UTC".`,
        );
      }
      return { timezone: input.trim() };
    case 'color_picker':
      return typeof input === 'string' ? { color: { hex: input.trim() } } : input;
    // Item names are looked up (and checked against the rules) before conversion; see service/links.mjs.
    case 'board_relation':
    case 'dependency':
      return ctx?.links?.has(column.id) ? ctx.links.get(column.id) : input;
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
  if (column.type === 'mirror') return mirrorCell(column, ctx);
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

/**
 * A Mirror cell: `computeMirror` over the linked items that `prepareMirrors` (service.mjs) read for
 * this call. Items on boards the actor cannot read were never loaded, so they contribute nothing,
 * as in the web. `null` without that data or a result.
 */
function mirrorCell(column, ctx) {
  const data = ctx.mirror;
  if (!data) return null;
  try {
    const settings = mirrorSettingsSchema.parse(column.settings ?? {});
    const result = computeMirror(
      { values: ctx.item.values ?? {} },
      settings,
      data.connected,
      data.targetColumns,
      columnRegistry,
    );
    return result.displayValue === '' ? null : result.displayValue;
  } catch {
    return null;
  }
}
