import { z } from 'zod';
import { BUTTON_LIMITS, buttonActionSchema } from '../columns/button';
import { validateButtonActions, type ButtonActionsBoard } from '../columns/column-validation';
import { CANONICAL_TIMEZONES } from '../columns/canonical-timezones';
import { columnRegistry } from '../columns/index';
import type { BoardRole } from '../roles';
import { slugIdSchema } from './board';
import { idSchema, timestampSchema, uidSchema, type WriteDoc } from './common';

/** Limits shared by the schemas, the Functions and the web (P5 automations). */
export const AUTOMATION_LIMITS = {
  /** Enforced by `validateAutomation` in the UI and the runner; rules cannot count documents. */
  maxPerBoard: 20,
  /** Scheduled recipes (`date_arrives` or `recurring`) per board, inside `maxPerBoard` (P5d). */
  maxScheduledPerBoard: 5,
  maxConditions: 3,
  maxActions: BUTTON_LIMITS.maxActions,
  /** `create_item` actions per recipe, so a recipe cannot fan out (P5c; no board item cap exists). */
  maxCreatedPerRun: 1,
  maxRunsPerHour: 100,
  /** A chain of automation-caused events stops at this depth. */
  maxDepth: 3,
  /** Run documents expire this many days after they started (Firestore TTL on `expiresAt`). */
  runTtlDays: 30,
  name: 80,
  disabledReason: 200,
  /** Characters of a run's `reason` / `error`. */
  runText: 200,
} as const;

/** `HH:MM`, 24 hours. */
export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

/** An IANA zone from `CANONICAL_TIMEZONES` (the same set on web, Functions and rules tests). */
export const automationTimezoneSchema = z
  .string()
  .max(64)
  .refine((tz) => CANONICAL_TIMEZONES.has(tz), 'Unknown time zone');

/** Triggers run by the scheduler instead of by an item event. */
export const SCHEDULED_TRIGGER_TYPES = ['date_arrives', 'recurring'] as const;
export function isScheduledTrigger(trigger: {
  type: string;
}): trigger is Extract<AutomationTrigger, { type: 'date_arrives' | 'recurring' }> {
  return trigger.type === 'date_arrives' || trigger.type === 'recurring';
}

/**
 * What starts a recipe. A discriminated union on `type`, each member strict; P5b/c add more types.
 * `toLabelId` is the status label `index` (status values are `{ index }`); absent means any change.
 */
export const automationTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item_created'), groupId: slugIdSchema.optional() }).strict(),
  z
    .object({
      type: z.literal('status_changed'),
      columnId: idSchema,
      toLabelId: z.number().int().min(0).optional(),
    })
    .strict(),
  z.object({ type: z.literal('button_clicked'), columnId: idSchema }).strict(),
  /** Absent `groupId`: any move. */
  z.object({ type: z.literal('item_moved'), groupId: slugIdSchema.optional() }).strict(),
  /** `columnId` is a people column; absent `uid`: anyone newly added. */
  z
    .object({ type: z.literal('person_assigned'), columnId: idSchema, uid: uidSchema.optional() })
    .strict(),
  /**
   * Scheduler-driven (P5d), never an item event. `offsetDays` is days after the date (negative:
   * before, 0: on the day). `at` (`HH:MM` in the recipe's `timezone`) defaults to the cell's own
   * time, else 09:00.
   */
  z
    .object({
      type: z.literal('date_arrives'),
      columnId: idSchema,
      offsetDays: z.number().int().min(-30).max(30),
      at: hhmmSchema.optional(),
    })
    .strict(),
  /**
   * Scheduler-driven (P5d). `weekday` (0 = Sunday .. 6 = Saturday) is required for `week` and
   * `dayOfMonth` (1..28) for `month`; `validateAutomation` checks that.
   */
  z
    .object({
      type: z.literal('recurring'),
      every: z.enum(['day', 'week', 'month']),
      weekday: z.number().int().min(0).max(6).optional(),
      dayOfMonth: z.number().int().min(1).max(28).optional(),
      at: hhmmSchema,
    })
    .strict(),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger['type'], string> = {
  item_created: 'Item created',
  status_changed: 'Status changes',
  button_clicked: 'Button clicked',
  item_moved: 'Item moved',
  person_assigned: 'Person assigned',
  date_arrives: 'Date arrives',
  recurring: 'Recurring',
};

export const AUTOMATION_CONDITION_OPS = ['is', 'is_not', 'is_empty', 'is_not_empty'] as const;
export const automationConditionOpSchema = z.enum(AUTOMATION_CONDITION_OPS);
export type AutomationConditionOp = z.infer<typeof automationConditionOpSchema>;

/** A filter on the item at run time. `is` and `is_not` need a `value`. */
export const automationConditionSchema = z
  .object({
    columnId: idSchema,
    op: automationConditionOpSchema,
    value: z.unknown().optional(),
  })
  .strict()
  .refine((c) => (c.op !== 'is' && c.op !== 'is_not') || c.value !== undefined, {
    message: 'A value is required for "is" and "is not"',
    path: ['value'],
  });
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

/** `boards/{boardId}/automations/{automationId}`; written by board owners, read by board readers. */
export const automationSchema = z.object({
  /** Short label; empty means the UI shows the recipe as a sentence. */
  name: z.string().max(AUTOMATION_LIMITS.name),
  enabled: z.boolean(),
  trigger: automationTriggerSchema,
  conditions: z.array(automationConditionSchema).max(AUTOMATION_LIMITS.maxConditions),
  /** The button-action schema, reused. */
  actions: z.array(buttonActionSchema).min(1).max(AUTOMATION_LIMITS.maxActions),
  /**
   * IANA zone of a scheduled recipe (the creator's profile zone when it was saved); required by
   * `validateAutomation` for `date_arrives` and `recurring`, absent otherwise.
   */
  timezone: automationTimezoneSchema.optional(),
  /**
   * Recurring only: UTC time of the next run. Server-maintained by Functions (P5d), never
   * client-written; `null` or absent when not scheduled.
   */
  nextRunAt: timestampSchema.nullable().optional(),
  /** The uid whose permissions a run uses: the creator. */
  runAs: uidSchema,
  /** Why the automation is off (circuit breaker, creator lost access); `null` when it is not. */
  disabledReason: z.string().max(AUTOMATION_LIMITS.disabledReason).nullable(),
  /** Server-written by the runner (circuit breaker); clients never write it. */
  consecutiveFailures: z.number().int().min(0).optional(),
  createdBy: uidSchema,
  createdAt: timestampSchema,
  updatedBy: uidSchema,
  updatedAt: timestampSchema,
});
export type Automation = z.infer<typeof automationSchema>;
/** Client writes never carry the server-written counter or `nextRunAt`. */
export type AutomationWrite = Omit<WriteDoc<Automation>, 'consecutiveFailures' | 'nextRunAt'>;

export const AUTOMATION_RUN_STATUSES = ['ok', 'skipped', 'failed'] as const;
export const automationRunStatusSchema = z.enum(AUTOMATION_RUN_STATUSES);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

/**
 * What a run still owes after its transaction committed: the notifications of its `notify` actions
 * (`kind: 'notify'`) or the circuit-breaker notice to the creator (`kind: 'disabled'`; the text is
 * built from the run's `error`). Written with the run; the run's `delivered` flag says whether it
 * went out, so a retried event can deliver again (notification ids are deterministic).
 */
export const automationRunDeliverySchema = z.object({
  kind: z.enum(['notify', 'disabled']),
  creatorUid: uidSchema,
  recipeName: z.string().max(AUTOMATION_LIMITS.name),
  itemName: z.string().max(500),
  targets: z
    .array(z.object({ uid: uidSchema, message: z.string().max(BUTTON_LIMITS.maxNotifyMessage) }))
    .max(BUTTON_LIMITS.maxNotifyUids * BUTTON_LIMITS.maxActions)
    .optional(),
});
export type AutomationRunDelivery = z.infer<typeof automationRunDeliverySchema>;

/**
 * `boards/{boardId}/automationRuns/{automationId}-{eventId}`. Written only by Cloud Functions, read
 * by board owners. The deterministic id makes a retried trigger idempotent.
 */
export const automationRunSchema = z.object({
  automationId: idSchema,
  eventId: idSchema,
  itemId: idSchema.nullable(),
  status: automationRunStatusSchema,
  /** Why a run was skipped ("rate limit", "loop limit", ...). */
  reason: z.string().max(AUTOMATION_LIMITS.runText).optional(),
  /** Short failure text, never a stack trace. */
  error: z.string().max(AUTOMATION_LIMITS.runText).optional(),
  /** Types of the actions that were applied. */
  actions: z.array(z.string().max(40)).max(AUTOMATION_LIMITS.maxActions),
  startedAt: timestampSchema,
  durationMs: z.number().int().min(0),
  /** Notifications the run still owed after it committed; absent when it owed none. */
  delivery: automationRunDeliverySchema.optional(),
  /** Server-written: `false` while `delivery` is undelivered, `true` once it went out. */
  delivered: z.boolean().optional(),
  /** Depth of the chain that caused the run; a user action is 0. */
  depth: z.number().int().min(0).max(AUTOMATION_LIMITS.maxDepth),
  expiresAt: timestampSchema,
});
export type AutomationRun = z.infer<typeof automationRunSchema>;
export type AutomationRunWrite = WriteDoc<AutomationRun>;

/** `boards/{boardId}/counters/automations`: the hourly run counter (Functions-only). */
export const automationCounterSchema = z.object({
  /** ISO hour, e.g. `2026-11-04T09`. */
  hourBucket: z.string().min(1).max(20),
  runs: z.number().int().min(0),
});
export type AutomationCounter = z.infer<typeof automationCounterSchema>;

export type AutomationValidationResult =
  { ok: true } | { ok: false; message: string; index?: number };

/**
 * Checks a recipe against a board: trigger and condition columns exist and fit (a status column for
 * `status_changed`, a button for `button_clicked`, a people column for `person_assigned`, never a button or calculated column in a
 * condition), `is` / `is_not` carry a value, the trigger group exists, and the actions pass
 * `validateButtonActions` (which also takes the role's column locks and `board.memberUids`).
 * Returns the first failure; an action failure carries its 0-based `index`.
 */
export function validateAutomation(
  automation: Pick<Automation, 'trigger' | 'conditions' | 'actions'> & { timezone?: string },
  board: ButtonActionsBoard,
  role?: BoardRole | null,
): AutomationValidationResult {
  const fail = (message: string): AutomationValidationResult => ({ ok: false, message });
  const { trigger } = automation;

  if (trigger.type === 'item_created' || trigger.type === 'item_moved') {
    if (trigger.groupId !== undefined && !board.groups.some((g) => g.id === trigger.groupId)) {
      return fail('Trigger: the group no longer exists');
    }
  } else if (trigger.type === 'recurring') {
    if (trigger.every === 'week' && trigger.weekday === undefined) {
      return fail('Trigger: choose a weekday');
    }
    if (trigger.every !== 'week' && trigger.weekday !== undefined) {
      return fail('Trigger: a weekday only applies to "every week"');
    }
    if (trigger.every === 'month' && trigger.dayOfMonth === undefined) {
      return fail('Trigger: choose a day of the month');
    }
    if (trigger.every !== 'month' && trigger.dayOfMonth !== undefined) {
      return fail('Trigger: a day of the month only applies to "every month"');
    }
    // No item to act on: only actions that need none.
    const bad = automation.actions.findIndex(
      (a) => a.type !== 'create_item' && a.type !== 'notify',
    );
    if (bad >= 0) {
      return {
        ok: false,
        message: 'A recurring recipe can only create an item or notify people',
        index: bad,
      };
    }
  } else {
    const wanted =
      trigger.type === 'status_changed'
        ? 'status'
        : trigger.type === 'person_assigned'
          ? 'people'
          : trigger.type === 'date_arrives'
            ? 'date'
            : 'button';
    const col = board.columns.find((c) => c.id === trigger.columnId);
    if (!col) return fail('Trigger: the column no longer exists');
    if (col.type !== wanted) {
      return fail(`Trigger: ${AUTOMATION_TRIGGER_LABELS[trigger.type]} needs a ${wanted} column`);
    }
    if (
      trigger.type === 'person_assigned' &&
      trigger.uid !== undefined &&
      board.memberUids &&
      !board.memberUids.includes(trigger.uid)
    ) {
      return fail('Trigger: the chosen person is no longer a workspace member');
    }
  }
  if (isScheduledTrigger(trigger) && !CANONICAL_TIMEZONES.has(automation.timezone ?? '')) {
    return fail('Trigger: a valid time zone is required');
  }

  if (automation.conditions.length > AUTOMATION_LIMITS.maxConditions) {
    return fail(`At most ${AUTOMATION_LIMITS.maxConditions} conditions`);
  }
  for (const [i, cond] of automation.conditions.entries()) {
    const col = board.columns.find((c) => c.id === cond.columnId);
    if (!col) return fail(`Condition ${i + 1}: the column no longer exists`);
    if (
      col.type === 'button' ||
      (columnRegistry.has(col.type) && columnRegistry.isDerived(col.type))
    ) {
      return fail(`Condition ${i + 1}: the column has no stored value to check`);
    }
    if ((cond.op === 'is' || cond.op === 'is_not') && cond.value === undefined) {
      return fail(`Condition ${i + 1}: a value is required`);
    }
  }

  if (automation.actions.length < 1 || automation.actions.length > AUTOMATION_LIMITS.maxActions) {
    return fail(`Choose 1 to ${AUTOMATION_LIMITS.maxActions} actions`);
  }
  if (
    automation.actions.filter((a) => a.type === 'create_item').length >
    AUTOMATION_LIMITS.maxCreatedPerRun
  ) {
    return fail(`At most ${AUTOMATION_LIMITS.maxCreatedPerRun} Create item action`);
  }
  const actions = validateButtonActions(automation.actions, board, role, columnRegistry, {
    automation: true,
  });
  return actions.ok ? { ok: true } : { ok: false, message: actions.message, index: actions.index };
}

/**
 * At most `AUTOMATION_LIMITS.maxScheduledPerBoard` scheduled recipes per board. `existing` are the
 * board's other recipes (leave out the one being edited); only the count of scheduled ones matters.
 */
export function validateScheduledLimit(
  automation: Pick<Automation, 'trigger'>,
  existing: ReadonlyArray<Pick<Automation, 'trigger'>>,
): AutomationValidationResult {
  if (!isScheduledTrigger(automation.trigger)) return { ok: true };
  const others = existing.filter((a) => isScheduledTrigger(a.trigger)).length;
  return others >= AUTOMATION_LIMITS.maxScheduledPerBoard
    ? {
        ok: false,
        message: `A board can have at most ${AUTOMATION_LIMITS.maxScheduledPerBoard} scheduled automations`,
      }
    : { ok: true };
}
