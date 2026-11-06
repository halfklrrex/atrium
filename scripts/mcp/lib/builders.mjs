// Pure builders for the documents the connector writes. They mirror the web app
// (`apps/web/src/data/firestore.ts` createBoard, `item-writes.ts`, `updates.ts`) and validate with the
// zod schemas in @atrium/shared before anything is sent.
import { randomBytes } from 'node:crypto';
import { generateKeyBetween } from 'fractional-indexing';
import {
  boardSchema,
  columnDefSchema,
  columnRegistry,
  defaultBoardStructure,
  groupDefSchema,
  itemSchema,
  itemUpdateSchema,
} from '@atrium/shared';
import { CREATABLE_COLUMN_TYPES } from './values.mjs';
import { McpUserError } from './errors.mjs';

/** monday-like label colours, usable by name; a `#RRGGBB` value is accepted too. */
export const LABEL_COLORS = {
  orange: '#fdab3d',
  green: '#00c875',
  red: '#df2f4a',
  blue: '#579bfc',
  purple: '#a25ddc',
  pink: '#ff158a',
  yellow: '#ffcb00',
  teal: '#4eccc6',
  grey: '#c4c4c4',
  brown: '#7f5347',
  navy: '#225091',
  lime: '#9cd326',
};
const COLOR_CYCLE = Object.values(LABEL_COLORS).slice(0, 11);

export function resolveColor(color, fallbackIndex = 0) {
  if (color === undefined || color === null) return COLOR_CYCLE[fallbackIndex % COLOR_CYCLE.length];
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const named = LABEL_COLORS[String(color).toLowerCase()];
  if (!named) {
    throw new McpUserError(
      `Unknown colour "${color}". Use #RRGGBB or one of: ${Object.keys(LABEL_COLORS).join(', ')}.`,
    );
  }
  return named;
}

/** Timestamp stand-in that the schemas accept and the REST client encodes as a timestamp. */
export function ts(date) {
  const ms = date.getTime();
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
    toDate: () => date,
    toMillis: () => ms,
  };
}

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Firestore-style auto id (20 alphanumerics). */
export function newDocId() {
  return Array.from(randomBytes(20), (b) => ALPHANUM[b % ALPHANUM.length]).join('');
}
/** Short slug, as used for column and group ids (matches the web's `newSlugId`). */
export function newSlugId(length = 10) {
  return Array.from(randomBytes(length), (b) => (b % 36).toString(36)).join('');
}

/** A fractional position after the largest of `positions` (or the first one). */
export function positionAfter(positions) {
  const sorted = [...positions].sort();
  return generateKeyBetween(sorted.at(-1) ?? null, null);
}

function parseOrThrow(schema, value, what) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    throw new McpUserError(`${what} is not valid: ${detail}`);
  }
  return result.data;
}

// ---- boards ------------------------------------------------------------------------------------

export function buildBoardDoc({
  config,
  name,
  description = '',
  position,
  now,
  newId = newSlugId,
}) {
  const structure = defaultBoardStructure(() => newId());
  const stamp = ts(now);
  const doc = {
    workspaceId: config.workspaceId,
    folderId: null,
    name: name.trim(),
    description,
    kind: 'main',
    access: { [config.uid]: 'owner' },
    accessUids: [config.uid],
    position,
    icon: null,
    ...structure,
    derivedColumnIds: [],
    serverManagedColumnIds: [],
    requiredColumnIds: [],
    state: 'active',
    deletedAt: null,
    createdAt: stamp,
    createdBy: config.uid,
    updatedAt: stamp,
    updatedBy: config.uid,
  };
  parseOrThrow(boardSchema, doc, 'The board');
  return doc;
}

// ---- groups ------------------------------------------------------------------------------------

export function buildGroup({ title, color, existingGroups, newId = newSlugId }) {
  const group = {
    id: newId(),
    title: title.trim(),
    color: resolveColor(color, existingGroups.length),
    position: positionAfter(existingGroups.map((g) => g.position)),
  };
  return parseOrThrow(groupDefSchema, group, 'The group');
}

// ---- columns -----------------------------------------------------------------------------------

function nextIndex(labels) {
  return labels.reduce((max, l) => Math.max(max, l.index), -1) + 1;
}
function nextNumericId(entries) {
  return entries.reduce((max, e) => Math.max(max, e.id), 0) + 1;
}
const labelText = (entry) => (typeof entry === 'string' ? entry : entry.label);
const labelColor = (entry) => (typeof entry === 'string' ? undefined : entry.color);
const sameText = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Adds label/option/tag texts to the settings of a status, dropdown or tags column. */
export function addLabelsToSettings(type, settings, additions) {
  const next = structuredClone(settings);
  const list = Array.isArray(additions) ? additions : [additions];
  if (type === 'status') {
    next.labels ??= [];
    list.forEach((entry, i) => {
      const text = labelText(entry);
      if (next.labels.some((l) => sameText(l.label, text))) return; // adding is idempotent
      const index = nextIndex(next.labels);
      next.labels.push({
        id: `label-${newSlugId(6)}`,
        index,
        label: text,
        color: resolveColor(labelColor(entry), index + i),
      });
    });
  } else if (type === 'dropdown') {
    next.labels ??= [];
    for (const entry of list) {
      const text = labelText(entry);
      if (next.labels.some((l) => sameText(l.label, text))) continue;
      next.labels.push({ id: nextNumericId(next.labels), label: text });
    }
  } else if (type === 'tags') {
    next.tags ??= [];
    for (const entry of list) {
      const text = labelText(entry);
      if (next.tags.some((t) => sameText(t.name, text))) continue;
      const color = labelColor(entry);
      next.tags.push({
        id: nextNumericId(next.tags),
        name: text,
        ...(color ? { color: resolveColor(color) } : {}),
      });
    }
  } else {
    throw new McpUserError(`Only status, dropdown and tags columns have labels (this is ${type}).`);
  }
  return next;
}

/** Validates settings with the type's own schema; throws with the reason. */
export function validSettings(type, settings) {
  const parsed = columnRegistry.parseSettings(type, settings);
  if (!parsed.success) {
    throw new McpUserError(`Invalid settings for a ${type} column: ${parsed.error}`);
  }
  return parsed.data;
}

/**
 * Settings for a new column: the type's defaults, then `input`. Labels come in as `addLabels`
 * (status: `{label,color?}` or text; dropdown/tags: texts); other keys are the type's own settings.
 */
export function buildColumnSettings(type, input = {}) {
  const { addLabels, ...rest } = input;
  for (const key of ['labels', 'tags']) {
    if (key in rest) throw new McpUserError(`Pass labels as "addLabels", not "${key}".`);
  }
  let settings = columnRegistry.defaultSettings(type);
  // A status column starts from the labels given, not from the three defaults.
  if (type === 'status' && addLabels !== undefined) settings = { ...settings, labels: [] };
  settings = { ...settings, ...rest };
  if (addLabels !== undefined) settings = addLabelsToSettings(type, settings, addLabels);
  return validSettings(type, settings);
}

export function buildColumn({ title, type, settings, existingColumns, newId = newSlugId }) {
  if (!CREATABLE_COLUMN_TYPES.includes(type)) {
    throw new McpUserError(
      `Column type "${type}" is not supported. Use one of: ${CREATABLE_COLUMN_TYPES.join(', ')}.`,
    );
  }
  if (columnRegistry.isDerived(type) || columnRegistry.isServerManaged(type)) {
    throw new McpUserError(`Column type "${type}" is calculated or managed by Atrium.`);
  }
  const column = {
    id: newId(),
    type,
    title: title.trim(),
    position: positionAfter(existingColumns.map((c) => c.position)),
    settings: buildColumnSettings(type, settings),
  };
  return parseOrThrow(columnDefSchema, column, 'The column');
}

// ---- items -------------------------------------------------------------------------------------

export function buildItemDoc({ config, name, groupId, position, values, now }) {
  const stamp = ts(now);
  const doc = {
    name: name.trim(),
    groupId,
    position,
    parentItemId: null,
    values,
    state: 'active',
    deletedAt: null,
    createdAt: stamp,
    createdBy: config.uid,
    updatedAt: stamp,
    updatedBy: config.uid,
  };
  parseOrThrow(itemSchema, doc, 'The item');
  return doc;
}

/**
 * The commit `update` write for an item patch: field paths only (`values.<colId>`), never the
 * whole `values` map. `null` removes the cell, like the web's `deleteField()`.
 */
export function buildItemPatch({ config, now, name, groupId, position, cells }) {
  const set = { updatedAt: ts(now), updatedBy: config.uid };
  const remove = [];
  if (name !== undefined) set.name = name.trim();
  if (groupId !== undefined) {
    set.groupId = groupId;
    set.position = position;
  }
  for (const [columnId, value] of Object.entries(cells ?? {})) {
    if (value === null) remove.push(`values.${columnId}`);
    else set[`values.${columnId}`] = value;
  }
  return { set, remove };
}

export function buildUpdateDoc({ config, itemId, id, content, authorName, authorPhotoUrl, now }) {
  const stamp = ts(now);
  const doc = {
    itemId,
    authorId: config.uid,
    ...(authorName ? { authorName } : {}),
    ...(authorPhotoUrl !== undefined ? { authorPhotoUrl } : {}),
    content: content.trim(),
    likes: [],
    repliesCount: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };
  parseOrThrow(itemUpdateSchema, doc, 'The update');
  // The web also stores the id inside the document.
  return { id, ...doc };
}
