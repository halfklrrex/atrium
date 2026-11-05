import {
  columnRegistry,
  type Automation,
  type AutomationCondition,
  type AutomationTrigger,
  type ButtonAction,
  type ColumnDef,
  type GroupDef,
} from '@atrium/shared';

/** What a sentence needs from the board: its columns and groups, and optionally who people are. */
export interface DescribeBoard {
  columns: readonly Pick<ColumnDef, 'id' | 'type' | 'title' | 'settings'>[];
  groups: readonly Pick<GroupDef, 'id' | 'title'>[];
}

export interface DescribeOptions {
  /** Resolves a person for a "notify" action; without it the sentence counts people. */
  personName?: (uid: string) => string | null;
}

const DELETED_COLUMN = 'a deleted column';
const DELETED_GROUP = 'a deleted group';

type Recipe = Pick<Automation, 'trigger' | 'conditions' | 'actions'>;

const columnOf = (board: DescribeBoard, id: string) => board.columns.find((c) => c.id === id);
const columnTitle = (board: DescribeBoard, id: string) =>
  columnOf(board, id)?.title ?? DELETED_COLUMN;
const groupTitle = (board: DescribeBoard, id: string) =>
  board.groups.find((g) => g.id === id)?.title ?? DELETED_GROUP;

/** A cell value as words ("Done", "High, Low", "checked"), or a neutral fallback. */
function valueText(board: DescribeBoard, columnId: string, value: unknown): string {
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
      ? columnRegistry.toText(column.type, value, column.settings)
      : '';
  } catch {
    text = '';
  }
  if (text === '' && (typeof value === 'string' || typeof value === 'number')) text = String(value);
  return text === '' ? 'a value' : text;
}

/** "item created" etc.: the trigger half of the sentence, without "When". */
export function describeTrigger(trigger: AutomationTrigger, board: DescribeBoard): string {
  switch (trigger.type) {
    case 'item_created':
      return trigger.groupId === undefined
        ? 'an item is created'
        : `an item is created in ${groupTitle(board, trigger.groupId)}`;
    case 'status_changed': {
      const column = columnOf(board, trigger.columnId);
      const title = column?.title ?? DELETED_COLUMN;
      if (trigger.toLabelId === undefined) return `${title} changes`;
      const label = column
        ? valueText(board, trigger.columnId, { index: trigger.toLabelId })
        : null;
      return `${title} changes to ${label ?? 'a label'}`;
    }
    case 'button_clicked':
      return `${columnTitle(board, trigger.columnId)} is clicked`;
    case 'item_moved':
      return trigger.groupId === undefined
        ? 'an item is moved'
        : `an item is moved to ${groupTitle(board, trigger.groupId)}`;
    case 'person_assigned':
      return `someone is assigned to ${columnTitle(board, trigger.columnId)}`;
  }
}

const CONDITION_OPS: Record<AutomationCondition['op'], string> = {
  is: 'is',
  is_not: 'is not',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

export function describeCondition(condition: AutomationCondition, board: DescribeBoard): string {
  const subject = `${columnTitle(board, condition.columnId)} ${CONDITION_OPS[condition.op]}`;
  return condition.op === 'is' || condition.op === 'is_not'
    ? `${subject} ${valueText(board, condition.columnId, condition.value)}`
    : subject;
}

export function describeAction(
  action: ButtonAction,
  board: DescribeBoard,
  options: DescribeOptions = {},
): string {
  switch (action.type) {
    case 'set_value':
      return `set ${columnTitle(board, action.columnId)} to ${valueText(board, action.columnId, action.value)}`;
    case 'rename_item':
      return `rename the item to "${action.template}"`;
    case 'move_to_group':
      return `move the item to ${groupTitle(board, action.groupId)}`;
    case 'archive_item':
      return 'archive the item';
    case 'notify': {
      const names = options.personName
        ? action.uids.map((uid) => options.personName?.(uid)).filter((n): n is string => !!n)
        : [];
      const who =
        names.length === action.uids.length && names.length <= 2
          ? names.join(' and ')
          : `${action.uids.length} ${action.uids.length === 1 ? 'person' : 'people'}`;
      return action.message ? `notify ${who}: "${action.message}"` : `notify ${who}`;
    }
    case 'create_item':
      return action.groupId === undefined
        ? `create an item "${action.name}"`
        : `create an item "${action.name}" in ${groupTitle(board, action.groupId)}`;
    case 'post_update':
      return `post an update "${action.text}"`;
  }
}

const joinAnd = (parts: readonly string[]): string =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

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
  const trigger = describeTrigger(automation.trigger, board);
  const conditions = automation.conditions.map((c) => describeCondition(c, board));
  const when = conditions.length > 0 ? `${trigger} and ${joinAnd(conditions)}` : trigger;
  const then = automation.actions.map((a) => describeAction(a, board, options));
  return `When ${when}, then ${joinAnd(then)}`;
}
