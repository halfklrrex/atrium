import { z } from 'zod';
import { BUTTON_LIMITS, buttonActionSchema } from '../columns/button';
import { validateButtonActions, type ButtonActionsBoard } from '../columns/column-validation';
import { columnRegistry } from '../columns/index';
import type { BoardRole } from '../roles';
import { slugIdSchema } from './board';
import { idSchema, timestampSchema, uidSchema, type WriteDoc } from './common';

/** Limits shared by the schemas, the Functions and the web (P5 automations). */
export const AUTOMATION_LIMITS = {
  /** Enforced by `validateAutomation` in the UI and the runner; rules cannot count documents. */
  maxPerBoard: 20,
  maxConditions: 3,
  maxActions: BUTTON_LIMITS.maxActions,
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
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger['type'], string> = {
  item_created: 'Item created',
  status_changed: 'Status changes',
  button_clicked: 'Button clicked',
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
/** Client writes never carry the server-written counter. */
export type AutomationWrite = Omit<WriteDoc<Automation>, 'consecutiveFailures'>;

export const AUTOMATION_RUN_STATUSES = ['ok', 'skipped', 'failed'] as const;
export const automationRunStatusSchema = z.enum(AUTOMATION_RUN_STATUSES);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

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
 * `status_changed`, a button for `button_clicked`, never a button or calculated column in a
 * condition), `is` / `is_not` carry a value, the trigger group exists, and the actions pass
 * `validateButtonActions` (which also takes the role's column locks and `board.memberUids`).
 * Returns the first failure; an action failure carries its 0-based `index`.
 */
export function validateAutomation(
  automation: Pick<Automation, 'trigger' | 'conditions' | 'actions'>,
  board: ButtonActionsBoard,
  role?: BoardRole | null,
): AutomationValidationResult {
  const fail = (message: string): AutomationValidationResult => ({ ok: false, message });
  const { trigger } = automation;

  if (trigger.type === 'item_created') {
    if (trigger.groupId !== undefined && !board.groups.some((g) => g.id === trigger.groupId)) {
      return fail('Trigger: the group no longer exists');
    }
  } else {
    const wanted = trigger.type === 'status_changed' ? 'status' : 'button';
    const col = board.columns.find((c) => c.id === trigger.columnId);
    if (!col) return fail('Trigger: the column no longer exists');
    if (col.type !== wanted) {
      return fail(`Trigger: ${AUTOMATION_TRIGGER_LABELS[trigger.type]} needs a ${wanted} column`);
    }
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
  const actions = validateButtonActions(automation.actions, board, role);
  return actions.ok ? { ok: true } : { ok: false, message: actions.message, index: actions.index };
}
