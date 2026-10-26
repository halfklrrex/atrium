/**
 * The single place that knows Firestore paths and converters (architecture section 4).
 * Components and hooks never build paths by hand - they use `refs`, `queries` and `writes`.
 */
import {
  MAX_RECENTS,
  createBoardInputSchema,
  createWorkspaceInputSchema,
  defaultBoardStructure,
  duplicateBoardName,
  folderInputSchema,
  type Board,
  type BoardKind,
  type CreateBoardInput,
  type CreateWorkspaceInput,
  type EntityState,
  type Favorite,
  type Folder,
  type FolderInput,
  type Item,
  type ItemUpdate,
  type Recent,
  type UpdateReply,
  type User,
  type UserProfileUpdate,
  type Workspace,
} from '@atrium/shared';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type FirestoreDataConverter,
  type Query,
} from 'firebase/firestore';
import { newSlugId } from '../lib/ids';
import { db } from '../lib/firebase';
import { newBoardSeedItems } from './seed-items';
import type {
  BoardDoc,
  FavoriteDoc,
  FolderDoc,
  ItemDoc,
  ItemUpdateDoc,
  RecentDoc,
  UpdateReplyDoc,
  UserDoc,
  WithId,
  WorkspaceDoc,
} from './model';

/**
 * Reads are typed by trusting the writers (security rules + callable functions validate on the way in).
 * `serverTimestamps: 'estimate'` keeps timestamps defined for pending local writes.
 */
function converter<T extends object>(): FirestoreDataConverter<WithId<T>, DocumentData> {
  return {
    toFirestore: ({ id: _id, ...data }) => data as DocumentData,
    fromFirestore: (snapshot, options) =>
      ({
        ...(snapshot.data({ ...options, serverTimestamps: 'estimate' }) as T),
        id: snapshot.id,
      }) as WithId<T>,
  };
}

const userConverter = converter<User>();
const workspaceConverter = converter<Workspace>();
const folderConverter = converter<Folder>();
const boardConverter = converter<Board>();
const itemConverter = converter<Item>();
const itemUpdateConverter = converter<ItemUpdate>();
const updateReplyConverter = converter<UpdateReply>();
const favoriteConverter = converter<Favorite>();
const recentConverter = converter<Recent>();

const COLLECTIONS = {
  users: 'users',
  workspaces: 'workspaces',
  folders: 'folders',
  boards: 'boards',
  items: 'items',
  updates: 'updates',
  replies: 'replies',
  favorites: 'favorites',
  recents: 'recents',
} as const;

export const refs = {
  user: (uid: string): DocumentReference<UserDoc> =>
    doc(db, COLLECTIONS.users, uid).withConverter(userConverter),
  favorites: (uid: string): CollectionReference<FavoriteDoc> =>
    collection(db, COLLECTIONS.users, uid, COLLECTIONS.favorites).withConverter(favoriteConverter),
  recents: (uid: string): CollectionReference<RecentDoc> =>
    collection(db, COLLECTIONS.users, uid, COLLECTIONS.recents).withConverter(recentConverter),

  workspaces: (): CollectionReference<WorkspaceDoc> =>
    collection(db, COLLECTIONS.workspaces).withConverter(workspaceConverter),
  workspace: (workspaceId: string): DocumentReference<WorkspaceDoc> =>
    doc(db, COLLECTIONS.workspaces, workspaceId).withConverter(workspaceConverter),
  folders: (workspaceId: string): CollectionReference<FolderDoc> =>
    collection(db, COLLECTIONS.workspaces, workspaceId, COLLECTIONS.folders).withConverter(
      folderConverter,
    ),

  boards: (): CollectionReference<BoardDoc> =>
    collection(db, COLLECTIONS.boards).withConverter(boardConverter),
  board: (boardId: string): DocumentReference<BoardDoc> =>
    doc(db, COLLECTIONS.boards, boardId).withConverter(boardConverter),
  items: (boardId: string): CollectionReference<ItemDoc> =>
    collection(db, COLLECTIONS.boards, boardId, COLLECTIONS.items).withConverter(itemConverter),
  item: (boardId: string, itemId: string): DocumentReference<ItemDoc> =>
    doc(db, COLLECTIONS.boards, boardId, COLLECTIONS.items, itemId).withConverter(itemConverter),
  updates: (boardId: string, itemId: string): CollectionReference<ItemUpdateDoc> =>
    collection(
      db,
      COLLECTIONS.boards,
      boardId,
      COLLECTIONS.items,
      itemId,
      COLLECTIONS.updates,
    ).withConverter(itemUpdateConverter),
  update: (boardId: string, itemId: string, updateId: string): DocumentReference<ItemUpdateDoc> =>
    doc(
      db,
      COLLECTIONS.boards,
      boardId,
      COLLECTIONS.items,
      itemId,
      COLLECTIONS.updates,
      updateId,
    ).withConverter(itemUpdateConverter),
  replies: (
    boardId: string,
    itemId: string,
    updateId: string,
  ): CollectionReference<UpdateReplyDoc> =>
    collection(
      db,
      COLLECTIONS.boards,
      boardId,
      COLLECTIONS.items,
      itemId,
      COLLECTIONS.updates,
      updateId,
      COLLECTIONS.replies,
    ).withConverter(updateReplyConverter),
  reply: (
    boardId: string,
    itemId: string,
    updateId: string,
    replyId: string,
  ): DocumentReference<UpdateReplyDoc> =>
    doc(
      db,
      COLLECTIONS.boards,
      boardId,
      COLLECTIONS.items,
      itemId,
      COLLECTIONS.updates,
      updateId,
      COLLECTIONS.replies,
      replyId,
    ).withConverter(updateReplyConverter),
};

/**
 * Untyped document references for writes. The converted `refs` above are for reading; writes that
 * use field paths, `deleteField()` or `serverTimestamp()` do not fit the converter's value types.
 */
export const plainRefs = {
  board: (boardId: string): DocumentReference<DocumentData> => doc(db, COLLECTIONS.boards, boardId),
  item: (boardId: string, itemId: string): DocumentReference<DocumentData> =>
    doc(db, COLLECTIONS.boards, boardId, COLLECTIONS.items, itemId),
  /** A fresh item reference (the id is generated on the client). */
  newItem: (boardId: string): DocumentReference<DocumentData> =>
    doc(collection(db, COLLECTIONS.boards, boardId, COLLECTIONS.items)),
};

export const queries = {
  /** "My workspaces" - the query the rules are written for. */
  workspacesForMember: (uid: string): Query<WorkspaceDoc> =>
    query(refs.workspaces(), where('memberIds', 'array-contains', uid)),

  /** Listing half 1: main boards of a workspace (visible to every member). */
  mainBoardsInWorkspace: (workspaceId: string): Query<BoardDoc> =>
    query(refs.boards(), where('workspaceId', '==', workspaceId), where('kind', '==', 'main')),

  /** Listing half 2: boards of a workspace that list the user in `accessUids` (private/shareable). */
  myBoardsInWorkspace: (workspaceId: string, uid: string): Query<BoardDoc> =>
    query(
      refs.boards(),
      where('workspaceId', '==', workspaceId),
      where('accessUids', 'array-contains', uid),
    ),

  /** The user's most recently visited boards, newest first. */
  recents: (uid: string): Query<RecentDoc> =>
    query(refs.recents(uid), orderBy('visitedAt', 'desc'), limit(MAX_RECENTS)),

  activeItems: (boardId: string): Query<ItemDoc> =>
    query(refs.items(boardId), where('state', '==', 'active')),

  deletedItems: (boardId: string): Query<ItemDoc> =>
    query(refs.items(boardId), where('state', '==', 'deleted')),

  archivedItems: (boardId: string): Query<ItemDoc> =>
    query(refs.items(boardId), where('state', '==', 'archived')),

  updates: (boardId: string, itemId: string): Query<ItemUpdateDoc> =>
    query(refs.updates(boardId, itemId), orderBy('createdAt', 'desc')),

  replies: (boardId: string, itemId: string, updateId: string): Query<UpdateReplyDoc> =>
    query(refs.replies(boardId, itemId, updateId), orderBy('createdAt', 'asc')),
};

/** Fields the UI may change on an existing board (a subset of what the rules allow editors/owners). */
export interface BoardPatch {
  name?: string;
  description?: string;
  folderId?: string | null;
  position?: string;
  kind?: BoardKind;
}

export const writes = {
  /** Create a workspace where the caller is the sole owner (the only create the rules permit). */
  async createWorkspace(uid: string, input: CreateWorkspaceInput): Promise<string> {
    const form = createWorkspaceInputSchema.parse(input);
    const created = doc(collection(db, COLLECTIONS.workspaces));
    await setDoc(created, {
      name: form.name,
      description: form.description,
      icon: form.icon,
      color: form.color,
      ownerId: uid,
      memberIds: [uid],
      roles: { [uid]: 'owner' },
      kind: form.kind,
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
    });
    return created.id;
  },

  /** Presentation fields an owner/admin may edit (the rules reject anything else). */
  async updateWorkspace(
    workspaceId: string,
    patch: Partial<Pick<Workspace, 'name' | 'description' | 'icon' | 'color'>>,
  ): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.workspaces, workspaceId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  },

  /** Update the signed-in user's own editable profile fields. */
  async updateUserProfile(uid: string, patch: UserProfileUpdate): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.users, uid), patch);
  },

  // ---- Folders ----

  async createFolder(
    uid: string,
    workspaceId: string,
    input: FolderInput,
    position: string,
  ): Promise<string> {
    const form = folderInputSchema.parse(input);
    const created = doc(collection(db, COLLECTIONS.workspaces, workspaceId, COLLECTIONS.folders));
    await setDoc(created, {
      name: form.name,
      parentFolderId: form.parentFolderId,
      color: form.color,
      position,
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
    });
    return created.id;
  },

  async updateFolder(
    workspaceId: string,
    folderId: string,
    patch: Partial<Pick<Folder, 'name' | 'color' | 'position' | 'parentFolderId'>>,
  ): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.workspaces, workspaceId, COLLECTIONS.folders, folderId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  },

  /**
   * Delete a folder after moving what is inside it to the workspace root: its boards (given with
   * fresh root positions) and its sub-folders. One atomic batch.
   */
  async deleteFolder(
    workspaceId: string,
    folderId: string,
    moved: {
      boards: { id: string; position: string }[];
      folders: { id: string; position: string }[];
    },
  ): Promise<void> {
    const batch = writeBatch(db);
    for (const board of moved.boards) {
      batch.update(doc(db, COLLECTIONS.boards, board.id), {
        folderId: null,
        position: board.position,
        updatedAt: serverTimestamp(),
      });
    }
    for (const folder of moved.folders) {
      batch.update(doc(db, COLLECTIONS.workspaces, workspaceId, COLLECTIONS.folders, folder.id), {
        parentFolderId: null,
        position: folder.position,
        updatedAt: serverTimestamp(),
      });
    }
    batch.delete(doc(db, COLLECTIONS.workspaces, workspaceId, COLLECTIONS.folders, folderId));
    await batch.commit();
  },

  // ---- Boards ----

  /** Create a board with monday's default structure (Person, Status, Date and two groups). */
  async createBoard(
    uid: string,
    workspaceId: string,
    input: CreateBoardInput,
    position: string,
  ): Promise<string> {
    const form = createBoardInputSchema.parse(input);
    const created = doc(collection(db, COLLECTIONS.boards));
    const structure = defaultBoardStructure(newSlugId);
    await setDoc(created, {
      workspaceId,
      folderId: form.folderId,
      name: form.name,
      description: '',
      kind: form.kind,
      access: { [uid]: 'owner' },
      accessUids: [uid],
      position,
      icon: null,
      ...structure,
      derivedColumnIds: [],
      serverManagedColumnIds: [],
      state: 'active',
      deletedAt: null,
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
    });

    // monday starts a new board with five sample items. They are a second write because the item
    // rules look the board up (`get()` sees the state before a batch, so a same-batch create fails).
    // If this write fails the board is still fine, just empty, so it is not worth failing the create.
    try {
      const batch = writeBatch(db);
      for (const item of newBoardSeedItems(structure)) {
        batch.set(plainRefs.newItem(created.id), {
          name: item.name,
          groupId: item.groupId,
          position: item.position,
          parentItemId: null,
          values: item.values ?? {},
          state: 'active',
          deletedAt: null,
          createdAt: serverTimestamp(),
          createdBy: uid,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        });
      }
      await batch.commit();
    } catch (error) {
      console.warn('Could not add the sample items to the new board', error);
    }
    return created.id;
  },

  /** Copy a board's structure (columns, groups, settings) - not its items - with the caller as owner. */
  async duplicateBoard(uid: string, source: BoardDoc, position: string): Promise<string> {
    const created = doc(collection(db, COLLECTIONS.boards));
    await setDoc(created, {
      workspaceId: source.workspaceId,
      folderId: source.folderId,
      name: duplicateBoardName(source.name),
      description: source.description,
      kind: source.kind,
      access: { [uid]: 'owner' },
      accessUids: [uid],
      position,
      icon: null,
      columns: source.columns,
      subitemColumns: source.subitemColumns,
      groups: source.groups,
      itemTerminology: source.itemTerminology,
      derivedColumnIds: [],
      serverManagedColumnIds: [],
      state: 'active',
      deletedAt: null,
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
    });
    return created.id;
  },

  async updateBoard(boardId: string, patch: BoardPatch): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.boards, boardId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  },

  /** Archive / soft-delete / restore. Only board owners may do this (rules). */
  async setBoardState(boardId: string, state: EntityState): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.boards, boardId), {
      state,
      deletedAt: state === 'deleted' ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
  },

  /** Archive / soft-delete / restore an item. Editors may do this (rules). */
  async setItemState(
    boardId: string,
    itemId: string,
    state: EntityState,
    uid: string,
  ): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.boards, boardId, COLLECTIONS.items, itemId), {
      state,
      deletedAt: state === 'deleted' ? serverTimestamp() : null,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  },

  /** Permanently delete an item from Firestore. Editors may do this (rules). */
  async deleteItemPermanently(boardId: string, itemId: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTIONS.boards, boardId, COLLECTIONS.items, itemId));
  },

  // ---- Favourites and recents (self only) ----

  async addFavorite(uid: string, board: BoardDoc, position: string): Promise<void> {
    await setDoc(doc(db, COLLECTIONS.users, uid, COLLECTIONS.favorites, board.id), {
      boardId: board.id,
      workspaceId: board.workspaceId,
      addedAt: serverTimestamp(),
      position,
    });
  },

  async removeFavorite(uid: string, boardId: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTIONS.users, uid, COLLECTIONS.favorites, boardId));
  },

  /** Record a visit; one document per board, so re-visits just refresh `visitedAt`. */
  async touchRecent(uid: string, board: Pick<BoardDoc, 'id' | 'workspaceId'>): Promise<void> {
    await setDoc(doc(db, COLLECTIONS.users, uid, COLLECTIONS.recents, board.id), {
      boardId: board.id,
      workspaceId: board.workspaceId,
      visitedAt: serverTimestamp(),
    });
  },
};
