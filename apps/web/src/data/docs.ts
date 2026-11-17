/**
 * Docs data layer (P7 docs): converters, refs, queries, writes and hooks for `docs/{id}` (the
 * metadata listed in the sidebar) and `docs/{id}/content/body` (the text). Kept in its own file so
 * the shared Firestore module stays untouched; the rules are in `firestore.rules`.
 *
 * Saves are revision-checked: every body write carries `rev + 1` and the rules refuse anything but
 * the stored `rev` plus one, so two editors can never silently overwrite each other.
 */
import {
  DOC_LIMITS,
  createDocInputSchema,
  docBodyBytes,
  type CreateDocInput,
  type BoardKind,
  type BoardRole,
  type DocBodyJson,
  type DocState,
} from '@atrium/shared';
import {
  collection,
  doc,
  getDocFromServer,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type FirestoreDataConverter,
  type Query,
} from 'firebase/firestore';
import { useMemo } from 'react';
import { docSharingCalls } from '../lib/callables';
import { db } from '../lib/firebase';
import { comparePositions } from '../lib/positions';
import { requireUid } from './firestore';
import type { DocBodyDoc, DocMetaDoc } from './model';
import { useDocSnapshot, useQuerySnapshot, type SnapshotState } from './useSnapshot';

const COLLECTION = 'docs';

const docConverter: FirestoreDataConverter<DocMetaDoc, DocumentData> = {
  toFirestore: ({ id: _id, ...data }) => data as DocumentData,
  fromFirestore: (snapshot, options) =>
    ({
      ...(snapshot.data({ ...options, serverTimestamps: 'estimate' }) as Omit<DocMetaDoc, 'id'>),
      id: snapshot.id,
    }) as DocMetaDoc,
};

const bodyConverter: FirestoreDataConverter<DocBodyDoc, DocumentData> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snapshot, options) =>
    snapshot.data({ ...options, serverTimestamps: 'estimate' }) as DocBodyDoc,
};

export const docRefs = {
  docs: (): CollectionReference<DocMetaDoc> =>
    collection(db, COLLECTION).withConverter(docConverter),
  doc: (docId: string): DocumentReference<DocMetaDoc> =>
    doc(db, COLLECTION, docId).withConverter(docConverter),
  body: (docId: string): DocumentReference<DocBodyDoc> =>
    doc(db, COLLECTION, docId, 'content', 'body').withConverter(bodyConverter),
};

export const docQueries = {
  /** Listing half 1: main docs of a workspace (visible to every member). */
  mainInWorkspace: (workspaceId: string): Query<DocMetaDoc> =>
    query(docRefs.docs(), where('workspaceId', '==', workspaceId), where('kind', '==', 'main')),

  /** Listing half 2: docs of a workspace that list the user in `accessUids`. */
  mineInWorkspace: (workspaceId: string, uid: string): Query<DocMetaDoc> =>
    query(
      docRefs.docs(),
      where('workspaceId', '==', workspaceId),
      where('accessUids', 'array-contains', uid),
    ),
};

// ---- Pure helpers (unit tested) ----

/** Union of listings by id, in position order. */
export function mergeDocs(...lists: readonly (readonly DocMetaDoc[])[]): DocMetaDoc[] {
  const byId = new Map<string, DocMetaDoc>();
  for (const list of lists) for (const d of list) byId.set(d.id, d);
  return [...byId.values()].sort(comparePositions);
}

/** Docs in the workspace trash. */
export function deletedDocs(docs: readonly DocMetaDoc[]): DocMetaDoc[] {
  return docs.filter((d) => d.state === 'deleted');
}

/** Docs that show up in lists: trashed ones are hidden. */
export function activeDocs(docs: readonly DocMetaDoc[]): DocMetaDoc[] {
  return docs.filter((d) => d.state === 'active');
}

/** Thrown before a save when the body is over `DOC_BODY_MAX_BYTES`. */
export class DocTooLongError extends Error {
  constructor() {
    super('This doc is too long to save. Split it into two docs.');
    this.name = 'DocTooLongError';
  }
}

/**
 * True when a refused body save was refused by the rules (`permission-denied`). That is the
 * revision check when somebody else saved in between, but it is also what a lost role or a trashed
 * doc looks like, so callers confirm with `docWrites.readBodyFromServer` (is the stored rev newer
 * than the one the save was based on?) before showing the conflict banner.
 */
export function isRevConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'permission-denied'
  );
}

// ---- Writes ----

/** Fields the UI may change through `updateDocMeta` (a subset of what the rules allow). */
export interface DocPatch {
  name?: string;
  folderId?: string | null;
  position?: string;
}

/** One sharing change: a new kind and/or one person's role (`null` removes them). */
export interface DocSharingChange {
  kind?: BoardKind;
  person?: { uid: string; role: BoardRole | null };
}

/** What a body save sends: the ProseMirror JSON and its plain-text mirror. */
export interface DocBodyContent {
  doc: DocBodyJson;
  text: string;
}

const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: requireUid() });

async function updateMeta(docId: string, fields: Record<string, unknown>): Promise<void> {
  await updateDoc(docRefs.doc(docId), { ...fields, ...stamp() });
}

export const docWrites = {
  /** Create a doc with the caller as its sole owner (the only create the rules permit). */
  async createDoc(
    uid: string,
    workspaceId: string,
    input: CreateDocInput,
    position: string,
  ): Promise<string> {
    const form = createDocInputSchema.parse(input);
    const created = doc(collection(db, COLLECTION));
    await setDoc(created, {
      workspaceId,
      folderId: form.folderId,
      name: form.name,
      kind: form.kind,
      access: { [uid]: 'owner' },
      accessUids: [uid],
      position,
      icon: null,
      state: 'active',
      deletedAt: null,
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
    });
    return created.id;
  },

  /** Rename (1 to 80 characters after trimming). */
  async renameDoc(docId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > DOC_LIMITS.name) {
      throw new Error(`Name must be 1 to ${DOC_LIMITS.name} characters.`);
    }
    await updateMeta(docId, { name: trimmed });
  },

  /** Move to a folder (`null` = the workspace root) and/or a new position. */
  async moveDoc(docId: string, folderId: string | null, position: string): Promise<void> {
    await updateMeta(docId, { folderId, position });
  },

  /** Move to the trash. Only doc owners may do this (rules). */
  async deleteDoc(docId: string): Promise<void> {
    await updateMeta(docId, { state: 'deleted' satisfies DocState, deletedAt: serverTimestamp() });
  },

  /** Bring a doc back from the trash. Only doc owners may do this (rules). */
  async restoreDoc(docId: string): Promise<void> {
    await updateMeta(docId, { state: 'active' satisfies DocState, deletedAt: null });
  },

  /**
   * Change the doc's kind and/or one person's role (`role: null` removes them). Goes through the
   * `setDocAccess` callable (doc owners only; workspace members only, role capped by the
   * workspace role, a live owner stays); the rules refuse direct writes of these fields.
   */
  async setDocSharing(docId: string, change: DocSharingChange): Promise<void> {
    await docSharingCalls.setAccess({ docId, ...change });
  },

  /**
   * Save the body on top of revision `baseRev` (the rev the editor content is based on; `0` when
   * the doc has no body yet). Writes `baseRev + 1` and returns it. The rules refuse the write when
   * somebody else saved in between (a `permission-denied` error: see `isRevConflict`). The text
   * mirror is cut to its limit; a body over `DOC_BODY_MAX_BYTES` throws `DocTooLongError` and
   * nothing is written.
   */
  async saveBody(docId: string, content: DocBodyContent, baseRev: number): Promise<number> {
    if (docBodyBytes(content.doc) > DOC_LIMITS.bodyBytes) throw new DocTooLongError();
    const rev = baseRev + 1;
    const data = {
      doc: content.doc,
      text: content.text.slice(0, DOC_LIMITS.text),
      rev,
      updatedAt: serverTimestamp(),
      updatedBy: requireUid(),
    };
    if (baseRev <= 0) await setDoc(docRefs.body(docId), data as never);
    else await updateDoc(docRefs.body(docId), data);
    return rev;
  },

  /**
   * The stored body straight from the server (never the cache): used after a refused save to see
   * whether somebody else really saved a newer revision. `null` when there is no body yet; rejects
   * when the server can't be reached or the user can't read the doc.
   */
  async readBodyFromServer(docId: string): Promise<DocBodyDoc | null> {
    const snap = await getDocFromServer(docRefs.body(docId));
    return snap.exists() ? snap.data() : null;
  },
};

// ---- Hooks ----

/** One doc's metadata (live); `data` is `null` while missing or not readable. */
export function useDocMeta(docId: string | undefined): SnapshotState<DocMetaDoc | null> {
  const ref = useMemo(() => (docId ? docRefs.doc(docId) : null), [docId]);
  return useDocSnapshot(ref);
}

/** One doc's body (live); `data` is `null` until the first save. */
export function useDocBodySnapshot(docId: string | undefined): SnapshotState<DocBodyDoc | null> {
  const ref = useMemo(() => (docId ? docRefs.body(docId) : null), [docId]);
  return useDocSnapshot(ref);
}

function useMergedDocs(workspaceId: string | undefined, uid: string | null) {
  const mainQuery = useMemo(
    () => (workspaceId && uid ? docQueries.mainInWorkspace(workspaceId) : null),
    [workspaceId, uid],
  );
  const mineQuery = useMemo(
    () => (workspaceId && uid ? docQueries.mineInWorkspace(workspaceId, uid) : null),
    [workspaceId, uid],
  );
  const main = useQuerySnapshot(mainQuery);
  const mine = useQuerySnapshot(mineQuery);
  const data = useMemo(() => mergeDocs(main.data, mine.data), [main.data, mine.data]);
  return { data, loading: main.loading || mine.loading, error: main.error ?? mine.error };
}

/** Active docs of a workspace the user can see (the "main" and "I have access" listeners merged). */
export function useWorkspaceDocs(
  workspaceId: string | undefined,
  uid: string | null,
): SnapshotState<DocMetaDoc[]> {
  const merged = useMergedDocs(workspaceId, uid);
  const data = useMemo(() => activeDocs(merged.data), [merged.data]);
  return { data, loading: merged.loading, error: merged.error };
}

/** All docs of a workspace the user can see, trashed ones included (the Trash page). */
export function useAllWorkspaceDocs(
  workspaceId: string | undefined,
  uid: string | null,
): SnapshotState<DocMetaDoc[]> {
  return useMergedDocs(workspaceId, uid);
}
