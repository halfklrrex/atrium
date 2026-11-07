import {
  columnRegistry,
  isScheduledTrigger,
  type Automation,
  type AutomationCondition,
  type AutomationTrigger,
  type ButtonAction,
  type ColumnDef,
  type GroupDef,
} from '@atrium/shared';
import { cellDisplayText } from '../../lib/cell-display-text';

/** What a sentence needs from the board: its columns and groups, and optionally who people are. */
export interface DescribeBoard {
  columns: readonly Pick<ColumnDef, 'id' | 'type' | 'title' | 'settings'>[];
  groups: readonly Pick<GroupDef, 'id' | 'title'>[];
}

export interface DescribeOptions {
  /**
   * Resolves a person's name (a "notify" action, a people value); without it a notify counts
   * people and a people value reads as a generic member.
   */
  personName?: (uid: string) => string | null;
}

const DELETED_COLUMN = 'a deleted column';
const DELETED_GROUP = 'a deleted group';

type Recipe = Pick<Automation, 'trigger' | 'conditions' | 'actions'> & { timezone?: string };

/**
 * One run of words in a described sentence. `strong` marks names (columns, groups, people);
 * `color` marks a status or dropdown label, which the UI draws as a coloured chip. Joining the
 * `text` of every part gives exactly the plain sentence.
 */
export interface DescribePart {
  text: string;
  strong?: boolean;
  /** The label's own colour; the part is then a chip. */
  color?: string;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const columnOf = (board: DescribeBoard, id: string) => board.columns.find((c) => c.id === id);
const columnTitle = (board: DescribeBoard, id: string) =>
  columnOf(board, id)?.title ?? DELETED_COLUMN;
const groupTitle = (board: DescribeBoard, id: string) =>
  board.groups.find((g) => g.id === id)?.title ?? DELETED_GROUP;

const plain = (text: string): DescribePart => ({ text });
const strong = (text: string): DescribePart => ({ text, strong: true });
const toText = (parts: readonly DescribePart[]): string => parts.map((p) => p.text).join('');

interface ColouredLabel {
  index?: number;
  id?: string | number;
  label?: string;
  color?: string;
}

const labelsOf = (column: DescribeBoard['columns'][number]): ColouredLabel[] => {
  const labels = (column.settings as { labels?: ColouredLabel[] } | undefined)?.labels;
  return Array.isArray(labels) ? labels : [];
};

/** A cell value as words ("Done", "High, Low", "checked"), or a neutral fallback. */
function valueText(
  board: DescribeBoard,
  columnId: string,
  value: unknown,
  options: DescribeOptions,
): string {
  const column = columnOf(board, columnId);
  if (value === null || value === undefined) return 'empty';
  if (!column) return 'a value';
  if (column.type === 'checkbox') {
    const checked = (value as { checked?: unknown } | null)?.checked;
    return checked === true || checked === 'true' ? 'checked' : 'unchecked';
  }
  let text: string;
  try {
    text = columnRegistry.has(column.type)
      ? cellDisplayText(column.type, value, column.settings, { personName: options.personName })
      : '';
  } catch {
    text = '';
  }
  if (text === '' && (typeof value === 'string' || typeof value === 'number')) text = String(value);
  return text === '' ? 'a value' : text;
}

/** Like `valueText`, but a status label or dropdown option keeps its colour. */
function valueParts(
  board: DescribeBoard,
  columnId: string,
  value: unknown,
  options: DescribeOptions = {},
): DescribePart[] {
  const column = columnOf(board, columnId);
  const text = valueText(board, columnId, value, options);
  if (!column || value === null || value === undefined) return [plain(text)];
  if (column.type === 'status') {
    const index = (value as { index?: unknown }).index;
    const label = labelsOf(column).find((l) => l.index === index);
    if (label?.color && label.label === text) return [{ text, color: label.color }];
  }
  if (column.type === 'dropdown') {
    const ids = (value as { ids?: unknown }).ids;
    if (Array.isArray(ids) && ids.length === 1) {
      const label = labelsOf(column).find((l) => l.id === ids[0]);
      if (label?.color && label.label === text) return [{ text, color: label.color }];
    }
  }
  return [plain(text)];
}

const withZone = (time: string, timezone: string | undefined): string =>
  timezone ? `${time} (${timezone})` : time;

/** The trigger half of the sentence as parts; see `describeTrigger`. */
export function describeTriggerParts(
  trigger: AutomationTrigger,
  board: DescribeBoard,
  timezone?: string,
): DescribePart[] {
  switch (trigger.type) {
    case 'item_created':
      return trigger.groupId === undefined
        ? [plain('an item is created')]
        : [plain('an item is created in '), strong(groupTitle(board, trigger.groupId))];
    case 'status_changed': {
      const column = columnOf(board, trigger.columnId);
      const title = strong(column?.title ?? DELETED_COLUMN);
      if (trigger.toLabelId === undefined) return [title, plain(' changes')];
      const label = column
        ? valueParts(board, trigger.columnId, { index: trigger.toLabelId })
        : [plain('a label')];
      return [title, plain(' changes to '), ...label];
    }
    case 'button_clicked':
      return [strong(columnTitle(board, trigger.columnId)), plain(' is clicked')];
    case 'item_moved':
      return trigger.groupId === undefined
        ? [plain('an item is moved')]
        : [plain('an item is moved to '), strong(groupTitle(board, trigger.groupId))];
    case 'person_assigned':
      return [plain('someone is assigned to '), strong(columnTitle(board, trigger.columnId))];
    case 'date_arrives': {
      const title = strong(columnTitle(board, trigger.columnId));
      const time = trigger.at
        ? `at ${withZone(trigger.at, timezone)}`
        : `at its own time or ${withZone('09:00', timezone)}`;
      const days = Math.abs(trigger.offsetDays);
      if (trigger.offsetDays === 0) return [plain('On the day '), title, plain(` arrives ${time}`)];
      const unit = days === 1 ? 'day' : 'days';
      return [
        plain(`${days} ${unit} ${trigger.offsetDays < 0 ? 'before' : 'after'} `),
        title,
        plain(` ${time}`),
      ];
    }
    case 'recurring': {
      const time = `at ${withZone(trigger.at, timezone)}`;
      if (trigger.every === 'week') {
        return [plain(`Every ${WEEKDAYS[trigger.weekday ?? 1] ?? 'week'} ${time}`)];
      }
      if (trigger.every === 'month') {
        return [plain(`Every month on day ${trigger.dayOfMonth ?? 1} ${time}`)];
      }
      return [plain(`Every day ${time}`)];
    }
  }
}

/**
 * "item created" etc.: the trigger half of the sentence, without "When". A scheduled trigger reads
 * as its own lead-in instead ("Every Monday at 09:00 (Europe/Madrid)"); `isScheduledTrigger` tells
 * the two apart. `timezone` is the recipe's zone.
 */
export function describeTrigger(
  trigger: AutomationTrigger,
  board: DescribeBoard,
  timezone?: string,
): string {
  return toText(describeTriggerParts(trigger, board, timezone));
}

const CONDITION_OPS: Record<AutomationCondition['op'], string> = {
  is: 'is',
  is_not: 'is not',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

export function describeConditionParts(
  condition: AutomationCondition,
  board: DescribeBoard,
  options: DescribeOptions = {},
): DescribePart[] {
  const subject = [
    strong(columnTitle(board, condition.columnId)),
    plain(` ${CONDITION_OPS[condition.op]}`),
  ];
  return condition.op === 'is' || condition.op === 'is_not'
    ? [...subject, plain(' '), ...valueParts(board, condition.columnId, condition.value, options)]
    : subject;
}

export function describeCondition(
  condition: AutomationCondition,
  board: DescribeBoard,
  options: DescribeOptions = {},
): string {
  return toText(describeConditionParts(condition, board, options));
}

export function describeActionParts(
  action: ButtonAction,
  board: DescribeBoard,
  options: DescribeOptions = {},
): DescribePart[] {
  switch (action.type) {
    case 'set_value':
      return [
        plain('set '),
        strong(columnTitle(board, action.columnId)),
        plain(' to '),
        ...valueParts(board, action.columnId, action.value, options),
      ];
    case 'rename_item':
      return [plain(`rename the item to "${action.template}"`)];
    case 'move_to_group':
      return [plain('move the item to '), strong(groupTitle(board, action.groupId))];
    case 'archive_item':
      return [plain('archive the item')];
    case 'notify': {
      const names = options.personName
        ? action.uids.map((uid) => options.personName?.(uid)).filter((n): n is string => !!n)
        : [];
      const who =
        names.length === action.uids.length && names.length <= 2
          ? names.join(' and ')
          : `${action.uids.length} ${action.uids.length === 1 ? 'person' : 'people'}`;
      return [
        plain('notify '),
        strong(who),
        ...(action.message ? [plain(`: "${action.message}"`)] : []),
      ];
    }
    case 'create_item':
      return action.groupId === undefined
        ? [plain(`create an item "${action.name}"`)]
        : [plain(`create an item "${action.name}" in `), strong(groupTitle(board, action.groupId))];
    case 'post_update':
      return [plain(`post an update "${action.text}"`)];
  }
}

export function describeAction(
  action: ButtonAction,
  board: DescribeBoard,
  options: DescribeOptions = {},
): string {
  return toText(describeActionParts(action, board, options));
}

/** "a", "a and b", "a, b and c" over groups of parts. */
function joinParts(groups: readonly DescribePart[][]): DescribePart[] {
  if (groups.length <= 1) return groups[0] ?? [];
  const head = groups.slice(0, -1).flatMap((g, i) => (i === 0 ? g : [plain(', '), ...g]));
  return [...head, plain(' and '), ...groups[groups.length - 1]!];
}

/**
 * One recipe as parts, for a sentence with bold names and coloured label chips. The parts' text
 * joins to exactly `describeAutomation`.
 */
export function describeAutomationParts(
  automation: Recipe,
  board: DescribeBoard,
  options: DescribeOptions = {},
): DescribePart[] {
  const trigger = describeTriggerParts(automation.trigger, board, automation.timezone);
  const conditions = automation.conditions.map((c) => describeConditionParts(c, board, options));
  const when =
    conditions.length > 0 ? [...trigger, plain(' and '), ...joinParts(conditions)] : trigger;
  const then = automation.actions.map((a) => describeActionParts(a, board, options));
  const lead = isScheduledTrigger(automation.trigger) ? [] : [plain('When ')];
  return [...lead, ...when, plain(', then '), ...joinParts(then)];
}

/**
 * One recipe as a sentence: "When Status changes to Done and Priority is High, then move the item
 * to Done and notify 2 people". A deleted column or group reads as "a deleted column" /
 * "a deleted group" instead of failing.
 */
export function describeAutomation(
  automation: Recipe,
  board: DescribeBoard,
  options: DescribeOptions = {},
): string {
  return toText(describeAutomationParts(automation, board, options));
}
