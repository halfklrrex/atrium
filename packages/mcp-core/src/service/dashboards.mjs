// Service methods: Dashboards (P6). Receives the shared helpers of `createService` (see ../service.mjs).
// A dashboard is `dashboards/{id}`: the doc/board access model (`kind`, `access`, `accessUids`), the
// boards it reads (`boardIds`) and its widgets. It stores no item data: numbers and battery widgets
// are computed on read from the boards the actor can read, as `apps/web/src/components/dashboard/widgets`
// does. Both clients bypass the security rules, so every write mirrors them (see `validDashboardCreate`
// and `validDashboardUpdate` in firestore.rules) and `apps/web/src/data/dashboards.ts`. Sharing fields
// (`kind` after creation, `access`, `accessUids`) are never written here.
import {
  DASHBOARD_LIMITS,
  DASHBOARD_WIDGET_TYPES,
  DEFAULT_WIDGET_SIZE,
  columnRegistry,
  createDashboardInputSchema,
  dashboardWidgetsSchema,
  defaultWidgetSettings,
  findStatusLabel,
} from '@atrium/shared';
import { newDocId, newSlugId, positionAfter } from '../builders.mjs';
import { McpUserError, assertId } from '../errors.mjs';
import { CREATE_BOARD_ROLES, EDIT_ROLES } from './constants.mjs';

const KINDS = ['main', 'private', 'shareable'];
const DEFAULT_TITLE = {
  chart: 'Chart',
  numbers: 'Numbers',
  battery: 'Battery',
  table: 'Table',
  workload: 'Workload',
};
const GROUP_AXIS = '__group';

const norm = (text) => String(text).trim().toLowerCase();
const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// ---- grid layout: a copy of `apps/web/src/components/dashboard/dashboard-layout.ts` (a parity test
// runs both on the same inputs, so they cannot drift apart) ---------------------------------------

const { gridColumns, widgetMinW, widgetMaxW, widgetMinH, widgetMaxH, maxY } = DASHBOARD_LIMITS;

const clampInt = (value, min, max) => {
  const n = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, n));
};

export function clampLayout(layout) {
  const w = clampInt(layout.w, widgetMinW, widgetMaxW);
  const h = clampInt(layout.h, widgetMinH, widgetMaxH);
  return { x: clampInt(layout.x, 0, gridColumns - w), y: clampInt(layout.y, 0, maxY), w, h };
}

const collides = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function normalizeLayout(items) {
  const clamped = items.map((item, index) => ({ id: item.id, ...clampLayout(item), index }));
  const rest = [...clamped].sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);
  const placed = [];
  const resolved = new Map();
  for (const item of rest) {
    const next = { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h };
    for (;;) {
      const blocker = placed.find((other) => collides(next, other));
      if (!blocker) break;
      next.y = blocker.y + blocker.h;
    }
    while (next.y > 0 && !placed.some((other) => collides({ ...next, y: next.y - 1 }, other))) {
      next.y -= 1;
    }
    placed.push(next);
    resolved.set(next.id, next);
  }
  return clamped.map((item) => resolved.get(item.id));
}

export function findFreeSlot(items, size) {
  const { w, h } = clampLayout({ x: 0, y: 0, ...size });
  const bottom = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + w <= gridColumns; x += 1) {
      if (!items.some((item) => collides({ x, y, w, h }, item))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

export function newWidgetLayout(items, type) {
  const size = DEFAULT_WIDGET_SIZE[type];
  return { ...findFreeSlot(items, size), ...size };
}

/** `normalizeWidgets`: clamp, de-overlap and compact the layouts of a widget list. */
export function normalizeWidgets(widgets) {
  const items = normalizeLayout(widgets.map((w) => ({ id: w.id, ...w.layout })));
  const byId = new Map(items.map((item) => [item.id, item]));
  return widgets.map((w) => {
    const item = byId.get(w.id);
    return { ...w, layout: { x: item.x, y: item.y, w: item.w, h: item.h } };
  });
}

// ---- widget settings: the readable form (column titles, label texts) <-> the stored form ----------

const isNumericColumn = (c) =>
  c.type === 'numbers' ||
  c.type === 'progress' ||
  (c.type === 'formula' && c.settings?.outputType === 'number');
const isType =
  (...types) =>
  (c) =>
    types.includes(c.type);
const anyColumn = (c) => columnRegistry.has(c.type);

/**
 * Per widget type: the readable fields and how each maps to a stored field. `column`: one column id
 * (`accept` filters the column types, `group` also allows the board groups); `columns`: a list of
 * column ids; `labels`: status label ids of the column named by `of`; `filter`: `{ column, labels }`;
 * `plain`: copied as is (checked by the shared schema).
 */
const SPECS = {
  chart: {
    chartType: { to: 'chartType', plain: true },
    x: {
      to: 'xColumnId',
      column: isType('status', 'people', 'dropdown', 'date', 'timeline'),
      group: true,
    },
    dateBucket: { to: 'dateBucket', plain: true },
    stack: { to: 'stackColumnId', column: isType('status', 'people', 'dropdown'), group: true },
    yMode: { to: 'yMode', plain: true },
    y: { to: 'yColumnId', column: isNumericColumn },
    sortBy: { to: 'sortBy', plain: true },
    showLegend: { to: 'showLegend', plain: true },
    showValues: { to: 'showValues', plain: true },
    showEmpty: { to: 'showEmpty', plain: true },
  },
  numbers: {
    mode: { to: 'mode', plain: true },
    column: { to: 'columnId', column: isNumericColumn },
    filter: { to: 'filter', filter: true },
  },
  battery: {
    statusColumn: { to: 'statusColumnId', column: isType('status') },
    doneLabels: { to: 'doneLabelIds', labels: 'statusColumnId' },
  },
  table: {
    columns: { to: 'columnIds', columns: anyColumn },
    filter: { to: 'filter', filter: true },
    rowLimit: { to: 'rowLimit', plain: true },
  },
  workload: {
    peopleColumn: { to: 'peopleColumnId', column: isType('people') },
    dateColumn: { to: 'dateColumnId', column: isType('date', 'timeline') },
    bucket: { to: 'bucket', plain: true },
  },
};

/** The readable fields of every widget type, for error messages and the tool description. */
export const WIDGET_SETTING_KEYS = Object.fromEntries(
  Object.entries(SPECS).map(([type, spec]) => [type, Object.keys(spec)]),
);

/** The column `ref` (id or title) on the first of `boards` that has a matching, accepted column. */
function findColumnAcross(boards, ref, accept, what) {
  if (typeof ref !== 'string' || ref.trim() === '') {
    throw new McpUserError(`Give ${what} as a column title or id.`);
  }
  if (boards.length === 0) {
    throw new McpUserError(
      `Cannot resolve ${what} "${ref}": the widget reads no boards. Add boards to the dashboard first.`,
    );
  }
  let wrongType = null;
  for (const board of boards) {
    const direct = board.columns.find((c) => c.id === ref);
    const named = board.columns.filter((c) => norm(c.title) === norm(ref));
    const candidates = direct ? [direct] : named;
    const ok = candidates.filter(accept);
    if (ok.length > 1) {
      throw new McpUserError(
        `More than one column is called "${ref}" on board "${board.name}" (ids: ${ok.map((c) => c.id).join(', ')}). Use the id instead.`,
      );
    }
    if (ok.length === 1) return { column: ok[0], board };
    if (candidates.length > 0) wrongType ??= candidates[0];
  }
  if (wrongType) {
    throw new McpUserError(
      `Column "${wrongType.title}" (${wrongType.type}) cannot be used for ${what}.`,
    );
  }
  const known = [...new Set(boards.flatMap((b) => b.columns.filter(accept).map((c) => c.title)))];
  throw new McpUserError(
    `No column "${ref}" for ${what} on the widget's boards. Available: ${known.map((t) => `"${t}"`).join(', ') || 'none'}.`,
  );
}

/** Status label texts to the ids of `column`'s labels (case-insensitive). */
function labelIds(column, texts, what) {
  if (!Array.isArray(texts) || texts.some((t) => typeof t !== 'string')) {
    throw new McpUserError(`${what} must be a list of status label texts.`);
  }
  const labels = column.settings?.labels ?? [];
  return [
    ...new Set(
      texts.map((text) => {
        const found = labels.find((l) => norm(l.label) === norm(text) && l.label.trim() !== '');
        if (!found) {
          const known = labels.map((l) => `"${l.label}"`).join(', ') || 'none';
          throw new McpUserError(
            `Column "${column.title}" has no label "${text}". Labels: ${known}.`,
          );
        }
        return found.id;
      }),
    ),
  ];
}

/**
 * The stored settings for `type`: `base` (the widget's stored settings, or the type's defaults) with
 * the readable fields in `input` converted and applied. Throws a plain error for an unknown field.
 * `boards` are the boards the widget reads: `{ id, name, columns }`.
 */
export function storedSettings(type, base, input, boards) {
  const spec = SPECS[type];
  if (input === undefined || input === null) return clone(base);
  if (!isObject(input)) throw new McpUserError('settings must be an object.');
  for (const key of Object.keys(input)) {
    if (!spec[key]) {
      throw new McpUserError(
        `Unknown ${type} setting "${key}". Settings: ${WIDGET_SETTING_KEYS[type].join(', ')}.`,
      );
    }
  }
  const out = clone(base);
  // Resolve the columns first: a labels field needs the column it belongs to.
  for (const [key, def] of Object.entries(spec)) {
    if (!(key in input) || !(def.column || def.columns)) continue;
    const value = input[key];
    if (def.column) {
      if (value === null) out[def.to] = null;
      else if (def.group && value === GROUP_AXIS) out[def.to] = GROUP_AXIS;
      else out[def.to] = findColumnAcross(boards, value, def.column, `"${key}"`).column.id;
    } else {
      if (!Array.isArray(value))
        throw new McpUserError(`"${key}" must be a list of column titles.`);
      out[def.to] = value.map(
        (ref) => findColumnAcross(boards, ref, def.columns, `"${key}"`).column.id,
      );
    }
  }
  for (const [key, def] of Object.entries(spec)) {
    if (!(key in input)) continue;
    const value = input[key];
    if (def.plain) out[def.to] = value;
    else if (def.filter) {
      if (value === null) {
        out[def.to] = null;
      } else {
        if (!isObject(value) || typeof value.column !== 'string') {
          throw new McpUserError(
            'filter must be { column, labels: [status label texts] } or null.',
          );
        }
        const { column } = findColumnAcross(boards, value.column, isType('status'), 'the filter');
        out[def.to] = {
          columnId: column.id,
          values: labelIds(column, value.labels ?? [], 'filter.labels'),
        };
      }
    } else if (def.labels) {
      const columnId = out[def.labels];
      // Without a chosen column the widget reads each board's first status column: take the labels
      // from the first board that has one.
      const column = columnId
        ? boards.flatMap((b) => b.columns).find((c) => c.id === columnId)
        : boards.flatMap((b) => b.columns).find((c) => c.type === 'status');
      if (!column) {
        throw new McpUserError(`The widget's boards have no status column to take "${key}" from.`);
      }
      out[def.to] = labelIds(column, value, key);
    }
  }
  return out;
}

/** The readable form of stored settings (titles and label texts), in the shape the tools accept. */
export function readableSettings(type, settings, boards) {
  const spec = SPECS[type];
  const titleOf = (id) => {
    for (const board of boards) {
      const column = board.columns.find((c) => c.id === id);
      if (column) return column.title;
    }
    return id;
  };
  const labelsOf = (columnId, ids) => {
    const all = boards.flatMap((b) => b.columns);
    const labels = (
      columnId ? all.find((c) => c.id === columnId) : all.find((c) => c.type === 'status')
    )?.settings?.labels;
    return ids.map((id) => labels?.find((l) => l.id === id)?.label ?? id);
  };
  const out = {};
  for (const [key, def] of Object.entries(spec)) {
    const value = settings?.[def.to];
    if (value === undefined) continue;
    if (def.plain) out[key] = value;
    else if (def.column) out[key] = value === null || value === GROUP_AXIS ? value : titleOf(value);
    else if (def.columns) out[key] = value.map(titleOf);
    else if (def.filter) {
      out[key] =
        value === null
          ? null
          : { column: titleOf(value.columnId), labels: labelsOf(value.columnId, value.values) };
    } else if (def.labels) out[key] = labelsOf(settings[def.labels], value);
  }
  return out;
}

// ---- computed widget values (numbers, battery): mirrors numbers-model.ts and battery-model.ts ------

const numberOf = (raw) => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (isObject(raw) && 'progress' in raw) return numberOf(raw.progress);
  return null;
};

/** The column `columnId` points at on `board`: by id, then (on other boards) by type and title. */
function resolveColumn(all, board, columnId) {
  if (!columnId) return null;
  const direct = board.columns.find((c) => c.id === columnId);
  if (direct) return direct;
  let reference = null;
  for (const other of all) {
    reference = other.columns.find((c) => c.id === columnId) ?? null;
    if (reference) break;
  }
  if (!reference) return null;
  return (
    board.columns.find(
      (c) => c.type === reference.type && norm(c.title) === norm(reference.title),
    ) ?? null
  );
}

function itemContext(board, item) {
  return {
    boardId: board.id,
    columns: board.columns,
    item: {
      id: item.id,
      values: item.data.values ?? {},
      createdAt: item.data.createdAt,
      createdBy: item.data.createdBy,
      updatedAt: item.data.updatedAt,
      updatedBy: item.data.updatedBy,
      groupId: item.data.groupId,
      seq: item.data.seq,
      boardSeq: item.data.boardSeq,
    },
  };
}

function readNumber(board, item, column) {
  if (columnRegistry.isDerived(column.type)) {
    try {
      return numberOf(columnRegistry.computeValue(column, itemContext(board, item)));
    } catch {
      return null;
    }
  }
  return numberOf(item.data.values?.[column.id]);
}

function readStatusLabel(item, column) {
  const raw = item.data.values?.[column.id];
  if (!isObject(raw)) return null;
  if (!Array.isArray(column.settings?.labels)) return null;
  const label = findStatusLabel(raw, column.settings);
  return label && label.label.trim() !== '' ? label : null;
}

const widgetBoardsOf = (all, widgetBoardIds) =>
  widgetBoardIds.length === 0 ? [...all] : all.filter((b) => widgetBoardIds.includes(b.id));

function numbersValue(boardsAll, widget) {
  const boards = widgetBoardsOf(boardsAll, widget.boardIds);
  const { settings } = widget;
  const valueExists =
    settings.columnId !== null && boards.some((b) => resolveColumn(boards, b, settings.columnId));
  const mode = settings.mode !== 'count' && !valueExists ? 'count' : settings.mode;
  const filter = settings.filter && settings.filter.values.length > 0 ? settings.filter : null;
  let texts = null;
  if (filter) {
    const wanted = new Set(filter.values);
    texts = new Set();
    for (const board of boards) {
      const column = board.columns.find((c) => c.id === filter.columnId);
      if (!column || column.type !== 'status') continue;
      for (const label of column.settings?.labels ?? []) {
        if (wanted.has(label.id)) texts.add(norm(label.label));
      }
    }
  }
  let itemCount = 0;
  let numberCount = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const board of boards) {
    const valueColumn = mode === 'count' ? null : resolveColumn(boards, board, settings.columnId);
    const filterColumn = filter ? resolveColumn(boards, board, filter.columnId) : null;
    if (filter && !filterColumn) continue;
    if (mode !== 'count' && !valueColumn) continue;
    for (const item of board.items) {
      if (filterColumn && texts) {
        const label = readStatusLabel(item, filterColumn);
        if (!label || !texts.has(norm(label.label))) continue;
      }
      itemCount += 1;
      if (!valueColumn) continue;
      const n = readNumber(board, item, valueColumn);
      if (n === null) continue;
      numberCount += 1;
      sum += n;
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
  }
  const value =
    mode === 'count'
      ? itemCount
      : mode === 'sum'
        ? sum
        : numberCount === 0
          ? null
          : mode === 'average'
            ? sum / numberCount
            : mode === 'min'
              ? min
              : max;
  return {
    mode,
    value,
    itemCount,
    numberCount,
    ...(mode !== settings.mode ? { fellBackToCount: true } : {}),
  };
}

function batteryValue(boardsAll, widget) {
  const boards = widgetBoardsOf(boardsAll, widget.boardIds);
  const { settings } = widget;
  const doneIds = new Set(settings.doneLabelIds);
  const useFlag = doneIds.size === 0;
  const order = [];
  const segments = new Map();
  let empty = 0;
  let total = 0;
  let doneCount = 0;
  let withoutStatus = 0;
  for (const board of boards) {
    const column =
      settings.statusColumnId !== null
        ? resolveColumn(boards, board, settings.statusColumnId)
        : (board.columns.find((c) => c.type === 'status') ?? null);
    if (!column || column.type !== 'status') {
      withoutStatus += 1;
      continue;
    }
    for (const l of (column.settings?.labels ?? []).filter((x) => x.label.trim() !== '')) {
      const key = norm(l.label);
      if (!segments.has(key)) {
        order.push(key);
        segments.set(key, { label: l.label.trim(), count: 0, done: false });
      }
    }
    for (const item of board.items) {
      total += 1;
      const label = readStatusLabel(item, column);
      if (!label) {
        empty += 1;
        continue;
      }
      const segment = segments.get(norm(label.label));
      segment.count += 1;
      if (useFlag ? label.isDone === true : doneIds.has(label.id)) {
        segment.done = true;
        doneCount += 1;
      }
    }
  }
  const out = order.map((k) => segments.get(k)).filter((s) => s.count > 0);
  if (empty > 0) out.push({ label: 'Not set', count: empty, done: false });
  return {
    total,
    doneCount,
    percent: total === 0 ? 0 : Math.round((doneCount / total) * 100),
    segments: out,
    boardsWithoutStatus: withoutStatus,
  };
}

/** The computed value of a numbers or battery widget; `undefined` for the other types. */
export function computeWidget(boards, widget) {
  if (widget.type === 'numbers') return numbersValue(boards, widget);
  if (widget.type === 'battery') return batteryValue(boards, widget);
  return undefined;
}

// ---- the service -------------------------------------------------------------------------------

export function dashboardsService(h) {
  const { client, uid, now, resolveWorkspace, roleOn, itemsOf, iso } = h;

  /**
   * Loads a dashboard and applies the safety checks. `need` is 'read', 'edit' or 'owner'. A dashboard
   * outside the actor's workspaces, or one they have no role on, reads as "not found".
   */
  async function loadDashboard(dashboardId, need = 'edit', { states = ['active'] } = {}) {
    assertId(dashboardId, 'dashboardId');
    const meta = await client.getDocMeta(`dashboards/${dashboardId}`);
    const notFound = new McpUserError(
      `Dashboard "${dashboardId}" was not found in your workspaces.`,
    );
    if (!meta) throw notFound;
    const role = await roleOn(meta.data);
    if (!role) throw notFound;
    if (!states.includes(meta.data.state)) {
      throw new McpUserError(
        meta.data.state === 'deleted'
          ? `Dashboard "${dashboardId}" is in the trash.`
          : `Dashboard "${dashboardId}" is ${meta.data.state}, not active.`,
      );
    }
    if (need === 'owner' && role !== 'owner') {
      throw new McpUserError('Only the dashboard owner can do this.');
    }
    if (need === 'edit' && !EDIT_ROLES.includes(role)) {
      throw new McpUserError('You can only view this dashboard.');
    }
    return { id: dashboardId, dash: meta.data, updateTime: meta.updateTime, role };
  }

  /**
   * The boards behind `ids`, in that order: `readable` (active boards the actor can read, with their
   * name and columns), `unreadable` (missing, or no role) and `inactive` (archived or in the trash).
   */
  async function boardsById(ids) {
    const readable = [];
    const unreadable = [];
    const inactive = [];
    for (const id of ids) {
      const meta = await client.getDocMeta(`boards/${id}`).catch(() => null);
      if (!meta || !(await roleOn(meta.data))) {
        unreadable.push(id);
      } else if (meta.data.state !== 'active') {
        inactive.push(id);
      } else {
        readable.push({
          id,
          name: meta.data.name ?? id,
          columns: Array.isArray(meta.data.columns) ? meta.data.columns : [],
          workspaceId: meta.data.workspaceId,
        });
      }
    }
    return { readable, unreadable, inactive };
  }

  /** Active boards of a workspace the actor can read. */
  async function workspaceBoards(workspaceId) {
    const rows = await client.runQuery('boards', { workspaceId, state: 'active' });
    const out = [];
    for (const row of rows) {
      if (!(await roleOn(row.data))) continue;
      out.push({
        id: row.id,
        name: row.data.name ?? row.id,
        columns: Array.isArray(row.data.columns) ? row.data.columns : [],
        workspaceId,
      });
    }
    return out;
  }

  /** Board refs (ids or names) to boards of `candidates`; an unknown or ambiguous one is an error. */
  function pickBoards(candidates, refs, what = 'the workspace') {
    if (!Array.isArray(refs))
      throw new McpUserError('boards must be a list of board names or ids.');
    const out = [];
    for (const ref of refs) {
      if (typeof ref !== 'string' || ref.trim() === '') {
        throw new McpUserError('Give each board as a name or an id.');
      }
      const byId = candidates.find((b) => b.id === ref);
      const named = candidates.filter((b) => norm(b.name) === norm(ref));
      if (!byId && named.length > 1) {
        throw new McpUserError(
          `More than one board is called "${ref}" (ids: ${named.map((b) => b.id).join(', ')}). Use the id instead.`,
        );
      }
      const found = byId ?? named[0];
      if (!found) {
        const known = candidates.map((b) => `"${b.name}"`).join(', ') || 'none';
        throw new McpUserError(
          `No board "${ref}" among the boards you can read in ${what}. Boards: ${known}.`,
        );
      }
      if (!out.some((b) => b.id === found.id)) out.push(found);
    }
    return out;
  }

  /** A widget's boards as `{ id, name, columns }` for resolving columns: its own list, else all of the dashboard's. */
  const readsBoards = (dashBoards, widgetBoardIds) => widgetBoardsOf(dashBoards, widgetBoardIds);

  /** Widget `boards` refs to ids: only boards that are on the dashboard (readable ones by name or id). */
  function widgetBoardIdsOf(refs, dashBoards, dashboardBoardIds) {
    if (refs === undefined) return undefined;
    if (!Array.isArray(refs))
      throw new McpUserError('boards must be a list of board names or ids.');
    const ids = [];
    for (const ref of refs) {
      const known = dashBoards.find((b) => b.id === ref || norm(b.name) === norm(ref));
      if (known) {
        const named = dashBoards.filter((b) => norm(b.name) === norm(ref));
        if (!dashBoards.some((b) => b.id === ref) && named.length > 1) {
          throw new McpUserError(
            `More than one board on the dashboard is called "${ref}" (ids: ${named.map((b) => b.id).join(', ')}). Use the id instead.`,
          );
        }
        ids.push(known.id);
      } else if (dashboardBoardIds.includes(ref)) {
        ids.push(ref);
      } else {
        throw new McpUserError(
          `A widget can only read boards that are on the dashboard; "${ref}" is not.`,
        );
      }
    }
    return [...new Set(ids)];
  }

  const checkTitle = (title) => {
    const trimmed = String(title).trim();
    if (trimmed.length > DASHBOARD_LIMITS.widgetTitle) {
      throw new McpUserError(
        `A widget title is at most ${DASHBOARD_LIMITS.widgetTitle} characters.`,
      );
    }
    return trimmed;
  };

  /** A new widget in the first free slot of `existing`, as the web's `buildWidget`. */
  function buildWidget(existing, input, dashBoards, dashboardBoardIds) {
    if (!isObject(input) || !DASHBOARD_WIDGET_TYPES.includes(input.type)) {
      throw new McpUserError(`A widget needs a type: ${DASHBOARD_WIDGET_TYPES.join(', ')}.`);
    }
    const boardIds = widgetBoardIdsOf(input.boards, dashBoards, dashboardBoardIds) ?? [];
    const title =
      input.title === undefined || String(input.title).trim() === ''
        ? DEFAULT_TITLE[input.type]
        : checkTitle(input.title);
    const settings = storedSettings(
      input.type,
      defaultWidgetSettings(input.type),
      input.settings,
      readsBoards(dashBoards, boardIds),
    );
    return {
      id: newSlugId(),
      type: input.type,
      title,
      layout: newWidgetLayout(
        existing.map((w) => ({ id: w.id, ...w.layout })),
        input.type,
      ),
      boardIds,
      settings,
    };
  }

  /** Throws a readable error when the widgets are invalid or point outside the dashboard's boards. */
  function assertValidWidgets(widgets, boardIds) {
    const parsed = dashboardWidgetsSchema.safeParse(widgets);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
        .join('; ');
      throw new McpUserError(`The widgets are not valid: ${detail}`);
    }
    const allowed = new Set(boardIds);
    if (parsed.data.some((w) => w.boardIds.some((id) => !allowed.has(id)))) {
      throw new McpUserError('A widget can only read boards that are on the dashboard.');
    }
    return parsed.data;
  }

  /** The widget as the tools show it: titles and label texts, its boards by name, never raw column ids. */
  function readableWidget(widget, dashBoards, computed) {
    const reads = readsBoards(dashBoards, widget.boardIds);
    const nameOf = (id) => dashBoards.find((b) => b.id === id)?.name ?? null;
    return {
      id: widget.id,
      type: widget.type,
      title: widget.title,
      layout: widget.layout,
      boards: widget.boardIds.map((id) => ({ id, name: nameOf(id) })),
      settings: readableSettings(widget.type, widget.settings, reads),
      ...(computed === undefined ? {} : { data: computed }),
    };
  }

  const shapeRow = (id, data, role) => ({
    id,
    name: data.name,
    kind: data.kind,
    role,
    state: data.state,
    boards: Array.isArray(data.boardIds) ? data.boardIds.length : 0,
    widgets: Array.isArray(data.widgets) ? data.widgets.length : 0,
    updatedAt: iso(data.updatedAt),
  });

  /** Read-modify-write of the dashboard with an `updateTime` precondition; retried once on a race. */
  async function patchDashboard(dashboardId, need, states, build) {
    for (let attempt = 0; ; attempt += 1) {
      const loaded = await loadDashboard(dashboardId, need, { states });
      const { patch, result } = await build(loaded);
      try {
        await client.commit([
          {
            op: 'patch',
            path: `dashboards/${dashboardId}`,
            data: { ...patch, updatedAt: now(), updatedBy: uid },
            precondition: { updateTime: loaded.updateTime },
          },
        ]);
        return result;
      } catch (error) {
        const raced = error?.status === 409 || error?.status === 400;
        if (!raced || attempt >= 1) throw error;
      }
    }
  }

  return {
    async listDashboards({ workspaceId, state = 'active' } = {}) {
      const ws = await resolveWorkspace(workspaceId);
      const rows = await client.runQuery('dashboards', { workspaceId: ws.id, state });
      const list = [];
      for (const row of rows) {
        // As the rules' list: main dashboards, or dashboards that list the actor in `accessUids`.
        if (row.data.kind !== 'main' && !(row.data.accessUids ?? []).includes(uid)) continue;
        const role = await roleOn(row.data);
        if (!role) continue;
        list.push({ position: row.data.position ?? '', ...shapeRow(row.id, row.data, role) });
      }
      list.sort((a, b) =>
        a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1,
      );
      return {
        workspaceId: ws.id,
        dashboards: list.map(({ position: _position, ...dashboard }) => dashboard),
      };
    },

    async getDashboard({ dashboardId }) {
      const { dash, role } = await loadDashboard(dashboardId, 'read');
      const widgets = Array.isArray(dash.widgets) ? dash.widgets : [];
      const boardIds = Array.isArray(dash.boardIds) ? dash.boardIds : [];
      const { readable, unreadable, inactive } = await boardsById(boardIds);
      // Items only for the boards a numbers or battery widget reads.
      const needsItems = widgets.some((w) => w.type === 'numbers' || w.type === 'battery');
      const withItems = needsItems
        ? await Promise.all(
            readable.map(async (board) => ({
              ...board,
              items: (await itemsOf(board.id)).filter((item) => item.data.state === 'active'),
            })),
          )
        : readable.map((board) => ({ ...board, items: [] }));
      return {
        id: dashboardId,
        workspaceId: dash.workspaceId,
        name: dash.name,
        kind: dash.kind,
        role,
        updatedAt: iso(dash.updatedAt),
        boards: boardIds.map((id) => ({
          id,
          name: readable.find((b) => b.id === id)?.name ?? null,
        })),
        ...(unreadable.length > 0 ? { unreadableBoardIds: unreadable } : {}),
        ...(inactive.length > 0 ? { inactiveBoardIds: inactive } : {}),
        widgets: widgets.map((w) =>
          readableWidget(w, readable, needsItems ? computeWidget(withItems, w) : undefined),
        ),
      };
    },

    async createDashboard({ name, workspaceId, kind = 'main', boards = [], widgets = [] }) {
      if (!KINDS.includes(kind)) throw new McpUserError(`kind must be ${KINDS.join(', ')}.`);
      const parsedInput = createDashboardInputSchema.safeParse({ name, kind });
      if (!parsedInput.success) {
        throw new McpUserError(`Name must be 1 to ${DASHBOARD_LIMITS.name} characters.`);
      }
      if (!Array.isArray(widgets)) throw new McpUserError('widgets must be a list.');
      if (widgets.length > DASHBOARD_LIMITS.widgets) {
        throw new McpUserError(`A dashboard can hold at most ${DASHBOARD_LIMITS.widgets} widgets.`);
      }
      const ws = await resolveWorkspace(workspaceId);
      if (!CREATE_BOARD_ROLES.includes(ws.role)) {
        throw new McpUserError(
          `Creating a dashboard needs the member role or higher in workspace "${ws.name}" (you are a ${ws.role}).`,
        );
      }
      const chosen = pickBoards(await workspaceBoards(ws.id), boards, `workspace "${ws.name}"`);
      if (chosen.length > DASHBOARD_LIMITS.boards) {
        throw new McpUserError(`A dashboard can read at most ${DASHBOARD_LIMITS.boards} boards.`);
      }
      const boardIds = chosen.map((b) => b.id);
      const built = [];
      for (const input of widgets) built.push(buildWidget(built, input, chosen, boardIds));
      const checked = assertValidWidgets(built, boardIds);

      // The end of the workspace root: after the last root position among boards, dashboards and docs.
      const [rootBoards, dashboards, docs] = await Promise.all(
        ['boards', 'dashboards', 'docs'].map((collection) =>
          client.runQuery(collection, { workspaceId: ws.id }),
        ),
      );
      const positions = [...rootBoards, ...dashboards, ...docs]
        .filter(
          (row) => (row.data.folderId ?? null) === null && typeof row.data.position === 'string',
        )
        .map((row) => row.data.position);
      const at = now();
      const id = newDocId();
      await client.commit([
        {
          op: 'set',
          path: `dashboards/${id}`,
          data: {
            workspaceId: ws.id,
            folderId: null,
            name: parsedInput.data.name,
            kind,
            access: { [uid]: 'owner' },
            accessUids: [uid],
            position: positionAfter(positions),
            icon: null,
            boardIds,
            widgets: checked,
            state: 'active',
            deletedAt: null,
            createdAt: at,
            createdBy: uid,
            updatedAt: at,
          },
          precondition: { exists: false },
        },
      ]);
      return {
        id,
        workspaceId: ws.id,
        name: parsedInput.data.name,
        kind,
        boards: chosen.map((b) => ({ id: b.id, name: b.name })),
        widgets: checked.map((w) => readableWidget(w, chosen)),
      };
    },

    async updateDashboard({ dashboardId, name, boards, addWidgets, updateWidgets, removeWidgets }) {
      if (
        name === undefined &&
        boards === undefined &&
        !addWidgets?.length &&
        !updateWidgets?.length &&
        !removeWidgets?.length
      ) {
        throw new McpUserError(
          'Nothing to change: give name, boards, addWidgets, updateWidgets or removeWidgets.',
        );
      }
      let trimmedName;
      if (name !== undefined) {
        trimmedName = String(name).trim();
        if (trimmedName.length < 1 || trimmedName.length > DASHBOARD_LIMITS.name) {
          throw new McpUserError(`Name must be 1 to ${DASHBOARD_LIMITS.name} characters.`);
        }
      }
      return patchDashboard(dashboardId, 'edit', ['active'], async ({ dash }) => {
        const patch = {};
        if (trimmedName !== undefined) patch.name = trimmedName;
        let boardIds = Array.isArray(dash.boardIds) ? [...dash.boardIds] : [];
        let widgets = (Array.isArray(dash.widgets) ? dash.widgets : []).map(clone);

        if (boards !== undefined) {
          const candidates = await workspaceBoards(dash.workspaceId);
          const chosen = pickBoards(candidates, boards, 'this workspace').map((b) => b.id);
          // Boards the actor cannot read stay: changing the list must not drop what they cannot see.
          const visible = new Set(candidates.map((b) => b.id));
          const kept = boardIds.filter((id) => !visible.has(id) && !chosen.includes(id));
          const next = [...chosen, ...kept];
          if (next.length > DASHBOARD_LIMITS.boards) {
            throw new McpUserError(
              `A dashboard can read at most ${DASHBOARD_LIMITS.boards} boards.`,
            );
          }
          const allowed = new Set(next);
          // Widgets lose the boards that left the dashboard, as the web's `setDashboardBoards`.
          widgets = widgets.map((w) =>
            w.boardIds.every((id) => allowed.has(id))
              ? w
              : { ...w, boardIds: w.boardIds.filter((id) => allowed.has(id)) },
          );
          boardIds = next;
          patch.boardIds = boardIds;
        }

        const { readable } = await boardsById(boardIds);
        const removed = [];
        if (removeWidgets?.length) {
          for (const widgetId of removeWidgets) {
            const found = widgets.find((w) => w.id === widgetId);
            if (!found) throw new McpUserError(`Widget "${widgetId}" is not on this dashboard.`);
            if (!removed.some((w) => w.id === widgetId)) removed.push(found);
          }
          const gone = new Set(removed.map((w) => w.id));
          widgets = normalizeWidgets(widgets.filter((w) => !gone.has(w.id)));
        }
        for (const change of updateWidgets ?? []) {
          const at = widgets.findIndex((w) => w.id === change?.widgetId);
          if (at < 0) {
            throw new McpUserError(`Widget "${change?.widgetId}" is not on this dashboard.`);
          }
          const current = widgets[at];
          const widgetBoardIds =
            widgetBoardIdsOf(change.boards, readable, boardIds) ?? current.boardIds;
          widgets[at] = {
            ...current,
            ...(change.title !== undefined
              ? {
                  title:
                    change.title.trim() === ''
                      ? DEFAULT_TITLE[current.type]
                      : checkTitle(change.title),
                }
              : {}),
            boardIds: widgetBoardIds,
            settings: storedSettings(
              current.type,
              current.settings,
              change.settings,
              readsBoards(readable, widgetBoardIds),
            ),
          };
        }
        const added = [];
        if (addWidgets?.length) {
          if (widgets.length + addWidgets.length > DASHBOARD_LIMITS.widgets) {
            throw new McpUserError(
              `A dashboard can hold at most ${DASHBOARD_LIMITS.widgets} widgets.`,
            );
          }
          for (const input of addWidgets) {
            const widget = buildWidget(widgets, input, readable, boardIds);
            added.push(widget.id);
            widgets.push(widget);
          }
        }
        const checked = assertValidWidgets(widgets, boardIds);
        if (
          removeWidgets?.length ||
          updateWidgets?.length ||
          addWidgets?.length ||
          boards !== undefined
        ) {
          patch.widgets = checked;
        }
        return {
          patch,
          result: {
            id: dashboardId,
            name: trimmedName ?? dash.name,
            boards: boardIds.map((id) => ({
              id,
              name: readable.find((b) => b.id === id)?.name ?? null,
            })),
            addedWidgetIds: added,
            removedWidgets: removed.map((w) => readableWidget(w, readable)),
            widgets: checked.map((w) => readableWidget(w, readable)),
          },
        };
      });
    },

    async deleteDashboard({ dashboardId }) {
      return patchDashboard(dashboardId, 'owner', ['active'], ({ dash }) => ({
        patch: { state: 'deleted', deletedAt: now() },
        result: {
          id: dashboardId,
          name: dash.name,
          state: 'deleted',
          widgets: Array.isArray(dash.widgets) ? dash.widgets.length : 0,
        },
      }));
    },

    async restoreDashboard({ dashboardId }) {
      const current = await loadDashboard(dashboardId, 'owner', { states: ['active', 'deleted'] });
      // Restoring a dashboard that is not in the trash changes nothing.
      if (current.dash.state === 'active') {
        return { id: dashboardId, name: current.dash.name, state: 'active' };
      }
      return patchDashboard(dashboardId, 'owner', ['deleted'], ({ dash }) => ({
        patch: { state: 'active', deletedAt: null },
        result: { id: dashboardId, name: dash.name, state: 'active' },
      }));
    },
  };
}
