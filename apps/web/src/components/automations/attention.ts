import type { AutomationDoc, AutomationRunDoc } from '../../data/automations';

/** Why an automation needs the owner's attention, or `null` when it doesn't. */
export type AttentionReason = 'circuit-breaker' | 'failing';

/**
 * Derived on the client. `circuit-breaker`: switched off with a reason (the runner's breaker
 * tripped). `failing`: still on, but its newest run failed. `lastRun` is `undefined` when the
 * automation never ran or the viewer can't read the history.
 */
export function attentionReason(
  automation: Pick<AutomationDoc, 'enabled' | 'disabledReason'>,
  lastRun: Pick<AutomationRunDoc, 'status'> | undefined,
): AttentionReason | null {
  if (!automation.enabled) return automation.disabledReason ? 'circuit-breaker' : null;
  return lastRun?.status === 'failed' ? 'failing' : null;
}

/** The automations that need attention, in their given order. */
export function filterNeedsAttention<
  T extends Pick<AutomationDoc, 'id' | 'enabled' | 'disabledReason'>,
>(
  automations: readonly T[],
  lastRuns: ReadonlyMap<string, Pick<AutomationRunDoc, 'status'>> | null,
): T[] {
  return automations.filter((a) => attentionReason(a, lastRuns?.get(a.id)) !== null);
}
