import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import type { ItemIndexStore } from './item-index';

/** gRPC status `NOT_FOUND`: the item was deleted before the write. */
const NOT_FOUND = 5;
/** gRPC status `FAILED_PRECONDITION`: the item changed after the event's version. */
const FAILED_PRECONDITION = 9;

/** The write half of the item index store; `getBoard` comes from the shared board read. */
export function adminItemIndexWriter(firestore: Firestore): Pick<ItemIndexStore, 'setItemIndex'> {
  return {
    async setItemIndex(boardId, itemId, fields, expectedUpdateTime) {
      const ref = firestore.collection('boards').doc(boardId).collection('items').doc(itemId);
      try {
        // Only these two fields, never `updatedAt` / `updatedBy`. The precondition keeps a late
        // event from overwriting the index of a newer write (whose own event recomputes it).
        await ref.update(
          { assigneeUids: fields.assigneeUids, nameTokens: fields.nameTokens },
          expectedUpdateTime
            ? { lastUpdateTime: expectedUpdateTime as Timestamp }
            : { exists: true },
        );
        return true;
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === NOT_FOUND || code === FAILED_PRECONDITION) return false;
        throw error;
      }
    },
  };
}
