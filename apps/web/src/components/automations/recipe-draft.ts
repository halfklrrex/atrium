import {
  AUTOMATION_LIMITS,
  columnRegistry,
  validateAutomation,
  type AutomationCondition,
  type AutomationTrigger,
  type BoardRole,
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
  // Scheduled triggers are not offered by the builder yet (P5d-4); a plain default keeps this total.
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
          : 'Button';
    problems.trigger = `Choose a ${kind} column`;
  }
  draft.conditions.forEach((condition, i) => {
    if (condition.columnId === '') problems.conditions[i] = 'Choose a column';
  });

  const checked = validateAutomation(draft, { ...board, columns: board.columns }, role);
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
  return problems;
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
];
