import type { ColumnDef } from '../schemas/board';
import type { BoardView } from '../schemas/view';
import { getFormulaReferences } from '../formula';
import { isChecked, type CheckboxValue } from './checkbox';
import { isoDateSchema, isoTimeSchema } from './date';
import { parseHour } from './hour';
import { columnRegistry } from './index';
import { findStatusLabel, type StatusLabel } from './status';

/**
 * Converting a column's values to another type (P2 "Change column type").
 *
 * Everything here is pure, so the web can preview the result ("42 values will be converted and 3
 * can't be") with exactly the code the `changeColumnType` Cloud Function runs. The default path is
 * "display text of the old value, parsed by the new type"; pairs where that loses structure
 * (status, dropdown and tags by label, date and timeline, checkbox) have their own rule.
 */

export type ConvertResult = { ok: true; value: unknown } | { ok: false };

const FAIL: ConvertResult = { ok: false };

/** Optional inputs the conversion cannot get from the value itself. */
export interface ConvertOptions {
  /** Display names by person uid. People convert to text only for the people listed here. */
  personNames?: Readonly<Record<string, string>>;
}

/** Colours for labels the conversion creates, in order (monday's status palette). */
export const CONVERT_LABEL_PALETTE: readonly string[] = [
  '#00c875',
  '#fdab3d',
  '#df2f4a',
  '#579bfc',
  '#9d50dd',
  '#ff5ac4',
  '#66ccff',
  '#9cd326',
  '#ffcb00',
  '#ff6d3b',
  '#4eccc6',
  '#784bd1',
  '#037f4c',
  '#bb3354',
  '#5559df',
  '#7f5347',
  '#757575',
  '#c4c4c4',
];

/** Types whose value is ids only (nothing readable to carry over); they convert to nothing. */
const OPAQUE_SOURCE_TYPES = new Set(['dependency', 'board_relation']);

/** Target types the text parsers below can build (plus the label types handled separately). */
const PARSED_TARGET_TYPES = new Set([
  'text',
  'long_text',
  'numbers',
  'rating',
  'date',
  'timeline',
  'checkbox',
  'email',
  'phone',
  'link',
  'color_picker',
  'status',
  'dropdown',
  'tags',
  'hour',
  'world_clock',
  'location',
  'country',
]);

/**
 * What a derived or server-managed column (its values only the server writes) can be turned into,
 * as a one-off snapshot of what it shows. Never a derived or server-managed type. Types missing
 * here (`files`, `button`) only make sense as text.
 */
const MANAGED_SOURCE_TARGETS: Readonly<Record<string, ReadonlySet<string>>> = {
  files: new Set(['text', 'long_text']),
  button: new Set(['text', 'long_text']),
  time_tracking: new Set(['text', 'long_text', 'numbers']),
  last_updated: new Set(['text', 'long_text', 'date']),
  creation_log: new Set(['text', 'long_text', 'date']),
};

export interface TypeChangeSupport {
  /** False when the change is refused (the type is not offered, or the server would refuse it). */
  allowed: boolean;
  /** Why it is refused. */
  reason?: string;
  /** Shown in the menu and the confirm dialog when values will be lost. */
  warning?: string;
  /** Only board owners may do it (derived and server-managed sources). */
  ownerOnly?: boolean;
}

export const CLEARED_WARNING = 'Values will be cleared';

/** Which type changes are allowed, with a warning when the values cannot be carried over. */
export function columnTypeChangeSupport(fromType: string, toType: string): TypeChangeSupport {
  if (!columnRegistry.has(toType)) return { allowed: false, reason: 'Unknown column type.' };
  if (!columnRegistry.has(fromType)) return { allowed: false, reason: 'Unknown column type.' };
  if (fromType === toType) return { allowed: false, reason: 'The column already has this type.' };
  if (columnRegistry.isServerManaged(toType)) {
    return { allowed: false, reason: 'This type is filled in by Atrium and cannot be a target.' };
  }
  const sourceManaged =
    columnRegistry.isDerived(fromType) || columnRegistry.isServerManaged(fromType);
  if (sourceManaged) {
    const targets = MANAGED_SOURCE_TARGETS[fromType] ?? PARSED_TARGET_TYPES;
    return targets.has(toType)
      ? { allowed: true, ownerOnly: true }
      : {
          allowed: false,
          reason: 'A calculated column can only become a type that can hold what it shows.',
        };
  }
  if (columnRegistry.isDerived(toType)) return { allowed: true, warning: CLEARED_WARNING };
  if (OPAQUE_SOURCE_TYPES.has(fromType) || (fromType === 'people' && toType !== 'text')) {
    return { allowed: true, warning: CLEARED_WARNING };
  }
  if (!PARSED_TARGET_TYPES.has(toType)) return { allowed: true, warning: CLEARED_WARNING };
  return { allowed: true };
}

// ---------------------------------------------------------------------------------------------
// Text parsers
// ---------------------------------------------------------------------------------------------

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function monthNumber(name: string): number | null {
  const key = name.toLowerCase().replace(/\.$/, '');
  if (key.length < 3) return null;
  const index = MONTHS.findIndex((m) => m === key || (key.length === 3 && m.startsWith(key)));
  return index === -1 ? null : index + 1;
}

function isoDate(y: number, m: number, d: number): string | null {
  const text = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isoDateSchema.safeParse(text).success ? text : null;
}

/**
 * A date in a text: ISO (`2026-03-04`, with an optional time), `2026/03/04`, `4 March 2026`,
 * `March 4, 2026`, or `4/3/2026` when only one reading is possible. Never depends on the time zone
 * of the machine it runs on.
 */
export function parseDateText(text: string): { date: string; time?: string } | null {
  const t = text.trim();
  if (!t) return null;
  const iso =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?Z?$/i.exec(
      t,
    );
  if (iso) {
    const date = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (!date) return null;
    if (iso[4] === undefined) return { date };
    const time = `${iso[4].padStart(2, '0')}:${iso[5]}:${iso[6] ?? '00'}`;
    return isoTimeSchema.safeParse(time).success ? { date, time } : { date };
  }
  const dayFirst = /^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i.exec(t);
  if (dayFirst) {
    const month = monthNumber(dayFirst[2]!);
    const date = month ? isoDate(Number(dayFirst[3]), month, Number(dayFirst[1])) : null;
    return date ? { date } : null;
  }
  const monthFirst = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(t);
  if (monthFirst) {
    const month = monthNumber(monthFirst[1]!);
    const date = month ? isoDate(Number(monthFirst[3]), month, Number(monthFirst[2])) : null;
    return date ? { date } : null;
  }
  const numeric = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (a > 12 && b <= 12) {
      const date = isoDate(year, b, a);
      return date ? { date } : null;
    }
    if (b > 12 && a <= 12) {
      const date = isoDate(year, a, b);
      return date ? { date } : null;
    }
    if (a === b) {
      const date = isoDate(year, a, b);
      return date ? { date } : null;
    }
  }
  return null;
}

/** A number in a text, with an optional unit or currency symbol on either side (`$1,200.50`, `12 kg`). */
export function parseNumberText(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const match =
    /^([+-])?\s*[^\d\s+\-.,]{0,8}\s*([+-])?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*[^\d\s+\-.,]{0,8}$/.exec(
      t,
    ) ?? /^([+-])?\s*[^\d\s+\-.,]{0,8}\s*([+-])?\s*(\.\d+)()\s*[^\d\s+\-.,]{0,8}$/.exec(t);
  if (!match) return null;
  const negative = match[1] === '-' || match[2] === '-';
  const n = Number(`${(match[3] ?? '').replace(/,/g, '')}${match[4] ?? ''}`);
  if (!Number.isFinite(n) || Math.abs(n) > 1e15) return null;
  return negative ? -n : n;
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '✓', '✔', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0']);

function parseTimelineText(text: string): { from: string; to: string } | null {
  const t = text.trim();
  const single = parseDateText(t);
  if (single) return { from: single.date, to: single.date };
  for (const separator of [/\s+[-–—]\s+/, /\s+to\s+/i, /\s*–\s*/, /\s*—\s*/]) {
    const parts = t.split(separator);
    if (parts.length !== 2) continue;
    const from = parseDateText(parts[0]!);
    const to = parseDateText(parts[1]!);
    if (from && to && from.date <= to.date) return { from: from.date, to: to.date };
  }
  return null;
}

function parseEmailText(text: string): { email: string; text?: string } | null {
  const t = text.trim();
  const named = /^(.*?)\s*<([^<>\s]+)>$/.exec(t);
  const email = named ? named[2]! : t;
  const name = named?.[1]?.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? { email, ...(name ? { text: name } : {}) }
    : null;
}

function parseLinkText(text: string): { url: string; text?: string } | null {
  let t = text.trim();
  let label: string | undefined;
  const split = t.lastIndexOf(' - ');
  if (split > 0 && /^(https?:\/\/|mailto:|tel:)/i.test(t.slice(split + 3).trim())) {
    label = t.slice(0, split).trim();
    t = t.slice(split + 3).trim();
  }
  if (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(t))
    return { url: t, ...(label ? { text: label } : {}) };
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t)) {
    return { url: `https://${t}`, ...(label ? { text: label } : {}) };
  }
  return null;
}

/** `lat, lng` (optionally in brackets or separated by a semicolon) as a location, or `null`. */
function parseLocationText(text: string): { lat: number; lng: number; address?: string } | null {
  const match = /^\(?\s*([+-]?\d{1,3}(?:\.\d+)?)\s*[,;]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*\)?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

let regionNames: Intl.DisplayNames | null | undefined;
let countryByName: Map<string, string> | undefined;

/** A country from its two-letter code or its English name, or `null`. */
function parseCountryText(text: string): { countryCode: string; countryName: string } | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    } catch {
      regionNames = null;
    }
  }
  if (!regionNames) return null;
  if (!countryByName) {
    countryByName = new Map();
    for (let a = 65; a <= 90; a += 1) {
      for (let b = 65; b <= 90; b += 1) {
        const code = String.fromCharCode(a, b);
        const name = regionNames.of(code);
        if (name && name !== code) countryByName.set(name.toLowerCase(), code);
      }
    }
  }
  const t = text.trim();
  if (/^[A-Za-z]{2}$/.test(t)) {
    const code = t.toUpperCase();
    const name = regionNames.of(code);
    return name && name !== code ? { countryCode: code, countryName: name } : null;
  }
  const code = countryByName.get(t.toLowerCase());
  return code ? { countryCode: code, countryName: regionNames.of(code)! } : null;
}

const splitLabels = (text: string): string[] =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

// ---------------------------------------------------------------------------------------------
// The converter
// ---------------------------------------------------------------------------------------------

type Settings = Record<string, unknown>;

export interface ValueConverter {
  /** Converts one stored value. Labels the target needs are created as a side effect. */
  convert(value: unknown): ConvertResult;
  /** The target settings so far: the requested ones plus every label created by `convert`. */
  settings(): Settings;
}

function slugOf(text: string, taken: ReadonlySet<string>, fallback: string): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || fallback;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
  return id;
}

/** Labels (text) a source value stands for, or `null` when the source has no label concept. */
function sourceLabels(fromType: string, parsed: unknown, settings: unknown): string[] | null {
  if (fromType === 'status') {
    const status = parsed as { index?: number; label?: string };
    const found = findStatusLabel(status, settings as { labels: StatusLabel[] });
    const text = found?.label ?? status.label ?? '';
    return text.trim() ? [text.trim()] : [];
  }
  if (fromType === 'dropdown' || fromType === 'tags') {
    return splitLabels(columnRegistry.get(fromType).toText(parsed, settings));
  }
  return null;
}

/**
 * Builds the converter for one column change. `toSettings` must already be valid for `toType`
 * (the callable and the dialog validate it first); it is copied, never changed.
 */
export function createValueConverter(
  from: Pick<ColumnDef, 'type' | 'settings'>,
  toType: string,
  toSettings: unknown,
  options: ConvertOptions = {},
): ValueConverter {
  const parsedSettings = columnRegistry.parseSettings(toType, toSettings);
  if (!parsedSettings.success) {
    throw new Error(`Invalid settings for column type "${toType}": ${parsedSettings.error}`);
  }
  const settings = JSON.parse(JSON.stringify(parsedSettings.data)) as Settings;
  const unwritable = columnRegistry.isDerived(toType) || columnRegistry.isServerManaged(toType);
  const targetDef: ColumnDef = {
    id: 'target',
    type: toType,
    title: 'target',
    position: 'a0',
    settings,
  };
  let created = 0;

  const statusLabels = (): StatusLabel[] => settings.labels as StatusLabel[];
  const dropdownLabels = (): Array<{ id: number; label: string }> =>
    settings.labels as Array<{ id: number; label: string }>;
  const tagList = (): Array<{ id: number; name: string; color?: string }> =>
    settings.tags as Array<{ id: number; name: string; color?: string }>;

  const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  function statusValue(labels: string[]): unknown {
    const text = labels[0]?.trim();
    if (!text) return null;
    const existing = statusLabels().find((l) => l.label.trim() !== '' && sameText(l.label, text));
    if (existing) return { index: existing.index };
    if (text.length > 60 || statusLabels().length >= 40) return null;
    const list = statusLabels();
    const index = list.reduce((max, l) => Math.max(max, l.index), -1) + 1;
    const used = new Set(list.map((l) => l.color.toLowerCase()));
    const color =
      CONVERT_LABEL_PALETTE.find((c) => !used.has(c)) ??
      CONVERT_LABEL_PALETTE[created % CONVERT_LABEL_PALETTE.length]!;
    created += 1;
    list.push({
      id: slugOf(text, new Set(list.map((l) => l.id)), `label_${index}`),
      index,
      label: text,
      color,
    });
    return { index };
  }

  function dropdownValue(labels: string[]): unknown {
    const ids: number[] = [];
    const limit = settings.limitSelect === true ? 1 : Infinity;
    for (const raw of labels) {
      if (ids.length >= limit) break;
      const text = raw.trim();
      if (!text) continue;
      const list = dropdownLabels();
      let found = list.find((l) => sameText(l.label, text));
      if (!found) {
        if (text.length > 60 || list.length >= 200) continue;
        found = { id: list.reduce((max, l) => Math.max(max, l.id), -1) + 1, label: text };
        list.push(found);
      }
      if (!ids.includes(found.id)) ids.push(found.id);
    }
    return ids.length > 0 ? { ids } : null;
  }

  function tagsValue(labels: string[]): unknown {
    const ids: number[] = [];
    for (const raw of labels) {
      const text = raw.trim();
      if (!text) continue;
      const list = tagList();
      let found = list.find((t) => sameText(t.name, text));
      if (!found) {
        if (text.length > 100) continue;
        found = { id: list.reduce((max, t) => Math.max(max, t.id), 0) + 1, name: text };
        list.push(found);
      }
      if (!ids.includes(found.id)) ids.push(found.id);
    }
    return ids.length > 0 ? { tag_ids: ids } : null;
  }

  /** The text of a source value, or `null` when it has none. */
  function textOf(parsed: unknown): string | null {
    if (from.type === 'people') {
      const people = (parsed as { personsAndTeams: Array<{ id: string; kind: string }> })
        .personsAndTeams;
      const names = people.flatMap((p) => {
        const name = p.kind === 'person' ? options.personNames?.[p.id]?.trim() : undefined;
        return name ? [name] : [];
      });
      return names.length > 0 ? names.join(', ') : null;
    }
    if (from.type === 'checkbox') return isChecked(parsed as CheckboxValue) ? 'Yes' : null;
    const text = columnRegistry.toText(from.type, parsed, from.settings).trim();
    return text === '' ? null : text;
  }

  function build(parsed: unknown): unknown {
    const labels = sourceLabels(from.type, parsed, from.settings);
    if (toType === 'status' || toType === 'dropdown' || toType === 'tags') {
      const text = labels ? null : textOf(parsed);
      if (labels === null && text === null) return null;
      if (toType === 'status') return statusValue(labels ?? [text!]);
      const list = labels ?? splitLabels(text!);
      return toType === 'dropdown' ? dropdownValue(list) : tagsValue(list);
    }
    if (toType === 'date' && from.type === 'timeline') {
      return { date: (parsed as { from: string }).from };
    }
    if (toType === 'timeline' && from.type === 'date') {
      const date = (parsed as { date: string }).date;
      return { from: date, to: date };
    }
    if (toType === 'numbers' && from.type === 'time_tracking') {
      return (parsed as { duration: number }).duration; // total seconds
    }
    if (toType === 'date' && (from.type === 'last_updated' || from.type === 'creation_log')) {
      const stamp = parsed as { updated_at?: string; created_at?: string };
      const found = parseDateText(stamp.updated_at ?? stamp.created_at ?? '');
      return found ? { date: found.date } : null;
    }
    const text = textOf(parsed);
    if (text === null) return null;
    switch (toType) {
      case 'hour':
        return parseHour(text);
      case 'world_clock': {
        const zone = text.replace(/\s*\([^)]*\)\s*$/, '');
        return { timezone: zone };
      }
      case 'location':
        return parseLocationText(text);
      case 'country':
        return parseCountryText(text);
      case 'text':
        return text;
      case 'long_text':
        return { text };
      case 'numbers':
        return parseNumberText(text);
      case 'rating': {
        const n = parseNumberText(text);
        const limit = Number(settings.limit ?? 5);
        return n !== null && Number.isInteger(n) && n >= 0 && n <= limit ? { rating: n } : null;
      }
      case 'date':
        return parseDateText(text);
      case 'timeline':
        return parseTimelineText(text);
      case 'checkbox': {
        const word = text.toLowerCase();
        if (TRUE_WORDS.has(word)) return { checked: 'true' };
        return FALSE_WORDS.has(word) ? { checked: 'false' } : null;
      }
      case 'email':
        return parseEmailText(text);
      case 'phone':
        return { phone: text };
      case 'link':
        return parseLinkText(text);
      case 'color_picker':
        return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)
          ? { color: { hex: text } }
          : null;
      default:
        return null;
    }
  }

  return {
    settings: () => settings,
    convert(value) {
      if (unwritable || value === null || value === undefined) return FAIL;
      if (OPAQUE_SOURCE_TYPES.has(from.type)) return FAIL;
      if (from.type === 'people' && toType !== 'text') return FAIL;
      const parsed = columnRegistry.parseValue(from.type, value);
      if (!parsed.success || parsed.data === null) return FAIL;
      const converted = build(parsed.data);
      if (converted === null || converted === undefined) return FAIL;
      // The same gate every cell write passes (schema, then the type's own validation).
      return columnRegistry.validateCell(targetDef, converted).ok
        ? { ok: true, value: converted }
        : FAIL;
    },
  };
}

/** Converts one value on its own. Labels it needs are created in a copy of `toSettings`. */
export function convertValue(
  from: Pick<ColumnDef, 'type' | 'settings'>,
  toType: string,
  toSettings: unknown,
  value: unknown,
  options?: ConvertOptions,
): ConvertResult {
  return createValueConverter(from, toType, toSettings, options).convert(value);
}

export interface ConversionEntry {
  id: string;
  value: unknown;
}

export interface ConversionPlan {
  /** The target settings to store: the requested ones plus the labels the conversion created. */
  settings: Settings;
  /** One result per entry, in the order given. */
  results: Array<{ id: string; ok: true; value: unknown } | { id: string; ok: false }>;
  converted: number;
  cleared: number;
}

/**
 * Converts every entry in order. The order matters only for the labels it creates (ids, indexes and
 * colours), so the server and the web agree as long as they pass the entries in the same order.
 */
export function planColumnConversion(
  from: Pick<ColumnDef, 'type' | 'settings'>,
  toType: string,
  toSettings: unknown,
  entries: readonly ConversionEntry[],
  options?: ConvertOptions,
): ConversionPlan {
  const converter = createValueConverter(from, toType, toSettings, options);
  let convertedCount = 0;
  const results = entries.map((entry): ConversionPlan['results'][number] => {
    const result = converter.convert(entry.value);
    if (result.ok) {
      convertedCount += 1;
      return { id: entry.id, ok: true, value: result.value };
    }
    return { id: entry.id, ok: false };
  });
  return {
    settings: converter.settings(),
    results,
    converted: convertedCount,
    cleared: entries.length - convertedCount,
  };
}

export interface ConversionSample {
  before: string;
  /** `null` when the value cannot be converted and will be cleared. */
  after: string | null;
}

/** The first `limit` entries as "before -> after" display texts for the confirm dialog. */
export function conversionSamples(
  from: Pick<ColumnDef, 'type' | 'settings'>,
  toType: string,
  plan: ConversionPlan,
  entries: readonly ConversionEntry[],
  limit = 3,
  options?: ConvertOptions,
): ConversionSample[] {
  const samples: ConversionSample[] = [];
  entries.forEach((entry, index) => {
    if (samples.length >= limit) return;
    const result = plan.results[index];
    const peopleText =
      from.type === 'people'
        ? (columnRegistry.parseValue('people', entry.value) as {
            success: boolean;
            data?: { personsAndTeams: Array<{ id: string }> };
          })
        : null;
    const before =
      peopleText?.success && peopleText.data
        ? peopleText.data.personsAndTeams
            .map((p) => options?.personNames?.[p.id])
            .filter((n): n is string => Boolean(n))
            .join(', ')
        : columnRegistry.toText(from.type, entry.value, from.settings);
    if (before === '' && from.type === 'people') return;
    samples.push({
      before,
      after:
        result?.ok === true ? columnRegistry.toText(toType, result.value, plan.settings) : null,
    });
  });
  return samples;
}

// ---------------------------------------------------------------------------------------------
// What depends on a column
// ---------------------------------------------------------------------------------------------

export interface ColumnDependent {
  kind: 'formula' | 'progress' | 'mirror' | 'dependency' | 'view';
  /** Title of the column or name of the view that uses the column. */
  title: string;
}

/**
 * Columns and views that read column `columnId`: a formula expression, a progress roll-up, a mirror's
 * connect-boards column, a dependency's date column, and a view's board, calendar, timeline or
 * group-by column. Changing the column's type can break these, so the confirm dialog lists them.
 */
export function findColumnDependents(
  columns: readonly ColumnDef[],
  columnId: string,
  views: ReadonlyArray<Pick<BoardView, 'name' | 'settings'>> = [],
): ColumnDependent[] {
  const found: ColumnDependent[] = [];
  for (const column of columns) {
    if (column.id === columnId) continue;
    const settings = column.settings as Record<string, unknown>;
    if (column.type === 'formula') {
      const expression = typeof settings.expression === 'string' ? settings.expression : '';
      if (getFormulaReferences(expression).includes(columnId)) {
        found.push({ kind: 'formula', title: column.title });
      }
    } else if (column.type === 'progress') {
      const related = (
        settings.related_columns as { columns?: Record<string, unknown> } | undefined
      )?.columns;
      if (related && Object.hasOwn(related, columnId)) {
        found.push({ kind: 'progress', title: column.title });
      }
    } else if (column.type === 'mirror' && settings.relationColumnId === columnId) {
      found.push({ kind: 'mirror', title: column.title });
    } else if (column.type === 'dependency' && settings.timeColumnId === columnId) {
      found.push({ kind: 'dependency', title: column.title });
    }
  }
  for (const view of views) {
    const s = view.settings;
    if (
      s.filter.groupByColumnId === columnId ||
      s.kanban?.columnId === columnId ||
      s.calendar?.columnId === columnId ||
      s.calendar?.colorBy === columnId ||
      s.timeline?.columnId === columnId ||
      s.timeline?.colorBy === columnId ||
      s.chart?.xColumnId === columnId ||
      s.chart?.stackColumnId === columnId ||
      s.chart?.yColumnId === columnId
    ) {
      found.push({ kind: 'view', title: view.name });
    }
  }
  return found;
}
