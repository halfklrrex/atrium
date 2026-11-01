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

function people(input, ctx) {
  const list = (Array.isArray(input) ? input : [input]).map((entry) =>
    entry === 'me' ? ctx.uid : entry,
  );
  for (const uid of list) {
    if (typeof uid !== 'string' || !ctx.memberUids.includes(uid)) {
      throw new McpUserError(
        'People cells take workspace member uids (or "me" for the configured user). ' +
          'Emails are not supported yet.',
      );
    }
  }
  return { personsAndTeams: list.map((id) => ({ id, kind: 'person' })) };
}

/**
 * Plain input -> stored value for one column. `null` clears the cell. Values that already have the
 * type's native JSON shape pass through. The result is NOT yet validated: see {@link toValidCell}.
 */
export function convertCellValue(column, input, ctx) {
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
      return typeof input === 'object' && !Array.isArray(input) ? input : people(input, ctx);
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

/** A readable form of a stored cell for `atrium_get_board`. */
export function readableCell(column, value) {
  if (value === null || value === undefined) return null;
  try {
    if (column.type === 'people') return value.personsAndTeams?.map((p) => p.id) ?? [];
    if (column.type === 'checkbox') return value.checked === true || value.checked === 'true';
    if (column.type === 'rating') return value.rating;
    const text = columnRegistry.toText(column.type, value, column.settings);
    return text === '' ? null : text;
  } catch {
    return value;
  }
}
