// Service methods: board automations (`boards/{id}/automations`, run history in `automationRuns`).
// Receives the shared helpers of `createService` (see ../service.mjs).
//
// An automation is a recipe that runs LATER, as the person who created it (`runAs`): it can notify
// people, write cells, create and move items. Both clients bypass the security rules, so every write
// mirrors them (`validAutomationCreate` and `validAutomationUpdate` in firestore.rules, the helpers
// in `apps/web/src/data/automations.ts`) and the readable input is converted to the stored shapes
// and checked with the same shared validators the web editor and the runner use
// (`automationTriggerSchema`, `automationConditionSchema`, `buttonActionSchema`, `validateAutomation`,
// `validateScheduledLimit`). Board owners only (rules: `canManageBoard`). Never written here:
// `nextRunAt` and `consecutiveFailures` (Functions) and `automationRuns` (Functions only).
import {
  AUTOMATION_LIMITS,
  BUTTON_LIMITS,
  automationConditionSchema,
  automationTimezoneSchema,
  automationTriggerSchema,
  buttonActionSchema,
  columnRegistry,
  isScheduledTrigger,
  validateAutomation,
  validateScheduledLimit,
} from '@atrium/shared';
import { newDocId } from '../builders.mjs';
import { McpUserError } from '../errors.mjs';
import { findColumn, findGroup } from '../refs.mjs';

const OWNER_MESSAGE = 'Automations are managed by board owners.';
const RUNS_WINDOW = 200;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The column types the web's condition editor offers (`CONDITION_COLUMN_TYPES` in recipe-draft.ts). */
const CONDITION_COLUMN_TYPES = ['status', 'dropdown', 'text', 'long_text', 'numbers', 'checkbox'];

const norm = (text) => String(text).trim().toLowerCase();
const clone = (value) => JSON.parse(JSON.stringify(value));
const millis = (value) => (value instanceof Date ? value.getTime() : Number.MAX_SAFE_INTEGER);

/** A zod failure as one plain sentence for the caller. */
function zodMessage(label, error) {
  const issue = error.issues[0];
  const path = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
  return `${label}: ${issue?.message ?? 'invalid'}${path}.`;
}

function parseWith(schema, label, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new McpUserError(zodMessage(label, parsed.error));
  return parsed.data;
}

export function automationsService(helpers) {
  const {
    client,
    uid,
    now,
    loadBoard,
    workspace,
    memberProfiles,
    memberName,
    sharedProfile,
    convertValues,
    iso,
  } = helpers;

  const automationsPath = (boardId) => `boards/${boardId}/automations`;

  async function automationDocs(boardId) {
    const rows = await client.listAllDocs(automationsPath(boardId));
    return rows.sort(
      (a, b) =>
        millis(a.data.createdAt) - millis(b.data.createdAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  /** One automation of the board by id or (unique) name. */
  function pickAutomation(rows, ref) {
    if (typeof ref !== 'string' || ref.trim() === '') {
      throw new McpUserError('Give the automation as an id or a name.');
    }
    const byId = rows.find((row) => row.id === ref);
    if (byId) return byId;
    const byName = rows.filter((row) => row.data.name !== '' && norm(row.data.name) === norm(ref));
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      throw new McpUserError(
        `More than one automation is called "${ref}" (ids: ${byName.map((r) => r.id).join(', ')}). Use the id.`,
      );
    }
    const known = rows.map((row) => `"${row.data.name || row.id}"`).join(', ') || 'none';
    throw new McpUserError(
      `No automation "${ref}" on this board. Call atrium_list_automations. Available: ${known}.`,
    );
  }

  /** What the conversions need besides the board: member profiles (names, emails) and the board. */
  async function recipeContext(loaded) {
    const ws = await workspace(loaded.workspaceId);
    const profiles = await memberProfiles(loaded.workspaceId);
    return { loaded, board: loaded.board, memberUids: ws.memberUids, profiles };
  }

  // ---- people ---------------------------------------------------------------------------------

  /** A workspace member by uid, email, "me" or display name (unique, case-insensitive). */
  function resolveMember(ctx, ref) {
    if (typeof ref !== 'string' || ref.trim() === '') {
      throw new McpUserError('Give each person as a uid, an email, a name or "me".');
    }
    const text = ref.trim();
    if (text === 'me') return uid;
    const memberUids = ctx.memberUids;
    if (memberUids.includes(text)) return text;
    const wanted = norm(text);
    const byEmail = memberUids.filter((m) => norm(ctx.profiles.get(m)?.email ?? '') === wanted);
    if (byEmail.length === 1) return byEmail[0];
    const byName = memberUids.filter(
      (m) => norm(ctx.profiles.get(m)?.displayName ?? '') === wanted,
    );
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      throw new McpUserError(`More than one member is called "${ref}". Use their email or uid.`);
    }
    throw new McpUserError(
      `"${ref}" is not a member of this workspace. Use a member's uid, email or name, or "me" (see atrium_list_members).`,
    );
  }

  const personName = (ctx, memberUid) => {
    const profile = ctx.profiles.get(memberUid);
    return profile ? memberName(profile, memberUid) : 'a former member';
  };

  // ---- readable -> stored ---------------------------------------------------------------------

  function triggerColumn(ctx, ref, type, trigger) {
    const column = findColumn(ctx.board, ref);
    if (column.type !== type) {
      throw new McpUserError(
        `Trigger "${trigger}" needs a ${type} column; "${column.title}" is a ${column.type} column.`,
      );
    }
    return column;
  }

  function weekdayOf(value) {
    if (typeof value === 'number') return value;
    const index = WEEKDAYS.findIndex((day) => norm(day) === norm(value));
    if (index < 0)
      throw new McpUserError(`"${value}" is not a weekday. Use 0 (Sunday) to 6 or a name.`);
    return index;
  }

  function buildTrigger(ctx, input) {
    const { board } = ctx;
    const out = { type: input.type };
    switch (input.type) {
      case 'item_created':
      case 'item_moved':
        if (input.group !== undefined) out.groupId = findGroup(board, input.group).id;
        break;
      case 'status_changed': {
        const column = triggerColumn(ctx, input.column, 'status', input.type);
        out.columnId = column.id;
        if (input.to !== undefined) {
          const labels = column.settings?.labels ?? [];
          const found = labels.find((l) => norm(l.label) === norm(input.to));
          if (!found) {
            const known = labels.map((l) => `"${l.label}"`).join(', ');
            throw new McpUserError(
              `"${input.to}" is not a label of column "${column.title}". Labels: ${known}.`,
            );
          }
          out.toLabelId = found.index;
        }
        break;
      }
      case 'button_clicked':
        out.columnId = triggerColumn(ctx, input.column, 'button', input.type).id;
        break;
      case 'person_assigned':
        out.columnId = triggerColumn(ctx, input.column, 'people', input.type).id;
        if (input.person !== undefined) out.uid = resolveMember(ctx, input.person);
        break;
      case 'date_arrives':
        out.columnId = triggerColumn(ctx, input.column, 'date', input.type).id;
        out.offsetDays = input.offsetDays;
        if (input.at !== undefined) out.at = input.at;
        break;
      case 'recurring':
        out.every = input.every;
        if (input.weekday !== undefined) out.weekday = weekdayOf(input.weekday);
        if (input.dayOfMonth !== undefined) out.dayOfMonth = input.dayOfMonth;
        out.at = input.at;
        break;
      default:
        throw new McpUserError(`Unknown trigger type "${input.type}".`);
    }
    return parseWith(automationTriggerSchema, 'Trigger', out);
  }

  /** One cell value, readable -> stored, through the same converter as item writes. */
  async function cellValue(ctx, column, input) {
    const converted = await convertValues(ctx.loaded, { [column.id]: input }, ctx.board.columns);
    return converted[column.id];
  }

  async function buildConditions(ctx, input) {
    const out = [];
    for (const [i, entry] of input.entries()) {
      const column = findColumn(ctx.board, entry.column);
      if (!CONDITION_COLUMN_TYPES.includes(column.type)) {
        throw new McpUserError(
          `Condition ${i + 1}: a ${column.type} column cannot be checked. Conditions work on ${CONDITION_COLUMN_TYPES.join(', ')} columns.`,
        );
      }
      const condition = { columnId: column.id, op: entry.op };
      if (entry.op === 'is' || entry.op === 'is_not') {
        if (entry.value === undefined || entry.value === null) {
          throw new McpUserError(
            `Condition ${i + 1}: "${entry.op}" needs a value (use is_empty or is_not_empty to check for nothing).`,
          );
        }
        condition.value = await cellValue(ctx, column, entry.value);
      }
      out.push(parseWith(automationConditionSchema, `Condition ${i + 1}`, condition));
    }
    return out;
  }

  async function buildActions(ctx, input) {
    const out = [];
    for (const [i, entry] of input.entries()) {
      const label = `Action ${i + 1}`;
      const action = { type: entry.type };
      switch (entry.type) {
        case 'set_value': {
          const column = findColumn(ctx.board, entry.column);
          action.columnId = column.id;
          if (column.type === 'button' || columnRegistry.has(column.type) === false) {
            throw new McpUserError(`${label}: column "${column.title}" cannot be set.`);
          }
          action.value = await cellValue(ctx, column, entry.value ?? null);
          break;
        }
        case 'rename_item':
          action.template = entry.template;
          break;
        case 'move_to_group':
          action.groupId = findGroup(ctx.board, entry.group).id;
          break;
        case 'archive_item':
          break;
        case 'notify':
          action.uids = entry.people.map((person) => resolveMember(ctx, person));
          if (entry.message !== undefined) action.message = entry.message;
          break;
        case 'create_item': {
          action.name = entry.name;
          if (entry.group !== undefined) action.groupId = findGroup(ctx.board, entry.group).id;
          const given = Object.entries(entry.values ?? {});
          if (given.length > BUTTON_LIMITS.maxCreateValues) {
            throw new McpUserError(`${label}: at most ${BUTTON_LIMITS.maxCreateValues} values.`);
          }
          if (given.length > 0) {
            action.values = {};
            for (const [ref, value] of given) {
              const column = findColumn(ctx.board, ref);
              action.values[column.id] = await cellValue(ctx, column, value);
            }
          }
          break;
        }
        case 'post_update':
          action.text = entry.text;
          break;
        default:
          throw new McpUserError(`${label}: unknown action type "${entry.type}".`);
      }
      out.push(parseWith(buttonActionSchema, label, action));
    }
    return out;
  }

  /** The shared validator, against the board as the runner sees it (members included). */
  function assertValid(ctx, recipe) {
    const { board } = ctx;
    const checked = validateAutomation(
      recipe,
      {
        columns: board.columns,
        groups: board.groups,
        columnLocks: board.columnLocks ?? [],
        memberUids: ctx.memberUids,
      },
      ctx.loaded.role,
    );
    if (!checked.ok) throw new McpUserError(checked.message);
  }

  function assertScheduledRoom(recipe, others) {
    const limit = validateScheduledLimit(recipe, others);
    if (!limit.ok) throw new McpUserError(limit.message);
  }

  /**
   * The zone of a scheduled recipe: the one given, else the one it has, else the creator's profile
   * zone when Atrium's fixed zone list knows it (as the web does; the web falls back to UTC, which
   * would silently shift a "9:00" recipe, so this asks instead).
   */
  function zoneFor(ctx, given, fallback) {
    const profileZone = sharedProfile(ctx.profiles.get(uid)).timeZone;
    const zone = given ?? fallback ?? profileZone;
    const known = (z) => automationTimezoneSchema.safeParse(z).success;
    if (zone && known(zone)) return zone;
    const why = zone
      ? `"${zone}" is not in Atrium's time zone list (it holds one name per region, for example Europe/Brussels for the Netherlands).`
      : 'A scheduled automation needs a time zone.';
    throw new McpUserError(
      `${why} Give timezone as an IANA name such as "Europe/Brussels" or "UTC".`,
    );
  }

  const checkName = (name) => {
    if (String(name).length > AUTOMATION_LIMITS.name) {
      throw new McpUserError(`The name can have at most ${AUTOMATION_LIMITS.name} characters.`);
    }
    return String(name);
  };

  // ---- stored -> readable ---------------------------------------------------------------------

  const columnRef = (board, columnId) => {
    const column = board.columns.find((c) => c.id === columnId);
    if (!column) return columnId;
    const same = board.columns.filter((c) => norm(c.title) === norm(column.title)).length;
    return same > 1 ? column.id : column.title;
  };
  const groupRef = (board, groupId) => board.groups.find((g) => g.id === groupId)?.title ?? groupId;

  /** A stored cell value as the input form that writes it back (labels as text, people as uids). */
  function readableInput(column, stored) {
    if (stored === null || stored === undefined) return null;
    try {
      switch (column.type) {
        case 'status': {
          const labels = column.settings?.labels ?? [];
          const found = labels.find((l) => l.index === stored.index) ?? null;
          return found?.label ?? stored.label ?? stored;
        }
        case 'dropdown': {
          const labels = column.settings?.labels ?? [];
          const texts = (stored.ids ?? []).map((id) => labels.find((l) => l.id === id)?.label);
          return texts.every((t) => typeof t === 'string') ? texts : stored;
        }
        case 'tags': {
          const tags = column.settings?.tags ?? [];
          const texts = (stored.tag_ids ?? []).map((id) => tags.find((t) => t.id === id)?.name);
          return texts.every((t) => typeof t === 'string') ? texts : stored;
        }
        case 'date':
          return typeof stored.date === 'string' && Object.keys(stored).length === 1
            ? stored.date
            : stored;
        case 'checkbox':
          return stored.checked === true || stored.checked === 'true';
        case 'long_text':
          return stored.text ?? stored;
        case 'link':
          return typeof stored.url === 'string' && Object.keys(stored).length === 1
            ? stored.url
            : stored;
        case 'rating':
          return stored.rating ?? stored;
        case 'people':
          return (stored.personsAndTeams ?? []).map((p) =>
            p.kind === 'team' ? `team:${p.id}` : p.id,
          );
        default:
          return stored;
      }
    } catch {
      return stored;
    }
  }

  function readableTrigger(board, trigger) {
    const out = { type: trigger.type };
    if (trigger.groupId !== undefined) out.group = groupRef(board, trigger.groupId);
    if (trigger.columnId !== undefined) out.column = columnRef(board, trigger.columnId);
    if (trigger.toLabelId !== undefined) {
      const column = board.columns.find((c) => c.id === trigger.columnId);
      const label = (column?.settings?.labels ?? []).find((l) => l.index === trigger.toLabelId);
      out.to = label?.label ?? String(trigger.toLabelId);
    }
    if (trigger.uid !== undefined) out.person = trigger.uid;
    for (const key of ['offsetDays', 'every', 'weekday', 'dayOfMonth', 'at']) {
      if (trigger[key] !== undefined) out[key] = trigger[key];
    }
    return out;
  }

  function readableConditions(board, conditions) {
    return conditions.map((c) => {
      const column = board.columns.find((col) => col.id === c.columnId);
      return {
        column: columnRef(board, c.columnId),
        op: c.op,
        ...(c.value !== undefined && column ? { value: readableInput(column, c.value) } : {}),
      };
    });
  }

  function readableActions(board, actions) {
    return actions.map((a) => {
      switch (a.type) {
        case 'set_value': {
          const column = board.columns.find((c) => c.id === a.columnId);
          return {
            type: a.type,
            column: columnRef(board, a.columnId),
            value: column ? readableInput(column, a.value) : (a.value ?? null),
          };
        }
        case 'rename_item':
          return { type: a.type, template: a.template };
        case 'move_to_group':
          return { type: a.type, group: groupRef(board, a.groupId) };
        case 'archive_item':
          return { type: a.type };
        case 'notify':
          return {
            type: a.type,
            people: a.uids,
            ...(a.message !== undefined ? { message: a.message } : {}),
          };
        case 'create_item': {
          const values = {};
          for (const [columnId, value] of Object.entries(a.values ?? {})) {
            const column = board.columns.find((c) => c.id === columnId);
            values[columnRef(board, columnId)] = column ? readableInput(column, value) : value;
          }
          return {
            type: a.type,
            name: a.name,
            ...(a.groupId !== undefined ? { group: groupRef(board, a.groupId) } : {}),
            ...(Object.keys(values).length > 0 ? { values } : {}),
          };
        }
        case 'post_update':
          return { type: a.type, text: a.text };
        default:
          return { ...a };
      }
    });
  }

  // ---- the sentence ---------------------------------------------------------------------------

  const columnTitle = (board, columnId) =>
    board.columns.find((c) => c.id === columnId)?.title ?? 'a deleted column';
  const groupTitle = (board, groupId) =>
    board.groups.find((g) => g.id === groupId)?.title ?? 'a deleted group';

  function valueText(ctx, columnId, value) {
    const column = ctx.board.columns.find((c) => c.id === columnId);
    if (value === null || value === undefined) return 'empty';
    if (!column) return 'a value';
    if (column.type === 'checkbox') return value.checked === true ? 'checked' : 'unchecked';
    if (column.type === 'people') {
      const names = (value.personsAndTeams ?? []).map((p) =>
        p.kind === 'team' ? 'a team' : personName(ctx, p.id),
      );
      return names.join(', ') || 'nobody';
    }
    try {
      const text = columnRegistry.has(column.type)
        ? columnRegistry.toText(column.type, value, column.settings)
        : '';
      if (text !== '') return text;
    } catch {
      // fall through
    }
    return typeof value === 'string' || typeof value === 'number' ? String(value) : 'a value';
  }

  function triggerText(ctx, trigger, timezone) {
    const { board } = ctx;
    const at = (time) => (timezone ? `${time} (${timezone})` : time);
    switch (trigger.type) {
      case 'item_created':
        return trigger.groupId === undefined
          ? 'an item is created'
          : `an item is created in ${groupTitle(board, trigger.groupId)}`;
      case 'status_changed': {
        const title = columnTitle(board, trigger.columnId);
        if (trigger.toLabelId === undefined) return `${title} changes`;
        return `${title} changes to ${valueText(ctx, trigger.columnId, { index: trigger.toLabelId })}`;
      }
      case 'button_clicked':
        return `${columnTitle(board, trigger.columnId)} is clicked`;
      case 'item_moved':
        return trigger.groupId === undefined
          ? 'an item is moved'
          : `an item is moved to ${groupTitle(board, trigger.groupId)}`;
      case 'person_assigned': {
        const who = trigger.uid === undefined ? 'someone' : personName(ctx, trigger.uid);
        return `${who} is assigned to ${columnTitle(board, trigger.columnId)}`;
      }
      case 'date_arrives': {
        const title = columnTitle(board, trigger.columnId);
        const time = trigger.at ? `at ${at(trigger.at)}` : `at its own time or ${at('09:00')}`;
        const days = Math.abs(trigger.offsetDays);
        if (trigger.offsetDays === 0) return `On the day ${title} arrives ${time}`;
        return `${days} ${days === 1 ? 'day' : 'days'} ${trigger.offsetDays < 0 ? 'before' : 'after'} ${title} ${time}`;
      }
      case 'recurring': {
        const time = `at ${at(trigger.at)}`;
        if (trigger.every === 'week') return `Every ${WEEKDAYS[trigger.weekday ?? 1]} ${time}`;
        if (trigger.every === 'month')
          return `Every month on day ${trigger.dayOfMonth ?? 1} ${time}`;
        return `Every day ${time}`;
      }
      default:
        return trigger.type;
    }
  }

  function conditionText(ctx, c) {
    const subject = columnTitle(ctx.board, c.columnId);
    switch (c.op) {
      case 'is':
        return `${subject} is ${valueText(ctx, c.columnId, c.value)}`;
      case 'is_not':
        return `${subject} is not ${valueText(ctx, c.columnId, c.value)}`;
      case 'is_empty':
        return `${subject} is empty`;
      default:
        return `${subject} is not empty`;
    }
  }

  function actionText(ctx, a) {
    switch (a.type) {
      case 'set_value':
        return `set ${columnTitle(ctx.board, a.columnId)} to ${valueText(ctx, a.columnId, a.value)}`;
      case 'rename_item':
        return `rename the item to "${a.template}"`;
      case 'move_to_group':
        return `move the item to ${groupTitle(ctx.board, a.groupId)}`;
      case 'archive_item':
        return 'archive the item';
      case 'notify':
        return `notify ${a.uids.map((u) => personName(ctx, u)).join(', ')}`;
      case 'create_item':
        return `create an item "${a.name}"${a.groupId ? ` in ${groupTitle(ctx.board, a.groupId)}` : ''}`;
      case 'post_update':
        return 'post an update';
      default:
        return a.type;
    }
  }

  /** "When Status changes to Done, notify Avery" */
  function sentenceOf(ctx, recipe) {
    const lead = isScheduledTrigger(recipe.trigger)
      ? triggerText(ctx, recipe.trigger, recipe.timezone)
      : `When ${triggerText(ctx, recipe.trigger)}`;
    const only =
      recipe.conditions.length > 0
        ? `, and only if ${recipe.conditions.map((c) => conditionText(ctx, c)).join(' and ')}`
        : '';
    return `${lead}${only}, ${recipe.actions.map((a) => actionText(ctx, a)).join(' and ')}.`;
  }

  /** The readable description of a stored automation doc. */
  function describeAutomation(ctx, row) {
    const data = row.data;
    const recipe = {
      trigger: data.trigger,
      conditions: data.conditions ?? [],
      actions: data.actions ?? [],
      timezone: data.timezone,
    };
    const { board } = ctx;
    return {
      id: row.id,
      name: data.name,
      enabled: data.enabled === true,
      sentence: sentenceOf(ctx, recipe),
      trigger: readableTrigger(board, recipe.trigger),
      conditions: readableConditions(board, recipe.conditions),
      actions: readableActions(board, recipe.actions),
      ...(data.timezone ? { timezone: data.timezone } : {}),
      runsAs: { uid: data.runAs, name: personName(ctx, data.runAs), isYou: data.runAs === uid },
      disabledReason: data.disabledReason ?? null,
      consecutiveFailures: data.consecutiveFailures ?? 0,
      nextRunAt: iso(data.nextRunAt),
      createdAt: iso(data.createdAt),
      updatedAt: iso(data.updatedAt),
    };
  }

  const stripDoc = (readable) => {
    const { id: _id, ...rest } = readable;
    return rest;
  };

  return {
    async listAutomations({ boardId }) {
      const loaded = await loadBoard(boardId, 'read');
      const ctx = await recipeContext(loaded);
      const rows = await automationDocs(boardId);
      return {
        boardId,
        boardName: loaded.board.name,
        canManage: loaded.role === 'owner',
        limits: {
          perBoard: AUTOMATION_LIMITS.maxPerBoard,
          scheduledPerBoard: AUTOMATION_LIMITS.maxScheduledPerBoard,
          conditions: AUTOMATION_LIMITS.maxConditions,
          actions: AUTOMATION_LIMITS.maxActions,
        },
        automations: rows.map((row) => describeAutomation(ctx, row)),
      };
    },

    async listAutomationRuns({ boardId, automation, limit = 20 }) {
      const loaded = await loadBoard(boardId, 'owner', { ownerMessage: OWNER_MESSAGE });
      const rows = await automationDocs(boardId);
      let wanted = null;
      if (automation !== undefined) wanted = pickAutomation(rows, automation);
      const names = new Map(rows.map((row) => [row.id, row.data.name || row.id]));
      // One query, newest first (no composite index); the recipe filter works on these rows, as in the web.
      const runs = await client.runQuery(
        `boards/${boardId}/automationRuns`,
        {},
        { orderBy: { field: 'startedAt', direction: 'desc' }, limit: RUNS_WINDOW },
      );
      const shown = runs
        .filter((run) => wanted === null || run.data.automationId === wanted.id)
        .slice(0, Math.min(Math.max(1, limit), RUNS_WINDOW))
        .map((run) => ({
          id: run.id,
          automationId: run.data.automationId,
          automation: names.get(run.data.automationId) ?? null,
          itemId: run.data.itemId ?? null,
          status: run.data.status,
          ...(run.data.reason ? { reason: run.data.reason } : {}),
          ...(run.data.error ? { error: run.data.error } : {}),
          actions: run.data.actions ?? [],
          startedAt: iso(run.data.startedAt),
          durationMs: run.data.durationMs ?? 0,
          depth: run.data.depth ?? 0,
        }));
      return {
        boardId,
        boardName: loaded.board.name,
        note: `The newest ${RUNS_WINDOW} runs are searched; runs are kept for ${AUTOMATION_LIMITS.runTtlDays} days.`,
        runs: shown,
      };
    },

    async createAutomation({
      boardId,
      name,
      trigger,
      conditions = [],
      actions,
      enabled = false,
      timezone,
    }) {
      const loaded = await loadBoard(boardId, 'owner', { ownerMessage: OWNER_MESSAGE });
      const ctx = await recipeContext(loaded);
      const existing = await automationDocs(boardId);
      if (existing.length >= AUTOMATION_LIMITS.maxPerBoard) {
        throw new McpUserError(
          `A board can have at most ${AUTOMATION_LIMITS.maxPerBoard} automations.`,
        );
      }
      const stored = {
        trigger: buildTrigger(ctx, trigger),
        conditions: await buildConditions(ctx, conditions),
        actions: await buildActions(ctx, actions),
      };
      if (isScheduledTrigger(stored.trigger)) stored.timezone = zoneFor(ctx, timezone);
      else if (timezone !== undefined) {
        throw new McpUserError('timezone only applies to date_arrives and recurring triggers.');
      }
      assertValid(ctx, stored);
      assertScheduledRoom(
        stored,
        existing.map((row) => row.data),
      );
      const at = now();
      const id = newDocId();
      const doc = {
        name: checkName(name),
        enabled: enabled === true,
        trigger: stored.trigger,
        conditions: stored.conditions,
        actions: stored.actions,
        ...(stored.timezone ? { timezone: stored.timezone } : {}),
        runAs: uid,
        disabledReason: null,
        createdBy: uid,
        createdAt: at,
        updatedBy: uid,
        updatedAt: at,
      };
      await client.commit([
        {
          op: 'set',
          path: `${automationsPath(boardId)}/${id}`,
          data: doc,
          precondition: { exists: false },
        },
      ]);
      return {
        created: describeAutomation(ctx, { id, data: doc }),
        note: doc.enabled
          ? 'It is switched on and will run as you.'
          : 'It is switched off. Confirm with the person, then switch it on with atrium_set_automation_enabled.',
      };
    },

    async updateAutomation({
      boardId,
      automation,
      name,
      trigger,
      conditions,
      actions,
      timezone,
      takeOver,
    }) {
      if (
        name === undefined &&
        trigger === undefined &&
        conditions === undefined &&
        actions === undefined &&
        timezone === undefined &&
        takeOver !== true
      ) {
        throw new McpUserError(
          'Nothing to change: give name, trigger, conditions, actions, timezone or takeOver.',
        );
      }
      const loaded = await loadBoard(boardId, 'owner', { ownerMessage: OWNER_MESSAGE });
      const ctx = await recipeContext(loaded);
      const rows = await automationDocs(boardId);
      const row = pickAutomation(rows, automation);
      const current = row.data;
      const stored = {
        trigger: trigger === undefined ? clone(current.trigger) : buildTrigger(ctx, trigger),
        conditions:
          conditions === undefined
            ? clone(current.conditions ?? [])
            : await buildConditions(ctx, conditions),
        actions: actions === undefined ? clone(current.actions) : await buildActions(ctx, actions),
      };
      if (isScheduledTrigger(stored.trigger)) {
        stored.timezone = zoneFor(ctx, timezone, current.timezone);
      } else if (timezone !== undefined) {
        throw new McpUserError('timezone only applies to date_arrives and recurring triggers.');
      }
      assertValid(ctx, stored);
      assertScheduledRoom(
        stored,
        rows.filter((r) => r.id !== row.id).map((r) => r.data),
      );
      const set = {
        trigger: stored.trigger,
        conditions: stored.conditions,
        actions: stored.actions,
        updatedBy: uid,
        updatedAt: now(),
      };
      if (name !== undefined) set.name = checkName(name);
      if (stored.timezone) set.timezone = stored.timezone;
      const remove = !stored.timezone && current.timezone !== undefined ? ['timezone'] : [];
      // Rules: the editor keeps `runAs`, or takes the recipe over (`runAs == uid`), never a third person.
      const tookOver = takeOver === true && current.runAs !== uid;
      if (tookOver) set.runAs = uid;
      try {
        await client.commit([
          {
            op: 'update',
            path: `${automationsPath(boardId)}/${row.id}`,
            set,
            remove,
            precondition: { updateTime: row.updateTime },
          },
        ]);
      } catch (error) {
        if (error?.status === 409 || error?.status === 400) {
          throw new McpUserError('The automation changed meanwhile. Read it again and retry.');
        }
        throw error;
      }
      const after = { ...current, ...set };
      if (remove.length > 0) delete after.timezone;
      const readable = describeAutomation(ctx, { id: row.id, data: after });
      const notes = [];
      if (current.enabled === true) {
        notes.push(
          'This automation is switched on, so the change is live now. Tell the person what changed.',
        );
      }
      if (current.runAs !== uid && !tookOver) {
        notes.push(
          'It still runs as its creator; pass takeOver: true to run it as you (that uses your permissions).',
        );
      }
      return { updated: readable, ...(notes.length > 0 ? { note: notes.join(' ') } : {}) };
    },

    async setAutomationEnabled({ boardId, automation, enabled }) {
      const loaded = await loadBoard(boardId, 'owner', { ownerMessage: OWNER_MESSAGE });
      const ctx = await recipeContext(loaded);
      const rows = await automationDocs(boardId);
      const row = pickAutomation(rows, automation);
      const current = row.data;
      if ((current.enabled === true) === enabled) {
        return {
          unchanged: true,
          automation: describeAutomation(ctx, row),
          note: `It was already switched ${enabled ? 'on' : 'off'}.`,
        };
      }
      if (enabled) {
        // Like the web: a recipe whose column was deleted does not come back on only to fail.
        assertValid(ctx, {
          trigger: current.trigger,
          conditions: current.conditions ?? [],
          actions: current.actions,
          timezone: current.timezone,
        });
      }
      const set = {
        enabled,
        ...(enabled ? { disabledReason: null } : {}),
        updatedBy: uid,
        updatedAt: now(),
      };
      try {
        await client.commit([
          {
            op: 'update',
            path: `${automationsPath(boardId)}/${row.id}`,
            set,
            precondition: { updateTime: row.updateTime },
          },
        ]);
      } catch (error) {
        if (error?.status === 409 || error?.status === 400) {
          throw new McpUserError('The automation changed meanwhile. Read it again and retry.');
        }
        throw error;
      }
      return {
        automation: describeAutomation(ctx, { id: row.id, data: { ...current, ...set } }),
        note: enabled
          ? `It is switched on and runs as ${personName(ctx, current.runAs)}.`
          : 'It is switched off.',
      };
    },

    async deleteAutomation({ boardId, automation }) {
      const loaded = await loadBoard(boardId, 'owner', { ownerMessage: OWNER_MESSAGE });
      const ctx = await recipeContext(loaded);
      const rows = await automationDocs(boardId);
      const row = pickAutomation(rows, automation);
      const definition = stripDoc(describeAutomation(ctx, row));
      await client.commit([
        {
          op: 'delete',
          path: `${automationsPath(boardId)}/${row.id}`,
          precondition: { updateTime: row.updateTime },
        },
      ]);
      return {
        deleted: { id: row.id, ...definition },
        note: 'The automation is gone for good (its run history ages out). To bring it back, call atrium_create_automation with the same name, trigger, conditions, actions and timezone; it comes back switched off.',
      };
    },
  };
}
