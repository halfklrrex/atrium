import {
  automationConditionSchema,
  automationTriggerSchema,
  buttonActionSchema,
  type WorkspaceRole,
} from '@atrium/shared';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminColumnActionsTx } from './admin';
import type { MatchColumn } from './automations/match';
import type { AutomationDoc, AutomationRunTx, AutomationStore, RunRecord } from './automations/run';

const boardRef = (firestore: Firestore, boardId: string) =>
  firestore.collection('boards').doc(boardId);
const automationRef = (firestore: Firestore, boardId: string, id: string) =>
  boardRef(firestore, boardId).collection('automations').doc(id);
const runRef = (firestore: Firestore, boardId: string, runId: string) =>
  boardRef(firestore, boardId).collection('automationRuns').doc(runId);
const counterRef = (firestore: Firestore, boardId: string) =>
  boardRef(firestore, boardId).collection('counters').doc('automations');

/** Reads a recipe document; a stored shape that no longer parses comes back with `invalid` set. */
export function toAutomationDoc(id: string, data: FirebaseFirestore.DocumentData): AutomationDoc {
  const trigger = automationTriggerSchema.safeParse(data.trigger);
  const conditions = z.array(automationConditionSchema).safeParse(data.conditions ?? []);
  const actions = z.array(buttonActionSchema).safeParse(data.actions ?? []);
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

/** Adapts an Admin SDK transaction to the run transaction port. */
export function adminAutomationTx(firestore: Firestore, tx: Transaction): AutomationRunTx {
  const base = adminColumnActionsTx(firestore, tx);
  return {
    ...base,
    async getBoard(boardId) {
      const board = await base.getBoard(boardId);
      if (!board) return null;
      // Workspace members: the people a `notify` action may name.
      const ws = await tx.get(firestore.collection('workspaces').doc(board.workspaceId));
      const roles = (ws.get('roles') as Record<string, WorkspaceRole> | undefined) ?? {};
      return { ...board, memberUids: Object.keys(roles) };
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
        .limit(limit)
        .get();
      return snap.docs
        .map((d) => toAutomationDoc(d.id, d.data()))
        .filter((a) => a.invalid === undefined);
    },
    async getColumns(boardId) {
      const snap = await boardRef(firestore, boardId).get();
      const columns: unknown = snap.get('columns');
      return Array.isArray(columns) ? (columns as MatchColumn[]) : [];
    },
    async noteRun(boardId, runId, note) {
      await runRef(firestore, boardId, runId).update({ note });
    },
  };
}
