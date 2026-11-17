// Service methods: board views and forms (`boards/{id}/views/{viewId}`). Receives the shared helpers
// of `createService` (see ../service.mjs).
//
// Mirrors the web (`apps/web/src/data/view-writes.ts`, `components/board-views/view-actions.ts`,
// `board-filters/*`, `components/board-table/table-model.ts`) and the rules for `views/{viewId}`
// (`viewKeysOk`, `viewSettingsOk`, `canWriteView`): a shared view follows board edit rights, a
// personal view belongs to its owner (any reader may keep their own), `main` is the fixed shared
// table that is never renamed, moved or deleted, and the owner and type never change.
import {
  FORM_LIMITS,
  FORM_NAME_COLUMN_ID,
  MAIN_VIEW_ID,
  MAIN_VIEW_NAME,
  MAIN_VIEW_POSITION,
  VIEW_LIMITS,
  boardViewSchema,
  calendarSettingsSchema,
  chartSettingsSchema,
  defaultCalendarSettings,
  defaultChartSettings,
  defaultFilesViewSettings,
  defaultFormSettings,
  defaultGanttSettings,
  defaultKanbanSettings,
  defaultTimelineViewSettings,
  defaultViewSettings,
  defaultWorkloadSettings,
  filesViewSettingsSchema,
  formPublishProblems,
  formSettingsSchema,
  ganttSettingsSchema,
  groupItems,
  isFormQuestionType,
  kanbanSettingsSchema,
  matchesFilter,
  sortItems,
  timelineViewSettingsSchema,
  viewSettingsSchema,
  workloadSettingsSchema,
} from '@atrium/shared';
import { newDocId, positionAfter, ts } from '../builders.mjs';
import { McpUserError } from '../errors.mjs';
import { findColumn, findGroup, sortedByPosition } from '../refs.mjs';
import { convertCellValue } from '../values.mjs';
import { EDIT_ROLES } from './constants.mjs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const TEXT_OPERATORS = ['is', 'is_not', 'contains', 'does_not_contain', 'is_empty', 'is_not_empty'];
const NUMERIC_OPERATORS = ['is', 'is_not', 'greater_than', 'less_than', 'is_empty', 'is_not_empty'];
const CHECKBOX_OPERATORS = ['is', 'is_not', 'is_empty', 'is_not_empty'];

/** The operators the web's filter builder offers for a column type (`getOperatorsForColumn`). */
function operatorsFor(type) {
  if (type === 'numbers' || type === 'date') return NUMERIC_OPERATORS;
  if (type === 'checkbox') return CHECKBOX_OPERATORS;
  return TEXT_OPERATORS;
}

/**
 * The per-type settings blocks: the shared schema, the web's defaults and which fields point at
 * columns (`types`: the column types the web's pickers offer; `many`: a list of columns).
 */
const TYPE_BLOCKS = {
  kanban: {
    schema: kanbanSettingsSchema,
    defaults: defaultKanbanSettings,
    refs: { columnId: { types: ['status'] }, cardColumnIds: { many: true } },
  },
  calendar: {
    schema: calendarSettingsSchema,
    defaults: defaultCalendarSettings,
    refs: { columnId: { types: ['date', 'timeline'] }, colorBy: { types: ['status'] } },
  },
  timeline: {
    schema: timelineViewSettingsSchema,
    defaults: defaultTimelineViewSettings,
    refs: { columnId: { types: ['timeline', 'date'] }, colorBy: { types: ['status'] } },
  },
  gantt: {
    schema: ganttSettingsSchema,
    defaults: defaultGanttSettings,
    refs: {
      columnId: { types: ['timeline', 'date'] },
      colorBy: { types: ['status'] },
      dependencyColumnId: { types: ['dependency'] },
      baselineColumnId: { types: ['timeline', 'date'] },
    },
  },
  workload: {
    schema: workloadSettingsSchema,
    defaults: defaultWorkloadSettings,
    refs: {
      columnId: { types: ['timeline', 'date'] },
      peopleColumnId: { types: ['people'] },
      sumColumnId: { types: ['numbers'] },
    },
  },
  chart: {
    schema: chartSettingsSchema,
    defaults: defaultChartSettings,
    refs: {
      xColumnId: { group: true },
      stackColumnId: { group: true },
      yColumnId: { types: ['numbers'] },
    },
  },
  files: {
    schema: filesViewSettingsSchema,
    defaults: defaultFilesViewSettings,
    refs: { columnIds: { many: true, types: ['files'] } },
  },
};

/** Everything a view document may hold at its top level and in its settings (the rules' key sets). */
const VIEW_KEYS = [
  'name',
  'type',
  'position',
  'ownerId',
  'settings',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
];
const SETTINGS_KEYS = [
  'filter',
  'hiddenColumnIds',
  'kanban',
  'calendar',
  'timeline',
  'gantt',
  'workload',
  'chart',
  'files',
  'form',
];
const FILTER_KEYS = ['personIds', 'filterGroup', 'sortConditions', 'groupByColumnId'];

/**
 * The rules' shape checks for a view document (`viewKeysOk`, `viewSettingsOk`, the name and position
 * limits), as a list of problems. The schema alone strips unknown keys; the rules refuse them.
 */
export function viewRulesProblems(doc) {
  const problems = [];
  const keys = Object.keys(doc);
  for (const key of VIEW_KEYS) if (!keys.includes(key)) problems.push(`missing ${key}`);
  for (const key of keys) if (!VIEW_KEYS.includes(key)) problems.push(`unknown key ${key}`);
  if (
    typeof doc.name !== 'string' ||
    doc.name.length < 1 ||
    doc.name.length > VIEW_LIMITS.nameMax
  ) {
    problems.push(`name must be 1 to ${VIEW_LIMITS.nameMax} characters`);
  }
  if (typeof doc.position !== 'string' || doc.position.length < 1 || doc.position.length > 64) {
    problems.push('position must be 1 to 64 characters');
  }
  const settings = doc.settings;
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    problems.push('settings must be a map');
    return problems;
  }
  for (const key of ['filter', 'hiddenColumnIds']) {
    if (!(key in settings)) problems.push(`settings.${key} is missing`);
  }
  for (const key of Object.keys(settings)) {
    if (!SETTINGS_KEYS.includes(key)) problems.push(`unknown settings key ${key}`);
  }
  if (!Array.isArray(settings.hiddenColumnIds) || settings.hiddenColumnIds.length > 200) {
    problems.push('hiddenColumnIds must be a list of at most 200');
  }
  const filter = settings.filter;
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
    problems.push('settings.filter must be a map');
  } else {
    for (const key of Object.keys(filter)) {
      if (!FILTER_KEYS.includes(key)) problems.push(`unknown filter key ${key}`);
    }
    if ((filter.personIds ?? []).length > 200) problems.push('at most 200 personIds');
    if ((filter.sortConditions ?? []).length > 10) problems.push('at most 10 sort conditions');
    if ((filter.filterGroup?.conditions ?? []).length > 50) problems.push('at most 50 conditions');
  }
  for (const key of SETTINGS_KEYS.slice(2)) {
    const block = settings[key];
    if (
      block !== undefined &&
      (block === null || typeof block !== 'object' || Array.isArray(block))
    ) {
      problems.push(`settings.${key} must be a map`);
    }
  }
  return problems;
}

/** `schema.safeParse` that throws a plain error naming what is wrong. */
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

const lower = (text) => String(text).trim().toLowerCase();
const clone = (value) => JSON.parse(JSON.stringify(value));

/** The label text of a status or dropdown column that matches `text` (case-insensitive). */
function labelText(column, text) {
  const labels = column.settings?.labels ?? [];
  const found = labels.find((l) => lower(l.label) === lower(text));
  if (!found) {
    const known = labels.map((l) => `"${l.label}"`).join(', ') || 'none';
    throw new McpUserError(`Column "${column.title}" has no label "${text}". Labels: ${known}.`);
  }
  return found.label;
}

export function viewsService(h) {
  const {
    client,
    uid,
    now,
    loadBoard,
    cellContext,
    memberProfiles,
    teamsOf,
    memberName,
    readContext,
    readValues,
    itemsOf,
  } = h;

  const viewsPath = (boardId) => `boards/${boardId}/views`;
  const formPath = (boardId, viewId) => `/forms/${boardId}/${viewId}`;
  const canEditRole = (role) => EDIT_ROLES.includes(role);

  const syntheticMain = () => ({
    id: MAIN_VIEW_ID,
    synthetic: true,
    updateTime: null,
    data: {
      name: MAIN_VIEW_NAME,
      type: 'table',
      position: MAIN_VIEW_POSITION,
      ownerId: null,
      settings: defaultViewSettings(),
    },
  });

  /** The views the actor sees: shared ones and their own personal ones; `main` first, then by position. */
  async function visibleViews(boardId) {
    const rows = await client.listAllDocs(viewsPath(boardId));
    const byId = new Map();
    for (const row of rows) {
      const ownerId = row.data.ownerId ?? null;
      if (ownerId !== null && ownerId !== uid) continue; // another person's personal view
      byId.set(row.id, {
        id: row.id,
        synthetic: false,
        updateTime: row.updateTime,
        data: row.data,
      });
    }
    const main = byId.get(MAIN_VIEW_ID) ?? syntheticMain();
    byId.delete(MAIN_VIEW_ID);
    const rest = [...byId.values()].sort(
      (a, b) =>
        (a.data.position < b.data.position ? -1 : a.data.position > b.data.position ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return [main, ...rest];
  }

  /** A visible view by id or case-insensitive name; refuses unknown and ambiguous names. */
  function pickView(views, ref) {
    const byId = views.find((v) => v.id === ref);
    if (byId) return byId;
    const byName = views.filter((v) => lower(v.data.name) === lower(ref));
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      throw new McpUserError(
        `More than one view is called "${ref}" (ids: ${byName.map((v) => v.id).join(', ')}). Use the id instead.`,
      );
    }
    const known = views.map((v) => `"${v.data.name}"`).join(', ');
    throw new McpUserError(`No view "${ref}" on this board. Views: ${known}.`);
  }

  /** Who a person or team id is, loaded once per call and only when a view needs it. */
  function nameLookup(workspaceId) {
    let pending;
    const load = () =>
      (pending ??= Promise.all([memberProfiles(workspaceId), teamsOf(workspaceId)]));
    return async () => {
      const [profiles, teams] = await load();
      return (id) =>
        teams.get(id)?.name ?? (profiles.has(id) ? memberName(profiles.get(id), id) : null);
    };
  }

  // ---- reading a view as readable JSON --------------------------------------------------------

  const titleOf = (board, columnId) =>
    columnId === FORM_NAME_COLUMN_ID
      ? 'name'
      : (board.columns.find((c) => c.id === columnId)?.title ?? columnId);

  /** Column fields of a type block turned from ids to titles, so the block can be fed back as input. */
  function readableBlock(type, block, board) {
    const spec = TYPE_BLOCKS[type];
    if (!spec || !block) return undefined;
    const out = { ...block };
    for (const [field, ref] of Object.entries(spec.refs)) {
      const value = out[field];
      if (value === null || value === undefined) continue;
      out[field] = ref.many
        ? value.map((id) => titleOf(board, id))
        : value === '__group'
          ? value
          : titleOf(board, value);
    }
    return out;
  }

  function readableForm(board, form, boardId, viewId) {
    if (!form) return undefined;
    const group = board.groups.find((g) => g.id === form.targetGroupId);
    return {
      title: form.title,
      description: form.description,
      thankYou: form.thankYou,
      targetGroup: group ? group.title : form.targetGroupId,
      acceptingResponses: form.acceptingResponses,
      questions: form.questions.map((q) => ({
        column: titleOf(board, q.columnId),
        label: q.label,
        ...(q.help ? { help: q.help } : {}),
        required: q.required,
      })),
      path: formPath(boardId, viewId),
    };
  }

  function conditionText(row) {
    const op = row.operator.replaceAll('_', ' ');
    if (row.value === undefined) return `${row.column} ${op}`;
    return `${row.column} ${op} ${row.valueName ?? row.value}`;
  }

  /**
   * One view as readable JSON, in the shape `atrium_create_view` takes (columns by title), plus its
   * id and who it belongs to. `names` resolves person and team ids when the view holds any.
   */
  async function describeView(loaded, view, names) {
    const { board } = loaded;
    const { data } = view;
    const settings = data.settings ?? defaultViewSettings();
    const filter = settings.filter ?? defaultViewSettings().filter;
    const lookup =
      (filter.personIds?.length ?? 0) > 0 || hasPeopleCondition(board, filter)
        ? await names()
        : () => null;
    const conditions = (filter.filterGroup?.conditions ?? []).map((c) => {
      const column = board.columns.find((col) => col.id === c.columnId);
      const row = {
        column: c.columnId === 'name' ? 'name' : (column?.title ?? c.columnId),
        operator: c.operator,
        ...(c.value === undefined || c.value === null || c.value === '' ? {} : { value: c.value }),
      };
      if (!column && c.columnId !== 'name') row.missing = true;
      if (column?.type === 'people' && typeof c.value === 'string') {
        const name = lookup(c.value);
        if (name) row.valueName = name;
      }
      return row;
    });
    const sort = (filter.sortConditions ?? []).map((s) => ({
      column:
        s.columnId === 'name' || s.columnId === '__name__' ? 'name' : titleOf(board, s.columnId),
      direction: s.direction,
    }));
    const personal = data.ownerId !== null && data.ownerId !== undefined;
    const readable = {
      id: view.id,
      name: data.name,
      type: data.type,
      personal,
      ...(personal ? { owner: data.ownerId === uid ? 'me' : data.ownerId } : {}),
      filter: {
        conjunction: filter.filterGroup?.conjunction ?? 'and',
        conditions: conditions.map(({ valueName: _n, missing: _m, ...rest }) => rest),
        personIds: filter.personIds ?? [],
      },
      sort,
      groupBy: filter.groupByColumnId ? titleOf(board, filter.groupByColumnId) : null,
      hiddenColumns: (settings.hiddenColumnIds ?? []).map((id) => titleOf(board, id)),
    };
    const block = readableBlock(data.type, settings[data.type], board);
    if (block) readable.settings = block;
    const form =
      data.type === 'form' ? readableForm(board, settings.form, loaded.id, view.id) : undefined;
    if (form) readable.settings = form;
    const parts = [];
    if (conditions.length > 0) {
      parts.push(
        `filter: ${conditions.map(conditionText).join(readable.filter.conjunction === 'or' ? ' OR ' : ' AND ')}`,
      );
    }
    if (readable.filter.personIds.length > 0) {
      parts.push(`people: ${readable.filter.personIds.map((id) => lookup(id) ?? id).join(', ')}`);
    }
    if (sort.length > 0)
      parts.push(`sorted by ${sort.map((s) => `${s.column} ${s.direction}`).join(', ')}`);
    if (readable.groupBy) parts.push(`grouped by ${readable.groupBy}`);
    if (readable.hiddenColumns.length > 0)
      parts.push(`hidden: ${readable.hiddenColumns.join(', ')}`);
    if (form) {
      parts.push(form.acceptingResponses ? 'form open for responses' : 'form closed');
    }
    return {
      ...readable,
      summary: parts.length > 0 ? parts.join('; ') : 'no filter, sort or grouping',
      ...(form ? { formPath: form.path } : {}),
      ...(view.synthetic ? { stored: false } : {}),
    };
  }

  function hasPeopleCondition(board, filter) {
    return (filter.filterGroup?.conditions ?? []).some(
      (c) => board.columns.find((col) => col.id === c.columnId)?.type === 'people',
    );
  }

  // ---- converting input into what the web stores ----------------------------------------------

  /** A column of the board for the filter, sort and group menus: by id or title; `name` is the item name. */
  function orderableColumn(board, ref, { allowName = false } = {}) {
    if (allowName && ref === 'name') return { id: 'name', type: 'text', title: 'name' };
    let column;
    try {
      column = findColumn(board, ref);
    } catch (error) {
      if (allowName && lower(ref) === 'item name')
        return { id: 'name', type: 'text', title: 'name' };
      throw error;
    }
    // The web's menus leave Mirror columns out: a mirror is computed in its cell and stored nowhere.
    if (column.type === 'mirror') {
      throw new McpUserError(
        `Column "${column.title}" is a mirror column; a view cannot filter, sort or group by it.`,
      );
    }
    return column;
  }

  /** People context for person and team inputs: member uids, emails and the workspace's teams. */
  async function peopleContext(loaded) {
    const ctx = await cellContext(loaded);
    const profiles = await memberProfiles(loaded.workspaceId);
    ctx.emailToUid = new Map();
    for (const memberUid of ctx.memberUids) {
      const email = profiles.get(memberUid)?.email;
      if (typeof email === 'string') ctx.emailToUid.set(email.trim().toLowerCase(), memberUid);
    }
    ctx.teams = [...(await teamsOf(loaded.workspaceId)).values()];
    return ctx;
  }

  const PEOPLE_COLUMN = { type: 'people', title: 'People', settings: {} };

  /** Ids of the people and teams named by inputs ("me", uid, email, "team:<name>"). */
  async function personIdsOf(loaded, inputs, ctxHolder) {
    ctxHolder.ctx ??= await peopleContext(loaded);
    const teamIds = new Set(ctxHolder.ctx.teams.map((t) => t.id));
    return inputs.flatMap((raw) => {
      // A bare team id (as a view reads back) is a team, like "team:<id>".
      const input = typeof raw === 'string' && teamIds.has(raw) ? `team:${raw}` : raw;
      const stored = convertCellValue(PEOPLE_COLUMN, input, ctxHolder.ctx);
      return stored.personsAndTeams.map((p) => p.id);
    });
  }

  /** One condition as the web's filter builder stores it (`{ columnId, operator, value }`). */
  async function convertCondition(loaded, condition, ctxHolder) {
    const { board } = loaded;
    const column = orderableColumn(board, condition.column, { allowName: true });
    const allowed = operatorsFor(column.type);
    if (!allowed.includes(condition.operator)) {
      throw new McpUserError(
        `Operator "${condition.operator}" is not available for ${column.type === 'text' && column.id === 'name' ? 'the item name' : `column "${column.title}" (${column.type})`}. Use one of: ${allowed.join(', ')}.`,
      );
    }
    if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') {
      return { columnId: column.id, operator: condition.operator };
    }
    const { value } = condition;
    if (value === undefined || value === null || value === '') {
      throw new McpUserError(
        `Give a value for "${column.title}" ${condition.operator.replaceAll('_', ' ')}.`,
      );
    }
    return {
      columnId: column.id,
      operator: condition.operator,
      value: await conditionValue(loaded, column, value, ctxHolder),
    };
  }

  async function conditionValue(loaded, column, value, ctxHolder) {
    switch (column.type) {
      case 'status':
      case 'dropdown':
        if (typeof value !== 'string') {
          throw new McpUserError(`Column "${column.title}" takes a label text.`);
        }
        return labelText(column, value);
      case 'checkbox': {
        if (typeof value === 'boolean') return value;
        const text = lower(value);
        if (text === 'checked' || text === 'true') return true;
        if (text === 'unchecked' || text === 'false') return false;
        throw new McpUserError(`Column "${column.title}" takes true or false.`);
      }
      case 'people': {
        const ids = await personIdsOf(loaded, [value], ctxHolder);
        if (ids.length !== 1) {
          throw new McpUserError(
            `Column "${column.title}" takes one person or team per condition.`,
          );
        }
        return ids[0];
      }
      case 'numbers': {
        const n = typeof value === 'number' ? value : Number(String(value).trim());
        if (!Number.isFinite(n) || String(value).trim() === '') {
          throw new McpUserError(`Column "${column.title}" takes a number.`);
        }
        return n;
      }
      case 'date': {
        const text = String(value).trim();
        if (!DATE_PATTERN.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
          throw new McpUserError(`Column "${column.title}" takes a date as "YYYY-MM-DD".`);
        }
        return text;
      }
      default:
        if (typeof value === 'object') {
          throw new McpUserError(`Column "${column.title}" takes a plain text value.`);
        }
        return String(value);
    }
  }

  /** The filter, sort, group and hidden-column parts of a view, from the current ones and the input. */
  async function buildState(loaded, current, input) {
    const { board } = loaded;
    const ctxHolder = {};
    const out = {
      filter: clone(current.filter ?? defaultViewSettings().filter),
      hiddenColumnIds: [...(current.hiddenColumnIds ?? [])],
    };
    const { filter, sort, groupBy, hiddenColumns } = input;
    if (filter !== undefined) {
      if (filter.conditions !== undefined) {
        const conditions = [];
        for (const condition of filter.conditions) {
          conditions.push(await convertCondition(loaded, condition, ctxHolder));
        }
        out.filter.filterGroup.conditions = conditions;
      }
      if (filter.conjunction !== undefined) out.filter.filterGroup.conjunction = filter.conjunction;
      if (filter.personIds !== undefined) {
        out.filter.personIds = [...new Set(await personIdsOf(loaded, filter.personIds, ctxHolder))];
      }
    }
    if (sort !== undefined) {
      out.filter.sortConditions = sort.map((s) => ({
        columnId: orderableColumn(board, s.column, { allowName: true }).id,
        direction: s.direction ?? 'asc',
      }));
    }
    if (groupBy !== undefined) {
      out.filter.groupByColumnId = groupBy === null ? null : orderableColumn(board, groupBy).id;
    }
    if (hiddenColumns !== undefined) {
      out.hiddenColumnIds = [
        ...new Set(hiddenColumns.map((ref) => orderableColumn(board, ref).id)),
      ];
    }
    return out;
  }

  /** A column reference in a type block (id or title) turned into an id, checked against the column types. */
  function blockColumn(board, field, spec, ref) {
    if (ref === null) return null;
    if (typeof ref !== 'string')
      throw new McpUserError(`settings.${field} takes a column title or id.`);
    if (spec.group && ref === '__group') return '__group';
    const column = findColumn(board, ref);
    if (spec.types && !spec.types.includes(column.type)) {
      throw new McpUserError(
        `settings.${field}: column "${column.title}" is a ${column.type} column; use a ${spec.types.join(' or ')} column.`,
      );
    }
    return column.id;
  }

  /** The settings block of a non-form type: defaults (or the current block) plus the given fields. */
  function buildTypeBlock(board, type, input, currentBlock) {
    const spec = TYPE_BLOCKS[type];
    if (!spec) {
      if (input !== undefined) {
        throw new McpUserError(
          type === 'table'
            ? 'A table view has no type settings.'
            : `settings do not apply to a ${type} view.`,
        );
      }
      return undefined;
    }
    const base = currentBlock ? clone(currentBlock) : spec.defaults();
    if (input === undefined) return base;
    const allowed = Object.keys(spec.schema.shape);
    for (const key of Object.keys(input)) {
      if (!allowed.includes(key)) {
        throw new McpUserError(
          `Unknown ${type} setting "${key}". Settings: ${allowed.join(', ')}.`,
        );
      }
    }
    const merged = { ...base };
    for (const [key, value] of Object.entries(input)) {
      const ref = spec.refs[key];
      if (!ref) merged[key] = value;
      else if (ref.many) {
        merged[key] =
          value === null
            ? null
            : (Array.isArray(value) ? value : [value]).map((one) =>
                blockColumn(board, key, ref, one),
              );
      } else merged[key] = blockColumn(board, key, ref, value);
    }
    return parseOrThrow(spec.schema, merged, `The ${type} settings`);
  }

  /**
   * The form block: the current one (or the web's defaults) plus the given fields. Questions are
   * `{ column, label?, help?, required? }`; the item name is always the first, required question.
   */
  function buildFormBlock(b, input, currentForm) {
    const allowed = [
      'title',
      'description',
      'thankYou',
      'targetGroup',
      'acceptingResponses',
      'questions',
    ];
    for (const key of Object.keys(input ?? {})) {
      if (!allowed.includes(key)) {
        throw new McpUserError(`Unknown form setting "${key}". Settings: ${allowed.join(', ')}.`);
      }
    }
    const firstGroup = sortedByPosition(b.groups)[0];
    if (!currentForm && !firstGroup) {
      throw new McpUserError('Add a group to the board before adding a form.');
    }
    const form = currentForm ? clone(currentForm) : defaultFormSettings(firstGroup.id);
    const given = input ?? {};
    for (const key of ['title', 'description', 'thankYou', 'acceptingResponses']) {
      if (given[key] !== undefined) form[key] = given[key];
    }
    if (given.targetGroup !== undefined) form.targetGroupId = findGroup(b, given.targetGroup).id;
    if (given.questions !== undefined)
      form.questions = buildQuestions(b, given.questions, form.questions);
    const parsed = parseOrThrow(formSettingsSchema, form, 'The form');
    if (parsed.acceptingResponses) {
      const problems = formPublishProblems(parsed, b);
      if (problems.length > 0) {
        throw new McpUserError(`The form cannot accept responses yet: ${problems.join(' ')}`);
      }
    }
    return parsed;
  }

  function buildQuestions(board, input, existing) {
    if (input.length > FORM_LIMITS.questions) {
      throw new McpUserError(`A form has at most ${FORM_LIMITS.questions} questions.`);
    }
    const old = new Map(existing.map((q) => [q.columnId, q]));
    const seen = new Set();
    const questions = [];
    for (const entry of input) {
      const isName =
        lower(entry.column) === 'name' ||
        lower(entry.column) === 'item name' ||
        entry.column === FORM_NAME_COLUMN_ID;
      let column = null;
      if (!isName) {
        column = findColumn(board, entry.column);
        if (!isFormQuestionType(column.type) || column.migrating) {
          throw new McpUserError(
            `Column "${column.title}" (${column.type}) cannot be a form question. Forms ask about: text, long_text, numbers, status, dropdown, date, checkbox, email, phone, link and rating columns.`,
          );
        }
      }
      const columnId = isName ? FORM_NAME_COLUMN_ID : column.id;
      if (seen.has(columnId)) {
        throw new McpUserError(
          `"${entry.column}" is asked twice; a column can be asked only once.`,
        );
      }
      seen.add(columnId);
      const before = old.get(columnId);
      const question = {
        columnId,
        label: (entry.label ?? before?.label ?? (isName ? 'Name' : column.title))
          .trim()
          .slice(0, FORM_LIMITS.labelMax),
        required: isName ? true : (entry.required ?? before?.required ?? false),
      };
      const help = entry.help === undefined ? before?.help : entry.help.trim();
      if (help) question.help = help;
      questions.push(question);
    }
    if (!seen.has(FORM_NAME_COLUMN_ID)) {
      const before = old.get(FORM_NAME_COLUMN_ID);
      questions.unshift({
        columnId: FORM_NAME_COLUMN_ID,
        label: before?.label ?? 'Name',
        required: true,
      });
    }
    // The name is always first; the rest keep the order given.
    questions.sort(
      (a, b) =>
        Number(b.columnId === FORM_NAME_COLUMN_ID) - Number(a.columnId === FORM_NAME_COLUMN_ID),
    );
    return questions;
  }

  /** Full settings for a view: state, then the type's block. Returns what would be lost too. */
  async function buildSettings(loaded, type, current, input) {
    const { board } = loaded;
    const state = await buildState(loaded, current, input);
    const settings = { ...state };
    const loss = [];
    if (type === 'form') {
      if (input.settings !== undefined || !current.form) {
        settings.form = buildFormBlock(board, input.settings, current.form);
      } else settings.form = current.form;
      const kept = new Set(settings.form.questions.map((q) => q.columnId));
      for (const q of current.form?.questions ?? []) {
        if (!kept.has(q.columnId)) {
          loss.push(
            `form question "${q.label}" (${titleOf(board, q.columnId)}); answers already submitted stay on their items`,
          );
        }
      }
    } else if (type !== 'table') {
      settings[type] = buildTypeBlock(board, type, input.settings, current[type]);
    } else {
      buildTypeBlock(board, type, input.settings, undefined);
    }
    const parsed = parseOrThrow(viewSettingsSchema, clone(settings), 'The view settings');
    return { settings: parsed, loss };
  }

  function assertDocShape(doc) {
    parseOrThrow(boardViewSchema, doc, 'The view');
    const problems = viewRulesProblems(doc);
    if (problems.length > 0) {
      throw new McpUserError(
        `The view would be refused by the security rules: ${problems.join('; ')}.`,
      );
    }
  }

  const cleanName = (name) => {
    const text = String(name).trim();
    if (text.length < 1 || text.length > VIEW_LIMITS.nameMax) {
      throw new McpUserError(`A view name is 1 to ${VIEW_LIMITS.nameMax} characters.`);
    }
    return text;
  };

  function assertNameFree(views, name, exceptId) {
    if (views.some((v) => v.id !== exceptId && lower(v.data.name) === lower(name))) {
      throw new McpUserError(`A view called "${name}" already exists on this board.`);
    }
  }

  /** May the actor change this view? Shared: board editors and owners. Personal: its owner. */
  function assertMayWrite(loaded, view, verb) {
    if (view.data.ownerId === null || view.data.ownerId === undefined) {
      if (!canEditRole(loaded.role)) {
        throw new McpUserError(
          `You can only view this board; only editors can ${verb} a shared view. Personal views are yours to change.`,
        );
      }
    } else if (view.data.ownerId !== uid) {
      throw new McpUserError(`View "${view.data.name}" was not found on this board.`);
    }
  }

  /** Runs a read-modify-write, once more when somebody changed the document in between. */
  async function retryOnce(run) {
    for (let tries = 0; ; tries += 1) {
      try {
        return await run();
      } catch (error) {
        const raced = error?.status === 409 || error?.status === 400;
        if (!raced || tries >= 1) throw error;
      }
    }
  }

  return {
    async listViews({ boardId }) {
      const loaded = await loadBoard(boardId, 'read');
      const views = await visibleViews(boardId);
      const names = nameLookup(loaded.workspaceId);
      const out = [];
      for (const view of views) {
        const described = await describeView(loaded, view, names);
        out.push({
          id: described.id,
          name: described.name,
          type: described.type,
          personal: described.personal,
          summary: described.summary,
          ...(described.formPath ? { formPath: described.formPath } : {}),
        });
      }
      return { boardId, views: out };
    },

    async getViewItems({ boardId, view: ref, limit = 50, offset = 0 }) {
      const loaded = await loadBoard(boardId, 'read');
      const { board } = loaded;
      const views = await visibleViews(boardId);
      const view = pickView(views, ref);
      if (view.data.type === 'form') {
        throw new McpUserError(
          `"${view.data.name}" is a form: its responses are ordinary items on the board; read them with atrium_find_items or atrium_get_board.`,
        );
      }
      const settings = view.data.settings ?? defaultViewSettings();
      const filter = settings.filter ?? defaultViewSettings().filter;
      const columns = board.columns;
      const docs = (await itemsOf(boardId)).filter(
        (d) => d.data.state === 'active' && !d.data.parentItemId,
      );
      const asItem = (d) => ({ id: d.id, ...d.data });
      const byId = new Map(docs.map((d) => [d.id, d]));
      const matches = (item) =>
        matchesFilter(item, filter.filterGroup, null, filter.personIds, columns);
      const sorts = filter.sortConditions ?? [];
      const compare = (a, b) =>
        (a.position < b.position ? -1 : a.position > b.position ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

      const names = nameLookup(loaded.workspaceId);
      let ordered = [];
      const groupColumn = filter.groupByColumnId
        ? columns.find((c) => c.id === filter.groupByColumnId)
        : undefined;
      const groupLabel = new Map();
      if (groupColumn) {
        const lookup = columns.some((c) => c.type === 'people') ? await names() : undefined;
        const filtered = docs.map(asItem).filter(matches);
        const grouped = groupItems(filtered, groupColumn.id, groupColumn, undefined, lookup);
        for (const group of grouped) {
          const shown = sorts.length > 0 ? sortItems(group.items, sorts, columns) : group.items;
          for (const item of shown) groupLabel.set(item.id, group.groupTitle);
          ordered.push(...shown);
        }
      } else {
        for (const group of sortedByPosition(board.groups)) {
          let shown = docs
            .filter((d) => d.data.groupId === group.id)
            .map(asItem)
            .sort(compare)
            .filter(matches);
          if (sorts.length > 0) shown = sortItems(shown, sorts, columns);
          ordered.push(...shown);
        }
        // Items in a group the board no longer lists come last, in position order.
        const known = new Set(board.groups.map((g) => g.id));
        const strays = docs
          .filter((d) => !known.has(d.data.groupId))
          .map(asItem)
          .sort(compare)
          .filter(matches);
        ordered.push(...(sorts.length > 0 ? sortItems(strays, sorts, columns) : strays));
      }
      const groupTitle = new Map(board.groups.map((g) => [g.id, g.title]));
      const context = await readContext(boardId, board.workspaceId, columns);
      const page = ordered.slice(offset, offset + limit).map((item) => ({
        id: item.id,
        seq: item.seq ?? null,
        name: item.name,
        group: groupTitle.get(item.groupId) ?? item.groupId,
        ...(groupLabel.has(item.id) ? { groupedBy: groupLabel.get(item.id) } : {}),
        values: readValues(context, byId.get(item.id), columns, (c) => c.title),
      }));
      return {
        view: await describeView(loaded, view, names),
        total: ordered.length,
        offset,
        shown: page.length,
        items: page,
        ...(offset + page.length < ordered.length ? { nextOffset: offset + page.length } : {}),
      };
    },

    async createView({
      boardId,
      name,
      type,
      personal = false,
      filter,
      sort,
      groupBy,
      hiddenColumns,
      settings,
    }) {
      const loaded = await loadBoard(boardId, 'read');
      if (!personal && !canEditRole(loaded.role)) {
        throw new McpUserError(
          'You can only view this board. Viewers can create personal views: give personal: true.',
        );
      }
      if (type === 'form' && personal) {
        throw new McpUserError('A form is a shared view: a personal form is not available.');
      }
      const title = cleanName(name);
      const views = await visibleViews(boardId);
      assertNameFree(views, title, null);
      const { settings: full } = await buildSettings(loaded, type, defaultViewSettings(), {
        filter,
        sort,
        groupBy,
        hiddenColumns,
        settings,
      });
      const stamp = ts(now());
      const doc = {
        name: title,
        type,
        position: positionAfter(
          views.filter((v) => v.id !== MAIN_VIEW_ID).map((v) => v.data.position),
        ),
        ownerId: personal ? uid : null,
        settings: full,
        createdAt: stamp,
        createdBy: uid,
        updatedAt: stamp,
        updatedBy: uid,
      };
      assertDocShape(doc);
      const viewId = newDocId();
      await client.commit([
        {
          op: 'set',
          path: `${viewsPath(boardId)}/${viewId}`,
          data: doc,
          precondition: { exists: false },
        },
      ]);
      const created = { id: viewId, synthetic: false, updateTime: null, data: doc };
      return { created: await describeView(loaded, created, nameLookup(loaded.workspaceId)) };
    },

    async updateView({
      boardId,
      view: ref,
      name,
      filter,
      sort,
      groupBy,
      hiddenColumns,
      settings,
      dryRun = false,
      allowDataLoss = false,
    }) {
      if ([name, filter, sort, groupBy, hiddenColumns, settings].every((v) => v === undefined)) {
        throw new McpUserError(
          'Nothing to change: give name, filter, sort, groupBy, hiddenColumns or settings.',
        );
      }
      return retryOnce(async () => {
        const loaded = await loadBoard(boardId, 'read');
        const views = await visibleViews(boardId);
        const view = pickView(views, ref);
        assertMayWrite(loaded, view, 'change');
        const isMain = view.id === MAIN_VIEW_ID;
        let title = view.data.name;
        if (name !== undefined) {
          if (isMain) throw new McpUserError('The Main table view cannot be renamed.');
          title = cleanName(name);
          assertNameFree(views, title, view.id);
        }
        const current = view.data.settings ?? defaultViewSettings();
        const { settings: full, loss } = await buildSettings(loaded, view.data.type, current, {
          filter,
          sort,
          groupBy,
          hiddenColumns,
          settings,
        });
        // Keep the type blocks this call did not touch.
        const nextSettings = { ...current, ...full };
        const stamp = ts(now());
        const doc = {
          ...view.data,
          name: title,
          settings: nextSettings,
          updatedAt: stamp,
          updatedBy: uid,
          ...(view.synthetic ? { createdAt: stamp, createdBy: uid } : {}),
        };
        assertDocShape({ ...doc, createdAt: stamp, updatedAt: stamp });
        const preview = await describeView(
          loaded,
          { ...view, data: doc },
          nameLookup(loaded.workspaceId),
        );
        if (dryRun) {
          return { dryRun: true, wouldLose: loss, view: preview };
        }
        if (loss.length > 0 && !allowDataLoss) {
          throw new McpUserError(
            `This change would drop: ${loss.join('; ')}. Run with dryRun: true to review, or allowDataLoss: true to proceed.`,
          );
        }
        const path = `${viewsPath(boardId)}/${view.id}`;
        if (view.synthetic) {
          // The built-in main view is only stored the first time somebody saves it.
          await client.commit([{ op: 'set', path, data: doc, precondition: { exists: false } }]);
        } else {
          await client.commit([
            {
              op: 'patch',
              path,
              data: { name: title, settings: nextSettings, updatedAt: stamp, updatedBy: uid },
              precondition: { updateTime: view.updateTime },
            },
          ]);
        }
        return { updated: preview, ...(loss.length > 0 ? { dropped: loss } : {}) };
      });
    },

    async deleteView({ boardId, view: ref }) {
      const loaded = await loadBoard(boardId, 'read');
      const views = await visibleViews(boardId);
      const view = pickView(views, ref);
      if (view.id === MAIN_VIEW_ID) {
        throw new McpUserError('The Main table view cannot be deleted.');
      }
      assertMayWrite(loaded, view, 'delete');
      const definition = await describeView(loaded, view, nameLookup(loaded.workspaceId));
      await client.commit([{ op: 'delete', path: `${viewsPath(boardId)}/${view.id}` }]);
      return {
        deleted: definition,
        note: 'The view is gone. To bring it back, call atrium_create_view with the same name, type, filter, sort, groupBy, hiddenColumns and settings (the form path changes with the new id; responses already submitted stay on their items).',
      };
    },
  };
}
