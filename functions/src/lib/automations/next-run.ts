import { automationTriggerSchema, computeNextRunAt } from '@atrium/shared';

/**
 * Keeps `boards/{boardId}/automations/{id}.nextRunAt` right (P5d). It is server-maintained: Firestore
 * rules refuse client writes, so this is, with the scheduler's claim transaction, its only writer.
 *
 * - An enabled `recurring` recipe has the next occurrence of its schedule.
 * - Every other recipe (disabled, other trigger) has `null`.
 *
 * The rule needs no "before" snapshot: a stored value is right when it is an occurrence of the
 * current schedule (`computeNextRunAt(schedule, stored - 1) === stored`). A due value in the past is
 * still right (the scheduler runs it), so the scheduler's own advance and this trigger never fight.
 * An edit of `every`, `weekday`, `dayOfMonth`, `at` or `timezone`, or turning the recipe on, makes
 * the stored value stop being an occurrence, so it is recomputed. After a write the retrigger finds
 * the value right and stops.
 */

const msOf = (value: unknown): number | null =>
  value !== null &&
  typeof value === 'object' &&
  typeof (value as { toMillis?: unknown }).toMillis === 'function'
    ? (value as { toMillis(): number }).toMillis()
    : null;

/**
 * The `nextRunAt` (epoch ms, or `null`) the recipe should hold, or `undefined` when what it holds is
 * already right. `data` is the stored recipe document.
 */
export function nextRunAtFix(
  data: Record<string, unknown> | undefined,
  nowMs: number,
): number | null | undefined {
  if (!data) return undefined;
  const stored = msOf(data.nextRunAt);
  const trigger = automationTriggerSchema.safeParse(data.trigger);
  const timezone = typeof data.timezone === 'string' ? data.timezone : '';
  if (data.enabled !== true || !trigger.success || trigger.data.type !== 'recurring' || !timezone) {
    // `undefined` and `null` both mean "nothing scheduled": no write.
    return data.nextRunAt === undefined || data.nextRunAt === null ? undefined : null;
  }
  try {
    if (stored !== null && computeNextRunAt(trigger.data, timezone, stored - 1) === stored) {
      return undefined;
    }
    return computeNextRunAt(trigger.data, timezone, nowMs);
  } catch {
    // An unknown time zone or an incomplete schedule: nothing to schedule.
    return stored === null ? undefined : null;
  }
}

export interface NextRunStore {
  /**
   * Runs `decide` on the recipe's current stored data (not the possibly older event snapshot), in a
   * transaction, and writes only `nextRunAt` when it returns a value other than `undefined`.
   * Resolves to what was written (`undefined`: nothing).
   */
  update(
    boardId: string,
    automationId: string,
    decide: (data: Record<string, unknown>) => number | null | undefined,
  ): Promise<number | null | undefined>;
}

/** Trigger body. `after` is the event's data (`undefined` when the recipe was deleted). */
export async function syncNextRunAt(
  store: NextRunStore,
  boardId: string,
  automationId: string,
  after: Record<string, unknown> | undefined,
  nowMs: number,
): Promise<number | null | undefined> {
  if (nextRunAtFix(after, nowMs) === undefined) return undefined;
  return await store.update(boardId, automationId, (data) => nextRunAtFix(data, nowMs));
}
