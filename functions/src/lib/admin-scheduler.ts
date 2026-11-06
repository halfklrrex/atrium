import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { toAutomationDoc } from './admin-automations';
import type { ScheduledRecipe, SchedulerStore } from './automations/schedule';

/** `system/automationScheduler`: the scheduler's state. No client access (rules). */
const stateRef = (firestore: Firestore) =>
  firestore.collection('system').doc('automationScheduler');

/** Upper bound of recipes one query reads (a board holds at most 20, 5 of them scheduled). */
const RECIPE_SCAN_LIMIT = 1000;

function recipesOf(snap: FirebaseFirestore.QuerySnapshot): ScheduledRecipe[] {
  return snap.docs.flatMap((d) => {
    const boardId = d.ref.parent.parent?.id;
    return boardId ? [{ boardId, automation: toAutomationDoc(d.id, d.data()) }] : [];
  });
}

/**
 * Adapts the Admin SDK to the scheduler's store.
 *
 * Indexes: the two collection-group queries on `automations` need `(enabled, nextRunAt)` and
 * `(enabled, trigger.type)` (see `firestore.indexes.json`); the item lookup is an `array-contains`
 * on `dateKeys` inside one board's `items` (single-field, automatic).
 */
export function adminSchedulerStore(firestore: Firestore): SchedulerStore {
  return {
    async getLastTickMs() {
      const snap = await stateRef(firestore).get();
      const at: unknown = snap.get('lastTickAt');
      return at instanceof Timestamp ? at.toMillis() : null;
    },
    async setLastTickMs(ms) {
      await stateRef(firestore).set({ lastTickAt: Timestamp.fromMillis(ms) }, { merge: true });
    },
    async listDueRecurring(nowMs) {
      const snap = await firestore
        .collectionGroup('automations')
        .where('enabled', '==', true)
        .where('nextRunAt', '<=', Timestamp.fromMillis(nowMs))
        .limit(RECIPE_SCAN_LIMIT)
        .get();
      return recipesOf(snap);
    },
    async listDateArrivesRecipes() {
      const snap = await firestore
        .collectionGroup('automations')
        .where('enabled', '==', true)
        .where('trigger.type', '==', 'date_arrives')
        .limit(RECIPE_SCAN_LIMIT)
        .get();
      return recipesOf(snap);
    },
    async listItemsByDateKey(boardId, dateKey, limit) {
      const snap = await firestore
        .collection('boards')
        .doc(boardId)
        .collection('items')
        .where('dateKeys', 'array-contains', dateKey)
        .limit(limit)
        .get();
      return snap.docs
        .filter((d) => d.get('state') === 'active' && !d.get('parentItemId'))
        .map((d) => ({
          id: d.id,
          name: typeof d.get('name') === 'string' ? (d.get('name') as string) : '',
          values: (d.get('values') as Record<string, unknown> | undefined) ?? {},
        }));
    },
  };
}
