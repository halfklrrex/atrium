import { teamInputSchema, type Team, type TeamInput, type TeamWrite } from '@atrium/shared';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  setDoc,
  type CollectionReference,
  type DocumentData,
  type FirestoreDataConverter,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { requireUid } from './firestore';
import type { TeamDoc } from './model';

const teamConverter: FirestoreDataConverter<TeamDoc, DocumentData> = {
  toFirestore: ({ id: _id, ...data }) => data as DocumentData,
  fromFirestore: (snapshot, options) =>
    ({
      ...(snapshot.data({ ...options, serverTimestamps: 'estimate' }) as Team),
      id: snapshot.id,
    }) as TeamDoc,
};

export const teamRefs = {
  /** Any workspace member reads; only owners and admins write (rules). */
  teams: (workspaceId: string): CollectionReference<TeamDoc> =>
    collection(db, 'workspaces', workspaceId, 'teams').withConverter(teamConverter),
};

/** The one place that opens the Firestore listener behind the teams store. */
export function listenToTeams(
  workspaceId: string,
  onData: (teams: TeamDoc[]) => void,
  onError: (error: Error) => void,
): () => void {
  try {
    return onSnapshot(
      teamRefs.teams(workspaceId),
      (snap) => onData(snap.docs.map((d) => d.data())),
      onError,
    );
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
    return () => undefined;
  }
}

const teamDoc = (workspaceId: string, teamId: string) =>
  doc(db, 'workspaces', workspaceId, 'teams', teamId);

export const teamWritesImpl = {
  /** Creates a team and returns its id. Owners and admins only (rules). */
  async create(workspaceId: string, input: TeamInput): Promise<string> {
    const uid = requireUid();
    const form = teamInputSchema.parse(input);
    const created = doc(collection(db, 'workspaces', workspaceId, 'teams'));
    const data: TeamWrite = {
      name: form.name,
      color: form.color,
      memberUids: form.memberUids,
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    await setDoc(created, data);
    return created.id;
  },

  async update(workspaceId: string, teamId: string, input: TeamInput): Promise<void> {
    const uid = requireUid();
    const form = teamInputSchema.parse(input);
    await updateDoc(teamDoc(workspaceId, teamId), {
      name: form.name,
      color: form.color,
      memberUids: form.memberUids,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  },

  async remove(workspaceId: string, teamId: string): Promise<void> {
    await deleteDoc(teamDoc(workspaceId, teamId));
  },
};
