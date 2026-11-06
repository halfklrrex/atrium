import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { syncNextRunAt, type NextRunStore } from '../lib/automations/next-run';

/** Admin Firestore adapter: one transaction per fix, so a stale event can't overwrite newer data. */
export function adminNextRunStore(): NextRunStore {
  const firestore = db();
  return {
    update: (boardId, automationId, decide) =>
      firestore.runTransaction(async (tx) => {
        const ref = firestore
          .collection('boards')
          .doc(boardId)
          .collection('automations')
          .doc(automationId);
        const snap = await tx.get(ref);
        if (!snap.exists) return undefined;
        const next = decide(snap.data() ?? {});
        if (next === undefined) return undefined;
        tx.update(ref, { nextRunAt: next === null ? null : Timestamp.fromMillis(next) });
        return next;
      }),
  };
}

/**
 * Keeps `nextRunAt` of recurring recipes right (P5d): set when one is created, turned on or edited,
 * `null` otherwise. Writes only when the stored value is wrong, so its own write re-triggers it once
 * and then stops (see `lib/automations/next-run.ts`).
 */
export const onAutomationWritten = onDocumentWritten(
  {
    // `database` is required: a trigger without it listens to the project's default database only.
    document: 'boards/{boardId}/automations/{automationId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
  },
  async (event) => {
    const after = event.data?.after;
    const written = await syncNextRunAt(
      adminNextRunStore(),
      event.params.boardId,
      event.params.automationId,
      after?.exists ? (after.data() ?? {}) : undefined,
      Date.now(),
    );
    if (written !== undefined) {
      logger.info(`Set nextRunAt of automation ${event.params.automationId}`, {
        boardId: event.params.boardId,
        nextRunAt: written === null ? null : new Date(written).toISOString(),
      });
    }
  },
);
