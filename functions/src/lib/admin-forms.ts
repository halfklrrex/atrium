import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { FORM_UPDATED_VIA } from './activity';
import type { FormBoardData, FormCounts, FormReads, FormsTx, FormViewData } from './forms';

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;

type Get = (ref: DocumentReference) => Promise<DocumentSnapshot>;

/** The view and board reads, inside a transaction or (for `getForm`) outside one. */
function formReads(firestore: Firestore, get: Get): FormReads {
  const boardRef = (boardId: string) => firestore.collection('boards').doc(boardId);
  return {
    async getView(boardId, viewId): Promise<FormViewData | null> {
      const snap = await get(boardRef(boardId).collection('views').doc(viewId));
      if (!snap.exists) return null;
      return {
        type: String(snap.get('type') ?? ''),
        ownerId: (snap.get('ownerId') as string | null | undefined) ?? null,
        settings: (snap.get('settings') as FormViewData['settings']) ?? null,
      };
    },
    async getBoard(boardId): Promise<FormBoardData | null> {
      const snap = await get(boardRef(boardId));
      if (!snap.exists) return null;
      return {
        state: String(snap.get('state') ?? ''),
        columns: snap.get('columns') ?? [],
        groups: snap.get('groups') ?? [],
      };
    },
  };
}

/** `getForm`'s reads: plain document gets. */
export const adminFormsReads = (firestore: Firestore): FormReads =>
  formReads(firestore, (ref) => ref.get());

/** Adapts an Admin SDK transaction to the narrow interface of `submitForm`. */
export function adminFormsTx(firestore: Firestore, tx: Transaction): FormsTx {
  const boardRef = (boardId: string) => firestore.collection('boards').doc(boardId);
  const itemsCol = (boardId: string) => boardRef(boardId).collection('items');
  const counters = (boardId: string) => boardRef(boardId).collection('counters');
  // Fixed hour windows; one document for the whole form and one per person.
  const formCounter = (boardId: string, viewId: string, hour: number) =>
    counters(boardId).doc(`form_${viewId}_${hour}`);
  const personCounter = (boardId: string, viewId: string, uid: string, hour: number) =>
    counters(boardId).doc(`form_${viewId}_${hour}_${encodeURIComponent(uid)}`);

  return {
    ...formReads(firestore, (ref) => tx.get(ref)),
    async getLastItemPosition(boardId) {
      const snap = await tx.get(itemsCol(boardId).orderBy('position', 'desc').limit(1));
      const position: unknown = snap.docs[0]?.get('position');
      return typeof position === 'string' && position ? position : null;
    },
    async getCounts(boardId, viewId, uid, hour): Promise<FormCounts> {
      const [person, form] = await tx.getAll(
        personCounter(boardId, viewId, uid, hour),
        formCounter(boardId, viewId, hour),
      );
      return { person: count(person?.get('count')), form: count(form?.get('count')) };
    },
    setCounts(boardId, viewId, uid, hour, counts, expiresAtMs) {
      const expiresAt = Timestamp.fromMillis(expiresAtMs);
      tx.set(personCounter(boardId, viewId, uid, hour), { count: counts.person, expiresAt });
      tx.set(formCounter(boardId, viewId, hour), { count: counts.form, expiresAt });
    },
    newItemId: (boardId) => itemsCol(boardId).doc().id,
    createItem(boardId, itemId, item) {
      tx.create(itemsCol(boardId).doc(itemId), {
        name: item.name,
        groupId: item.groupId,
        position: item.position,
        parentItemId: null,
        values: item.values,
        state: 'active',
        deletedAt: null,
        // The submitter is the author but gains no access (no rule reads `createdBy`). `updatedVia`
        // lets the activity trigger tag the `item_created` entry with `data.source: 'form'`.
        createdAt: FieldValue.serverTimestamp(),
        createdBy: item.createdBy,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: item.createdBy,
        updatedVia: FORM_UPDATED_VIA,
      });
    },
    nowMs: () => Date.now(),
  };
}
