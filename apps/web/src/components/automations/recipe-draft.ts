import {
  AUTOMATION_LIMITS,
  CANONICAL_TIMEZONES,
  columnRegistry,
  isScheduledTrigger,
  validateAutomation,
  validateScheduledLimit,
  type Automation,
  type AutomationCondition,
  type AutomationTrigger,
  type BoardRole,
  type ButtonAction,
  type ColumnDef,
  type GroupDef,
} from '@atrium/shared';
import { getButtonActionErrors } from '../board-table/button-actions';
import { buildColumnViews } from '../board-table/table-model';
import type { AutomationInput } from '../../data/automations';

/** The slice of a board the builder works against. */
export interface BuilderBoard {
  columns: readonly ColumnDef[];
  groups: readonly GroupDef[];
  columnLocks?: readonly string[] | null;
}

export type ConditionOp = AutomationCondition['op'];

/** Column types a condition can check in v1; button and derived columns are never offered. */
export const CONDITION_COLUMN_TYPES = [
  'status',
  'dropdown',
  'text',
  'long_text',
  'numbers',
  'checkbox',
] as const;

export function conditionColumns(board: BuilderBoard): ColumnDef[] {
  return board.columns.filter(
    (c) =>
      (CONDITION_COLUMN_TYPES as readonly string[]).includes(c.type) &&
      columnRegistry.has(c.type) &&
      !columnRegistry.isDerived(c.type) &&
      !c.migrating,
  );
}

export const triggerColumns = (
  board: BuilderBoard,
  type: 'status' | 'button' | 'people' | 'date',
): ColumnDef[] => board.columns.filter((c) => c.type === type);

/** The operators a column type offers, with their label. A checkbox has no value to compare. */
export function conditionOps(columnType: string): { op: ConditionOp; label: string }[] {
  if (columnType === 'checkbox') {
    return [
      { op: 'is_not_empty', label: 'is checked' },
      { op: 'is_empty', label: 'is not checked' },
    ];
  }
  return [
    { op: 'is', label: 'is' },
    { op: 'is_not', label: 'is not' },
    { op: 'is_empty', label: 'is empty' },
    { op: 'is_not_empty', label: 'is not empty' },
  ];
}

export const needsValue = (op: ConditionOp): boolean => op === 'is' || op === 'is_not';

/** A fresh trigger of `type`, pointing at the board's first fitting column. */
export function defaultTrigger(
  type: AutomationTrigger['type'],
  board: BuilderBoard,
): AutomationTrigger {
  if (type === 'item_created' || type === 'item_moved') return { type };
  if (type === 'person_assigned') {
    return { type, columnId: triggerColumns(board, 'people')[0]?.id ?? '' };
  }
  if (type === 'date_arrives') {
    return { type, columnId: triggerColumns(board, 'date')[0]?.id ?? '', offsetDays: 0 };
  }
  if (type === 'recurring') return { type, every: 'day', at: '09:00' };
  const columnId = triggerColumns(board, type === 'status_changed' ? 'status' : 'button')[0]?.id;
  return { type, columnId: columnId ?? '' };
}

/** A fresh condition on `column`, with the operator its type starts with. */
export function newCondition(column: ColumnDef | undefined): AutomationCondition {
  return {
    columnId: column?.id ?? '',
    op: column?.type === 'checkbox' ? 'is_not_empty' : 'is',
  };
}

/** Where in the builder a problem belongs, so the message sits next to the offending part. */
export interface DraftProblems {
  trigger: string | null;
  conditions: (string | null)[];
  /** One message per action row. */
  actions: (string | null)[];
  /** Not tied to a part (for example the per-board cap). */
  general: string | null;
}

const afterPrefix = (message: string, prefix: RegExp) => message.replace(prefix, '');

/**
 * Checks a draft the way saving does and says where the first failure is. Blank pickers get a plain
 * "choose" message; everything else is `validateAutomation`'s verdict. Action rows also carry the
 * per-action messages of the button settings editor (an unset value, a deleted group).
 */
export function checkDraft(
  draft: Pick<AutomationInput, 'trigger' | 'conditions' | 'actions'>,
  board: BuilderBoard,
  role: BoardRole | null,
  existingCount: number | null,
  scheduled: {
    timezone?: string;
    /** The board's other recipes (without the one being edited), for the scheduled cap. */
    others?: ReadonlyArray<Pick<Automation, 'trigger'>>;
  } = {},
): DraftProblems {
  const problems: DraftProblems = {
    trigger: null,
    conditions: draft.conditions.map(() => null),
    actions: getButtonActionErrors(draft.actions, buildColumnViews(board.columns), board.groups, {
      automation: true,
    }),
    general: null,
  };
  if (existingCount !== null && existingCount >= AUTOMATION_LIMITS.maxPerBoard) {
    problems.general = `A board can have at most ${AUTOMATION_LIMITS.maxPerBoard} automations.`;
  }

  const { trigger } = draft;
  if ('columnId' in trigger && trigger.columnId === '') {
    const kind =
      trigger.type === 'status_changed'
        ? 'Status'
        : trigger.type === 'person_assigned'
          ? 'People'
          : trigger.type === 'date_arrives'
            ? 'Date'
            : 'Button';
    problems.trigger = `Choose a ${kind} column`;
  }
  draft.conditions.forEach((condition, i) => {
    if (condition.columnId === '') problems.conditions[i] = 'Choose a column';
  });

  const checked = validateAutomation(
    { ...draft, timezone: scheduled.timezone },
    { ...board, columns: board.columns },
    role,
  );
  if (!checked.ok) {
    const { message } = checked;
    if (checked.index !== undefined) {
      problems.actions[checked.index] ??= afterPrefix(message, /^Action \d+ \([^)]*\): /);
    } else if (message.startsWith('Trigger')) {
      problems.trigger ??= afterPrefix(message, /^Trigger: /);
    } else if (message.startsWith('Condition')) {
      const at = Number(/^Condition (\d+)/.exec(message)?.[1] ?? 0) - 1;
      if (at >= 0 && at < problems.conditions.length) {
        problems.conditions[at] ??= afterPrefix(message, /^Condition \d+: /);
      } else problems.general ??= message;
    } else if (draft.actions.length > 0) {
      problems.general ??= message;
    }
  }
  if (problems.trigger === null && scheduled.others && isScheduledTrigger(trigger)) {
    const limit = validateScheduledLimit(draft, scheduled.others);
    if (!limit.ok) problems.trigger = limit.message;
  }
  return problems;
}

/**
 * The zone a scheduled recipe is saved with: the creator's profile zone, else the browser's, else
 * UTC. Only zones the shared list knows are used (validation refuses others).
 */
export function resolveRecipeTimezone(profileZone: string | null | undefined): string {
  const browser = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return '';
    }
  })();
  for (const zone of [profileZone, browser]) {
    if (zone && CANONICAL_TIMEZONES.has(zone)) return zone;
  }
  return 'UTC';
}

/** True when saving would be accepted. */
export function isDraftOk(problems: DraftProblems, actionCount: number): boolean {
  return (
    actionCount > 0 &&
    problems.trigger === null &&
    problems.general === null &&
    problems.conditions.every((m) => m === null) &&
    problems.actions.every((m) => m === null)
  );
}

/** Triggers the builder offers. */
export const TRIGGER_TYPES: AutomationTrigger['type'][] = [
  'item_created',
  'item_moved',
  'person_assigned',
  'status_changed',
  'button_clicked',
  'date_arrives',
  'recurring',
];

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** The actions a recipe with this trigger may use; a recurring recipe has no item to act on. */
export const RECURRING_ACTION_TYPES = ['create_item', 'notify'] as const;

/**
 * A draft as the sentence builder holds it: a from-scratch recipe starts with a blank trigger and a
 * blank action (`null`), each shown as a blank to fill in. Nothing blank is ever saved.
 */
export interface BlankableDraft {
  trigger: AutomationTrigger | null;
  conditions: readonly AutomationCondition[];
  actions: readonly (ButtonAction | null)[];
}

/** Which parts of a draft are still blanks, and how many in all. */
export interface DraftBlanks {
  trigger: boolean;
  conditions: boolean[];
  actions: boolean[];
  total: number;
}

const actionIsBlank = (action: ButtonAction | null): boolean => {
  if (action === null) return true;
  switch (action.type) {
    case 'set_value':
      return action.columnId === '' || action.value === undefined;
    case 'move_to_group':
      return action.groupId === '';
    case 'notify':
      return action.uids.length === 0;
    case 'rename_item':
      return action.template.trim() === '';
    case 'create_item':
      return (
        action.name.trim() === '' || Object.values(action.values ?? {}).some((v) => v === undefined)
      );
    case 'post_update':
      return action.text.trim() === '';
    case 'archive_item':
      return false;
  }
};

/** Finds the blanks: an unpicked trigger, column, value, group, person or text. */
export function findBlanks(draft: BlankableDraft): DraftBlanks {
  const trigger =
    draft.trigger === null || ('columnId' in draft.trigger && draft.trigger.columnId === '');
  const conditions = draft.conditions.map(
    (c) => c.columnId === '' || (needsValue(c.op) && c.value === undefined),
  );
  const actions = draft.actions.map(actionIsBlank);
  const total = (trigger ? 1 : 0) + [...conditions, ...actions].filter(Boolean).length;
  return { trigger, conditions, actions, total };
}

/**
 * `checkDraft` for a draft that may still have blanks. A blank part gets no message (it is simply
 * unfinished, and the blank counter says so); every other failure sits next to its part as before.
 * Action messages stay aligned with the draft's action rows.
 */
export function checkBlankableDraft(
  draft: BlankableDraft,
  board: BuilderBoard,
  role: BoardRole | null,
  existingCount: number | null,
  scheduled: Parameters<typeof checkDraft>[4] = {},
): { problems: DraftProblems; blanks: DraftBlanks } {
  const blanks = findBlanks(draft);
  const rows: number[] = [];
  const actions: ButtonAction[] = [];
  draft.actions.forEach((action, i) => {
    if (action) {
      rows.push(i);
      actions.push(action);
    }
  });
  const checked = checkDraft(
    {
      trigger: draft.trigger ?? { type: 'item_created' },
      conditions: [...draft.conditions],
      actions,
    },
    board,
    role,
    existingCount,
    scheduled,
  );
  const aligned: (string | null)[] = draft.actions.map(() => null);
  rows.forEach((row, j) => {
    aligned[row] = blanks.actions[row] ? null : (checked.actions[j] ?? null);
  });
  return {
    blanks,
    problems: {
      trigger: blanks.trigger ? null : checked.trigger,
      conditions: checked.conditions.map((m, i) => (blanks.conditions[i] ? null : m)),
      actions: aligned,
      general: checked.general,
    },
  };
}
