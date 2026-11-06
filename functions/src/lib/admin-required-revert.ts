import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { appendActivityTx } from './admin-activity';
import type {
  RequiredRevertBoard,
  RequiredRevertPlan,
  RequiredRevertStore,
} from './required-revert';

/**
 * Adapts the Admin SDK to `RequiredRevertStore`. The revert is one transaction: it re-reads the
 * item, lets `decide` judge the current state, restores the status cells and creates the activity
 * entry. It writes only `values.<id>` (never `updatedAt` / `updatedBy`), so the item activity
 * trigger sees no user edit and logs nothing of its own.
 */
export function adminRequiredRevertStore(firestore: Firestore): RequiredRevertStore {
  return {
    async getBoard(boardId) {
      const snap = await firestore.collection('boards').doc(boardId).get();
      if (!snap.exists) return null;
      return {
        columns: snap.get('columns') ?? [],
        subitemColumns: snap.get('subitemColumns') ?? [],
        requiredColumnIds: snap.get('requiredColumnIds') ?? [],
      } satisfies RequiredRevertBoard;
    },
    revert(boardId, itemId, entryId, decide) {
      return firestore.runTransaction(async (tx): Promise<RequiredRevertPlan | null> => {
        const ref = firestore.collection('boards').doc(boardId).collection('items').doc(itemId);
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const plan = decide({
          state: snap.get('state'),
          values: (snap.get('values') as Record<string, unknown> | undefined) ?? {},
        });
        if (!plan) return null;
        const patch: Record<string, unknown> = {};
        for (const r of plan.restore) {
          patch[`values.${r.columnId}`] =
            r.previous === undefined ? FieldValue.delete() : r.previous;
        }
        tx.update(ref, patch);
        appendActivityTx(firestore, tx, boardId, entryId, plan.entry);
        return plan;
      });
    },
  };
}
