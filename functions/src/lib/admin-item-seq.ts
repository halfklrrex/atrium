import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { BoardItemCounters, ItemSeqTx } from './item-seq';

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;

/** Adapts an Admin SDK transaction to the narrow interface of the item-number allocation. */
export function adminItemSeqTx(firestore: Firestore, tx: Transaction): ItemSeqTx {
  const itemRef = (boardId: string, itemId: string) =>
    firestore.collection('boards').doc(boardId).collection('items').doc(itemId);
  const globalRef = firestore.collection('counters').doc('items');
  const boardRef = (boardId: string) =>
    firestore.collection('boards').doc(boardId).collection('counters').doc('items');

  return {
    async getItem(boardId, itemId) {
      const snap = await tx.get(itemRef(boardId, itemId));
      if (!snap.exists) return null;
      const seq: unknown = snap.get('seq');
      const boardSeq: unknown = snap.get('boardSeq');
      return {
        isSubitem: snap.get('parentItemId') != null,
        ...(typeof seq === 'number' ? { seq } : {}),
        ...(typeof boardSeq === 'number' ? { boardSeq } : {}),
      };
    },
    async getGlobalCounter() {
      return num((await tx.get(globalRef)).get('next'));
    },
    async getBoardCounters(boardId): Promise<BoardItemCounters> {
      const snap = await tx.get(boardRef(boardId));
      return { nextItem: num(snap.get('nextItem')), nextSubitem: num(snap.get('nextSubitem')) };
    },
    setItemNumbers(boardId, itemId, numbers) {
      tx.update(itemRef(boardId, itemId), numbers);
    },
    setGlobalCounter(next) {
      tx.set(globalRef, { next });
    },
    setBoardCounters(boardId, counters) {
      tx.set(boardRef(boardId), counters);
    },
  };
}
