import {
  canEditBoard,
  resolveBoardRole,
  type AutomationCondition,
  type AutomationTrigger,
  type AutomationRunDelivery,
  type ButtonAction,
} from '@atrium/shared';
import { actorOf, activityDoc } from '../activity';
import { runActionsInTransaction, type ColumnActionsTx } from '../column-actions';
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
import {
  TRIGGER_KINDS,
  conditionsHold,
  matchAutomation,
  type MatchColumn,
  type MatchEntry,
} from './match';

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
 * - Failures: a run that throws a deterministic error (validation, an invalid recipe) rolls back, then
 *   a second transaction records it `failed` and counts it on the automation (`consecutiveFailures`).
 *   Transient errors (contention, timeouts, unavailable) are rethrown so the event retry runs it again. At `CIRCUIT_BREAKER_FAILURES` the recipe is
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
  /** Notifications still to send after the commit; written with `delivered: false`. */
  delivery?: AutomationRunDelivery;
  delivered?: boolean;
}

/** A committed run whose notifications have not gone out yet (found again when its event retries). */
export interface PendingDelivery {
  runId: string;
  itemId: string | null;
  delivery: AutomationRunDelivery;
  /** The run's error text; the circuit-breaker notice is built from it. */
  error?: string;
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
  /** Up to `limit` valid enabled recipes of the board, plus every invalid one (so it can fail visibly). */
  listEnabledAutomations(boardId: string, limit: number): Promise<AutomationDoc[]>;
  /** The board's columns (status labels live in their settings); `[]` when the board is gone. */
  getColumns(boardId: string): Promise<MatchColumn[]>;
  /** Runs of this event that committed but still owe their notifications (`delivered === false`). */
  listPendingDeliveries(boardId: string, eventId: string): Promise<PendingDelivery[]>;
  /** Marks a run's notifications as sent. */
  markDelivered(boardId: string, runId: string): Promise<void>;
}

export interface RunRequest {
  boardId: string;
  automationId: string;
  /** The activity entry id that started the run. */
  eventId: string;
  itemId: string;
  /** Depth of the chain that caused the run; a user action is 0. */
  depth: number;
  /** The item's name on the activity entry (for the circuit-breaker notice). */
  itemName?: string;
}

export type RunOutcome =
  /** Nothing to record: disabled, a retry, conditions not met, or the board is gone. */
  | { status: 'none'; reason: string }
  | {
      status: 'ok';
      automation: AutomationDoc;
      runId: string;
      delivery?: AutomationRunDelivery;
    }
  | { status: 'skipped'; automation: AutomationDoc; runId: string; reason: string }
  | {
      status: 'failed';
      automation: AutomationDoc;
      runId: string;
      error: string;
      /** True when this failure was the one that switched the recipe off. */
      disabled: boolean;
      delivery?: AutomationRunDelivery;
    };

const clip = (value: string, max = 200): string =>
  value.length > max ? value.slice(0, max) : value;

const ACCESS_LOST_REASON = 'The person who runs this automation can no longer edit this board';

/** A recipe whose stored shape no longer parses: the same input fails the same way every time. */
export class InvalidAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAutomationError';
  }
}

const isHttpsError = (error: unknown): boolean =>
  error instanceof Error && 'httpErrorCode' in error;

/**
 * True when running the same recipe on the same event would fail the same way: validation
 * (`HttpsError`, zod) and an `invalid` recipe. Anything else (Firestore ABORTED, DEADLINE_EXCEEDED,
 * UNAVAILABLE, a bug) may be transient, so it is rethrown for the platform's event retry instead of
 * being recorded as a permanent failed run.
 */
function isDeterministicFailure(error: unknown): boolean {
  return (
    error instanceof InvalidAutomationError ||
    isHttpsError(error) ||
    (error instanceof Error && error.name === 'ZodError')
  );
}

function errorText(error: unknown): string {
  // HttpsError and invalid-recipe messages are written for people; anything else may hold internals.
  if (error instanceof InvalidAutomationError || isHttpsError(error)) {
    return clip((error as Error).message);
  }
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
  if (automation.invalid) throw new InvalidAutomationError(automation.invalid);
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
  if (!conditionsHold(automation.conditions, item, board.columns)) {
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
      automation: true,
      automationActorId: automationActorId(automationId),
      notifyColumnId: 'columnId' in automation.trigger ? automation.trigger.columnId : '',
      notifyLabel: automation.name,
    },
    serverTimestamp,
  );
  if ('skipped' in result) return skip(result.skipped);

  // A good run ends a streak of failures ("consecutive").
  if (automation.consecutiveFailures > 0) autoUpdate.consecutiveFailures = 0;
  tx.setCounter(boardId, { hourBucket: counter.hourBucket, runs: counter.runs + 1 });
  const delivery: AutomationRunDelivery | undefined = result.notify
    ? {
        kind: 'notify',
        creatorUid: automation.runAs,
        recipeName: recipeNameOf(automation),
        itemName: clip(result.notify.itemName, ITEM_NAME_MAX),
        targets: result.notify.targets.map(({ uid, message }) => ({ uid, message })),
      }
    : undefined;
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
    ...(delivery ? { delivery, delivered: false } : {}),
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
    ...(delivery ? { delivery } : {}),
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
  const delivery: AutomationRunDelivery | undefined = disabled
    ? {
        kind: 'disabled',
        creatorUid: automation.runAs,
        recipeName: recipeNameOf(automation),
        itemName: clip(req.itemName ?? '', ITEM_NAME_MAX),
      }
    : undefined;
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
    ...(delivery ? { delivery, delivered: false } : {}),
  });
  tx.updateAutomation(req.boardId, req.automationId, fields);
  return {
    status: 'failed',
    automation,
    runId,
    error: text,
    disabled,
    ...(delivery ? { delivery } : {}),
  };
}

const ITEM_NAME_MAX = 500;
const recipeNameOf = (automation: AutomationDoc): string => automation.name.trim() || 'Automation';

const disabledReasonOf = (lastError: string): string =>
  `Turned off after ${CIRCUIT_BREAKER_FAILURES} failed runs in a row. Last error: ${lastError}`;

/**
 * Runs one recipe for one event. A deterministic failure is recorded (and counted by the circuit
 * breaker), not thrown. A transient or unknown error is rethrown, so the event retry runs again.
 */
export async function runAutomation(
  store: AutomationStore,
  req: RunRequest,
  serverTimestamp: unknown,
): Promise<RunOutcome> {
  try {
    return await store.transact((tx) => executeInTransaction(tx, req, serverTimestamp));
  } catch (error) {
    if (!isDeterministicFailure(error)) throw error;
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
 * outcomes (for tests and logging). Notifications go out after each commit and are marked delivered;
 * a delivery error is thrown so the event retries and sends them again.
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

  // A retried event first sends what an earlier attempt committed but did not deliver (this covers a
  // recipe that attempt switched off, which the enabled list below no longer returns).
  for (const pending of await deps.store.listPendingDeliveries(event.boardId, event.eventId)) {
    await deliver(deps, event.boardId, pending);
  }
  const automations = await deps.store.listEnabledAutomations(
    event.boardId,
    MAX_AUTOMATIONS_CONSIDERED,
  );
  const outcomes: RunOutcome[] = [];
  // Status labels are read from the column settings; load them only when a recipe needs a label.
  let columns: MatchColumn[] | undefined;
  for (const automation of automations) {
    // A recipe never reacts to its own writes.
    if (activity.actorId === automationActorId(automation.id)) continue;
    if (
      columns === undefined &&
      automation.trigger.type === 'status_changed' &&
      automation.trigger.toLabelId !== undefined
    ) {
      columns = await deps.store.getColumns(event.boardId);
    }
    // A recipe that no longer parses has no usable trigger: it fails (and is counted) on every
    // trigger-kind event until the circuit breaker switches it off with a reason.
    if (!automation.invalid && !matchAutomation(automation, activity, null, columns)) continue;

    const outcome = await runAutomation(
      deps.store,
      {
        boardId: event.boardId,
        automationId: automation.id,
        eventId: event.eventId,
        itemId,
        depth,
        itemName: activity.itemName ?? '',
      },
      deps.serverTimestamp,
    );
    outcomes.push(outcome);
    if ((outcome.status === 'ok' || outcome.status === 'failed') && outcome.delivery) {
      await deliver(deps, event.boardId, {
        runId: outcome.runId,
        itemId,
        delivery: outcome.delivery,
        ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
      });
    }
  }
  return outcomes;
}

/**
 * Sends a committed run's notifications, then marks the run delivered. Errors are thrown so the
 * platform retries the event: the retry finds the run still undelivered and sends again, which is
 * safe because notification ids are deterministic (`kind-runId-uid`).
 */
async function deliver(
  deps: HandleEventDeps,
  boardId: string,
  pending: PendingDelivery,
): Promise<void> {
  const { delivery, runId } = pending;
  const base = {
    eventId: runId,
    boardId,
    itemId: pending.itemId ?? '',
    creatorUid: delivery.creatorUid,
    recipeName: delivery.recipeName,
    itemName: delivery.itemName,
  };
  try {
    if (delivery.kind === 'notify') {
      await deliverAutomationNotifications(deps.notifications, {
        ...base,
        targets: delivery.targets ?? [],
      });
    } else {
      await deliverAutomationDisabled(deps.notifications, {
        ...base,
        reason: disabledReasonOf(pending.error ?? ''),
      });
    }
    await deps.store.markDelivered(boardId, runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.('Automation notification failed', { boardId, runId, error: message });
    throw error;
  }
}
