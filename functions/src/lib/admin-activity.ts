import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { expiresAt, type ActivityStore, type MemberProfile, type NewActivity } from './activity';

/** gRPC status `ALREADY_EXISTS`, which `create()` rejects with when the document is there. */
const ALREADY_EXISTS = 6;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const activityCol = (firestore: Firestore, boardId: string) =>
  firestore.collection('boards').doc(boardId).collection('activity');

/** A fresh entry id for a callable's transaction. */
export const newActivityId = (firestore: Firestore, boardId: string): string =>
  activityCol(firestore, boardId).doc().id;

/** The stored document: the entry plus the server time and the TTL expiry. */
function stored(doc: NewActivity): FirebaseFirestore.DocumentData {
  return {
    ...doc,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt(Date.now())),
  };
}

/** Creates an entry inside a callable's transaction (all reads must come before it). */
export function appendActivityTx(
  firestore: Firestore,
  tx: Transaction,
  boardId: string,
  id: string,
  doc: NewActivity,
): void {
  tx.create(activityCol(firestore, boardId).doc(id), stored(doc));
}

function toProfile(snap: FirebaseFirestore.DocumentSnapshot): MemberProfile | null {
  if (!snap.exists) return null;
  const photo: unknown = snap.get('photoURL');
  return {
    name: str(snap.get('displayName')) ?? '',
    photoURL: typeof photo === 'string' && photo ? photo : null,
  };
}

const memberRefs = (firestore: Firestore, workspaceId: string, uids: readonly string[]) =>
  [...new Set(uids)].map((uid) =>
    firestore.collection('workspaces').doc(workspaceId).collection('members').doc(uid),
  );

/** Member profiles read inside a transaction (call before the first write). */
export async function getMemberProfilesTx(
  firestore: Firestore,
  tx: Transaction,
  workspaceId: string,
  uids: readonly string[],
): Promise<Map<string, MemberProfile>> {
  const refs = memberRefs(firestore, workspaceId, uids);
  const out = new Map<string, MemberProfile>();
  if (refs.length === 0) return out;
  const snaps = await tx.getAll(...refs);
  snaps.forEach((snap, i) => {
    const profile = toProfile(snap);
    if (profile) out.set(refs[i]!.id, profile);
  });
  return out;
}

/** Adapts the Admin SDK to the store the activity triggers read and write through. */
export function adminActivityStore(firestore: Firestore): ActivityStore {
  return {
    async getBoard(boardId) {
      const snap = await firestore.collection('boards').doc(boardId).get();
      if (!snap.exists) return null;
      return {
        workspaceId: str(snap.get('workspaceId')) ?? '',
        columns: snap.get('columns') ?? [],
        subitemColumns: snap.get('subitemColumns') ?? [],
        groups: snap.get('groups') ?? [],
      };
    },
    async getMemberProfiles(workspaceId, uids) {
      const refs = workspaceId ? memberRefs(firestore, workspaceId, uids) : [];
      const out = new Map<string, MemberProfile>();
      if (refs.length === 0) return out;
      const snaps = await firestore.getAll(...refs);
      snaps.forEach((snap, i) => {
        const profile = toProfile(snap);
        if (profile) out.set(refs[i]!.id, profile);
      });
      return out;
    },
    async getItemName(boardId, itemId) {
      const snap = await firestore
        .collection('boards')
        .doc(boardId)
        .collection('items')
        .doc(itemId)
        .get();
      return snap.exists ? (str(snap.get('name')) ?? '') : null;
    },
    async createMany(boardId, entries) {
      if (entries.length === 0) return 0;
      const batch = firestore.batch();
      for (const entry of entries) {
        batch.create(activityCol(firestore, boardId).doc(entry.id), stored(entry.doc));
      }
      try {
        await batch.commit();
        return entries.length;
      } catch (error) {
        // A retried event: the batch is atomic, so they were all written the first time.
        if ((error as { code?: unknown }).code === ALREADY_EXISTS) return 0;
        throw error;
      }
    },
  };
}
