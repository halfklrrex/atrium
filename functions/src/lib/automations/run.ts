import {
  canEditBoard,
  resolveBoardRole,
  type AutomationCondition,
  type AutomationTrigger,
  type ButtonAction,
} from '@atrium/shared';
import { actorOf, activityDoc } from '../activity';
import {
  runActionsInTransaction,
  type ButtonNotifyPlan,
  type ColumnActionsTx,
} from '../column-actions';
import {
  deliverAutomationDisabled,
  deliverAutomationNotifications,
  type NotificationStore,
} from '../notifications';
import {
  CIRCUIT_BREAKER_FAILURES,
  MAX_AUTOMATIONS_CONSIDERED,
  MAX_DEPTH,
  automationActorId,
  counterForNow,
  rateLimited,
  runExpiresAtMs,
  runIdOf,
  type RunCounter,
} from './limits';
import { TRIGGER_KINDS, conditionsHold, matchAutomation, type MatchEntry } from './match';

/**
 * The automation runner (P5a, spec docs/specs/P5a-automations-backend.md, section A3).
 * `onActivityCreated` hands every new activity entry to `handleActivityEvent`, which finds the
 * board's matching recipes and runs each in one transaction (`runAutomation`). Everything here is
 * pure logic over the ports below; `admin-automations.ts` adapts the Admin SDK to them.
 *
 * - Idempotency: the run document id is `${automationId}-${eventId}`; a retried event finds it and
 *   stops. The same id is the item's `automationRunId`, the marker the activity trigger uses to
 *   credit the write to the automation.
 * - Loops: an automation write carries `automationDepth = depth + 1`; entries it causes carry that
 *   depth. A recipe never reacts to its own writes, and from `MAX_DEPTH` on nothing runs: matching
 *   recipes only record a `skipped` "loop limit" run.
 * - Failures: a run that throws rolls back, then a second transaction records it `failed` and counts
 *   it on the automation (`consecutiveFailures`). At `CIRCUIT_BREAKER_FAILURES` the recipe is
 *   switched off with one notice to its creator.
 */

/** A recipe as the runner reads it. `invalid` is set when its stored shape no longer parses. */
export interface AutomationDoc {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: ButtonAction[];
  runAs: string;
  disabledReason: string | null;
  consecutiveFailures: number;
  invalid?: string;
}

export interface RunRecord {
  automationId: string;
  eventId: string;
  itemId: string | null;
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  error?: string;
  actions: string[];
  depth: number;
  startedAtMs: number;
  durationMs: number;
  expiresAtMs: number;
}

/** What a run transaction reads and writes; the item and board access comes from `ColumnActionsTx`. */
export interface AutomationRunTx extends ColumnActionsTx {
  getAutomation(boardId: string, automationId: string): Promise<AutomationDoc | null>;
  runExists(boardId: string, runId: string): Promise<boolean>;
  getCounter(boardId: string): Promise<RunCounter | null>;
  setCounter(boardId: string, counter: RunCounter): void;
  /** Creates the run document; the id is `runIdOf(automationId, eventId)`. */
  createRun(boardId: string, runId: string, run: RunRecord): void;
  /** Server-side fields only: `enabled`, `disabledReason`, `consecutiveFailures`. */
  updateAutomation(boardId: string, automationId: string, fields: Record<string, unknown>): void;
}

export interface AutomationStore {
  transact<T>(fn: (tx: AutomationRunTx) => Promise<T>): Promise<T>;
  /** Up to `limit` enabled recipes of the board that still parse. */
  listEnabledAutomations(boardId: string, limit: number): Promise<AutomationDoc[]>;
  /** Best effort note on a finished run (a notification that could not be delivered). */
  noteRun(boardId: string, runId: string, note: string): Promise<void>;
}

export interface RunRequest {
  boardId: string;
  automationId: string;
  /** The activity entry id that started the run. */
  eventId: string;
  itemId: string;
  /** Depth of the chain that caused the run; a user action is 0. */
  depth: number;
}

export type RunOutcome =
  /** Nothing to record: disabled, a retry, conditions not met, or the board is gone. */
  | { status: 'none'; reason: string }
  | {
      status: 'ok';
      automation: AutomationDoc;
      runId: string;
      itemName: string;
      notify?: ButtonNotifyPlan;
    }
  | { status: 'skipped'; automation: AutomationDoc; runId: string; reason: string }
  | {
      status: 'failed';
      automation: AutomationDoc;
      runId: string;
      error: string;
      /** True when this failure was the one that switched the recipe off. */
      disabled: boolean;
    };

const clip = (value: string, max = 200): string =>
  value.length > max ? value.slice(0, max) : value;

const ACCESS_LOST_REASON = 'The person who runs this automation can no longer edit this board';

function errorText(error: unknown): string {
  // HttpsError messages are written for people; anything else may hold internals.
  if (error instanceof Error && 'httpErrorCode' in error) return clip(error.message);
  return 'Unexpected error while running the automation';
}

function skippedRecord(
  req: RunRequest,
  startedMs: number,
  nowMs: number,
  reason: string,
): RunRecord {
  return {
    automationId: req.automationId,
    eventId: req.eventId,
    itemId: req.itemId,
    status: 'skipped',
    reason,
    actions: [],
    depth: req.depth,
    startedAtMs: startedMs,
    durationMs: Math.max(0, nowMs - startedMs),
    expiresAtMs: runExpiresAtMs(startedMs),
  };
}

async function executeInTransaction(
  tx: AutomationRunTx,
  req: RunRequest,
  serverTimestamp: unknown,
): Promise<RunOutcome> {
  const { boardId, automationId, itemId, depth } = req;
  const startedMs = tx.nowMs();
  const runId = runIdOf(automationId, req.eventId);

  // All reads first: Firestore transactions refuse a read after the first write.
  const automation = await tx.getAutomation(boardId, automationId);
  if (!automation || !automation.enabled) return { status: 'none', reason: 'disabled' };
  if (await tx.runExists(boardId, runId)) return { status: 'none', reason: 'already ran' };
  if (automation.invalid) throw new Error(automation.invalid);
  const board = await tx.getBoard(boardId);
  if (!board) return { status: 'none', reason: 'board gone' };
  const item = await tx.getItem(boardId, itemId);
  const wsRole = await tx.getWorkspaceMemberRole(board.workspaceId, automation.runAs);
  const role = resolveBoardRole(board, automation.runAs, wsRole);
  const counter = counterForNow(await tx.getCounter(boardId), startedMs);

  // The owner switched a tripped recipe back on: start counting failures again.
  const autoUpdate: Record<string, unknown> = {};
  if (automation.consecutiveFailures >= CIRCUIT_BREAKER_FAILURES) {
    autoUpdate.consecutiveFailures = 0;
    autoUpdate.disabledReason = null;
    automation.consecutiveFailures = 0;
  }
  const flush = () => {
    if (Object.keys(autoUpdate).length > 0) {
      tx.updateAutomation(boardId, automationId, autoUpdate);
    }
  };
  const skip = (reason: string): RunOutcome => {
    tx.createRun(boardId, runId, skippedRecord(req, startedMs, tx.nowMs(), reason));
    flush();
    return { status: 'skipped', automation, runId, reason };
  };

  if (depth >= MAX_DEPTH) return skip('loop limit');
  if (!canEditBoard(role)) {
    autoUpdate.enabled = false;
    autoUpdate.disabledReason = ACCESS_LOST_REASON;
    return skip('creator lost access');
  }
  if (!item) return skip('item not found');
  if (item.state !== 'active') return skip('item not active');
  if (!conditionsHold(automation.conditions, item)) {
    flush();
    return { status: 'none', reason: 'conditions not met' };
  }
  if (rateLimited(counter)) return skip('rate limit');

  const result = await runActionsInTransaction(
    tx,
    {
      boardId,
      item,
      actions: automation.actions,
      board,
      role,
      actorUid: automation.runAs,
      nowMs: startedMs,
      extraItemFields: {
        updatedVia: automationActorId(automationId),
        automationDepth: depth + 1,
        automationRunId: runId,
      },
      notifyColumnId: 'columnId' in automation.trigger ? automation.trigger.columnId : '',
      notifyLabel: automation.name,
    },
    serverTimestamp,
  );
  if ('skipped' in result) return skip(result.skipped);

  // A good run ends a streak of failures ("consecutive").
  if (automation.consecutiveFailures > 0) autoUpdate.consecutiveFailures = 0;
  tx.setCounter(boardId, { hourBucket: counter.hourBucket, runs: counter.runs + 1 });
  tx.createRun(boardId, runId, {
    automationId,
    eventId: req.eventId,
    itemId,
    status: 'ok',
    actions: result.applied,
    depth,
    startedAtMs: startedMs,
    durationMs: Math.max(0, tx.nowMs() - startedMs),
    expiresAtMs: runExpiresAtMs(startedMs),
  });
  await tx.appendActivity(
    boardId,
    activityDoc(
      { ...actorOf(automationActorId(automationId)), name: automation.name.trim() || 'Automation' },
      'automation_ran',
      {
        itemId,
        itemName: item.name,
        data: { automationId, depth: depth + 1, actions: result.applied },
      },
    ),
  );
  flush();
  return {
    status: 'ok',
    automation,
    runId,
    itemName: result.notify?.itemName ?? item.name,
    ...(result.notify ? { notify: result.notify } : {}),
  };
}

/** Second transaction after a throw: records the failed run and trips the circuit breaker. */
async function recordFailureInTransaction(
  tx: AutomationRunTx,
  req: RunRequest,
  error: unknown,
): Promise<RunOutcome> {
  const startedMs = tx.nowMs();
  const runId = runIdOf(req.automationId, req.eventId);
  const automation = await tx.getAutomation(req.boardId, req.automationId);
  if (!automation) return { status: 'none', reason: 'automation gone' };
  if (await tx.runExists(req.boardId, runId)) return { status: 'none', reason: 'already ran' };

  const text = errorText(error);
  // A tripped recipe that the owner switched back on starts again from zero.
  const before =
    automation.consecutiveFailures >= CIRCUIT_BREAKER_FAILURES ? 0 : automation.consecutiveFailures;
  const failures = before + 1;
  const fields: Record<string, unknown> = { consecutiveFailures: failures };
  const disabled = automation.enabled && failures >= CIRCUIT_BREAKER_FAILURES;
  if (disabled) {
    fields.enabled = false;
    fields.disabledReason = clip(disabledReasonOf(text));
  }
  tx.createRun(req.boardId, runId, {
    automationId: req.automationId,
    eventId: req.eventId,
    itemId: req.itemId,
    status: 'failed',
    error: text,
    actions: [],
    depth: req.depth,
    startedAtMs: startedMs,
    durationMs: 0,
    expiresAtMs: runExpiresAtMs(startedMs),
  });
  tx.updateAutomation(req.boardId, req.automationId, fields);
  return { status: 'failed', automation, runId, error: text, disabled };
}

const disabledReasonOf = (lastError: string): string =>
  `Turned off after ${CIRCUIT_BREAKER_FAILURES} failed runs in a row. Last error: ${lastError}`;

/** Runs one recipe for one event. A failed run is recorded, not thrown. */
export async function runAutomation(
  store: AutomationStore,
  req: RunRequest,
  serverTimestamp: unknown,
): Promise<RunOutcome> {
  try {
    return await store.transact((tx) => executeInTransaction(tx, req, serverTimestamp));
  } catch (error) {
    return await store.transact((tx) => recordFailureInTransaction(tx, req, error));
  }
}

// -- The event ----------------------------------------------------------------------------------

/** The slice of an activity entry the runner reads. */
export interface ActivityEntryInput extends MatchEntry {
  actorId: string;
  itemName?: string | null;
}

export interface HandleEventDeps {
  store: AutomationStore;
  notifications: NotificationStore;
  serverTimestamp: unknown;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * `onActivityCreated`: runs every enabled recipe of the board that the entry starts. Returns the
 * outcomes (for tests and logging). Notifications go out after each commit, best effort.
 */
export async function handleActivityEvent(
  deps: HandleEventDeps,
  event: { eventId: string; boardId: string; activity: ActivityEntryInput },
): Promise<RunOutcome[]> {
  const { activity } = event;
  const itemId = activity.itemId;
  if (!itemId || activity.parentItemId) return [];
  if (!(TRIGGER_KINDS as readonly string[]).includes(activity.kind)) return [];
  const depth = Math.min(activity.data?.depth ?? 0, MAX_DEPTH);

  const automations = await deps.store.listEnabledAutomations(
    event.boardId,
    MAX_AUTOMATIONS_CONSIDERED,
  );
  const outcomes: RunOutcome[] = [];
  for (const automation of automations.slice(0, MAX_AUTOMATIONS_CONSIDERED)) {
    // A recipe never reacts to its own writes.
    if (activity.actorId === automationActorId(automation.id)) continue;
    if (!matchAutomation(automation, activity)) continue;

    const outcome = await runAutomation(
      deps.store,
      {
        boardId: event.boardId,
        automationId: automation.id,
        eventId: event.eventId,
        itemId,
        depth,
      },
      deps.serverTimestamp,
    );
    outcomes.push(outcome);
    await deliverAfterCommit(deps, event, outcome, activity.itemName ?? '', itemId);
  }
  return outcomes;
}

async function deliverAfterCommit(
  deps: HandleEventDeps,
  event: { eventId: string; boardId: string },
  outcome: RunOutcome,
  itemName: string,
  itemId: string,
): Promise<void> {
  try {
    if (outcome.status === 'ok' && outcome.notify) {
      await deliverAutomationNotifications(deps.notifications, {
        eventId: outcome.runId,
        boardId: event.boardId,
        itemId,
        creatorUid: outcome.automation.runAs,
        recipeName: outcome.automation.name.trim() || 'Automation',
        itemName: outcome.itemName,
        targets: outcome.notify.targets,
      });
    } else if (outcome.status === 'failed' && outcome.disabled) {
      await deliverAutomationDisabled(deps.notifications, {
        eventId: outcome.runId,
        boardId: event.boardId,
        itemId,
        creatorUid: outcome.automation.runAs,
        recipeName: outcome.automation.name.trim() || 'Automation',
        itemName,
        reason: disabledReasonOf(outcome.error),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.('Automation notification failed', { boardId: event.boardId, error: message });
    if ('runId' in outcome) {
      await deps.store
        .noteRun(event.boardId, outcome.runId, clip(`Notification not delivered: ${message}`))
        .catch(() => undefined);
    }
  }
}
