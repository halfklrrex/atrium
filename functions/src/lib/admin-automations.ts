import {
  automationRunSchema,
  automationSchema,
  automationTriggerSchema,
  type WorkspaceRole,
} from '@atrium/shared';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { adminColumnActionsTx } from './admin';
import type { MatchColumn } from './automations/match';
import type {
  AutomationDoc,
  AutomationRunTx,
  AutomationStore,
  PendingDelivery,
  RunRecord,
} from './automations/run';

const boardRef = (firestore: Firestore, boardId: string) =>
  firestore.collection('boards').doc(boardId);
const automationRef = (firestore: Firestore, boardId: string, id: string) =>
  boardRef(firestore, boardId).collection('automations').doc(id);
const runRef = (firestore: Firestore, boardId: string, runId: string) =>
  boardRef(firestore, boardId).collection('automationRuns').doc(runId);
const counterRef = (firestore: Firestore, boardId: string) =>
  boardRef(firestore, boardId).collection('counters').doc('automations');

/**
 * Reads a recipe document; a stored shape that no longer parses comes back with `invalid` set. The
 * action and condition lists are parsed with the shared caps (1 to 5 actions, at most 3 conditions):
 * a recipe the builder would refuse must not run, as its activity and run documents would not
 * satisfy their schemas either.
 */
export function toAutomationDoc(id: string, data: FirebaseFirestore.DocumentData): AutomationDoc {
  const trigger = automationTriggerSchema.safeParse(data.trigger);
  const conditions = automationSchema.shape.conditions.safeParse(data.conditions ?? []);
  const actions = automationSchema.shape.actions.safeParse(data.actions ?? []);
  const base = {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    enabled: data.enabled === true,
    runAs: typeof data.runAs === 'string' ? data.runAs : '',
    disabledReason: typeof data.disabledReason === 'string' ? data.disabledReason : null,
    consecutiveFailures:
      typeof data.consecutiveFailures === 'number' ? data.consecutiveFailures : 0,
  };
  if (!trigger.success || !conditions.success || !actions.success || !base.runAs) {
    return {
      ...base,
      trigger: { type: 'item_created' },
      conditions: [],
      actions: [],
      invalid: 'The automation is not valid any more: open it and save it again.',
    };
  }
  return {
    ...base,
    trigger: trigger.data,
    conditions: conditions.data,
    actions: actions.data,
  };
}

/** How many enabled recipe documents one event reads at most (a board should hold 20). */
const SCAN_LIMIT = 100;

/**
 * Up to `limit` valid recipes plus every invalid one: an invalid recipe must still reach the runner
 * so its failure is recorded (and the circuit breaker switches it off with a reason), and it must
 * not use up one of the `limit` slots.
 */
export function pickAutomations(docs: readonly AutomationDoc[], limit: number): AutomationDoc[] {
  let valid = 0;
  return docs.filter((a) => a.invalid !== undefined || ++valid <= limit);
}

/** Adapts an Admin SDK transaction to the run transaction port. */
export function adminAutomationTx(firestore: Firestore, tx: Transaction): AutomationRunTx {
  const base = adminColumnActionsTx(firestore, tx);
  // `getBoard` reads the workspace document for the member list; the role lookup reuses that read.
  const rolesByWorkspace = new Map<string, Record<string, WorkspaceRole>>();
  return {
    ...base,
    async getBoard(boardId) {
      const board = await base.getBoard(boardId);
      if (!board) return null;
      // Workspace members: the people a `notify` action may name.
      const ws = await tx.get(firestore.collection('workspaces').doc(board.workspaceId));
      const roles = (ws.get('roles') as Record<string, WorkspaceRole> | undefined) ?? {};
      rolesByWorkspace.set(board.workspaceId, roles);
      return { ...board, memberUids: Object.keys(roles) };
    },
    async getWorkspaceMemberRole(workspaceId, uid) {
      const cached = rolesByWorkspace.get(workspaceId);
      return cached ? (cached[uid] ?? null) : base.getWorkspaceMemberRole(workspaceId, uid);
    },
    async getAutomation(boardId, automationId) {
      const snap = await tx.get(automationRef(firestore, boardId, automationId));
      return snap.exists ? toAutomationDoc(snap.id, snap.data() ?? {}) : null;
    },
    async runExists(boardId, runId) {
      return (await tx.get(runRef(firestore, boardId, runId))).exists;
    },
    async getCounter(boardId) {
      const snap = await tx.get(counterRef(firestore, boardId));
      if (!snap.exists) return null;
      const hourBucket: unknown = snap.get('hourBucket');
      const runs: unknown = snap.get('runs');
      return typeof hourBucket === 'string' && typeof runs === 'number'
        ? { hourBucket, runs }
        : null;
    },
    setCounter(boardId, counter) {
      tx.set(counterRef(firestore, boardId), counter);
    },
    createRun(boardId, runId, run: RunRecord) {
      const { startedAtMs, expiresAtMs, ...rest } = run;
      tx.create(runRef(firestore, boardId, runId), {
        ...rest,
        startedAt: Timestamp.fromMillis(startedAtMs),
        expiresAt: Timestamp.fromMillis(expiresAtMs),
      });
    },
    updateAutomation(boardId, automationId, fields) {
      tx.update(automationRef(firestore, boardId, automationId), fields);
    },
  };
}

/** Adapts the Admin SDK to the runner's store. */
export function adminAutomationStore(firestore: Firestore): AutomationStore {
  return {
    transact: (fn) => firestore.runTransaction((tx) => fn(adminAutomationTx(firestore, tx))),
    async listEnabledAutomations(boardId, limit) {
      const snap = await boardRef(firestore, boardId)
        .collection('automations')
        .where('enabled', '==', true)
        .limit(Math.max(limit, SCAN_LIMIT))
        .get();
      return pickAutomations(
        snap.docs.map((d) => toAutomationDoc(d.id, d.data())),
        limit,
      );
    },
    async getColumns(boardId) {
      const snap = await boardRef(firestore, boardId).get();
      const columns: unknown = snap.get('columns');
      return Array.isArray(columns) ? (columns as MatchColumn[]) : [];
    },
    async listPendingDeliveries(boardId, eventId) {
      const snap = await boardRef(firestore, boardId)
        .collection('automationRuns')
        .where('eventId', '==', eventId)
        .where('delivered', '==', false)
        .get();
      const pending: PendingDelivery[] = [];
      for (const d of snap.docs) {
        const delivery = automationRunSchema.shape.delivery.safeParse(d.get('delivery'));
        if (!delivery.success || !delivery.data) continue;
        const error: unknown = d.get('error');
        pending.push({
          runId: d.id,
          itemId: typeof d.get('itemId') === 'string' ? (d.get('itemId') as string) : null,
          delivery: delivery.data,
          ...(typeof error === 'string' ? { error } : {}),
        });
      }
      return pending;
    },
    async markDelivered(boardId, runId) {
      await runRef(firestore, boardId, runId).update({ delivered: true });
    },
  };
}
