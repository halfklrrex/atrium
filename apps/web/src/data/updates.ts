import { createItemUpdateInputSchema, createUpdateReplyInputSchema } from '@atrium/shared';
import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { useMemo } from 'react';
import { db } from '../lib/firebase';
import { plainRefs, queries, refs } from './firestore';
import type { ItemDoc, ItemUpdateDoc, UpdateReplyDoc } from './model';
import { useDocSnapshot, useQuerySnapshot, type SnapshotState } from './useSnapshot';

/** Real-time listener for updates on an item, newest first. */
export function useItemUpdates(
  boardId: string | undefined,
  itemId: string | undefined,
): SnapshotState<ItemUpdateDoc[]> {
  const q = useMemo(
    () => (boardId && itemId ? queries.updates(boardId, itemId) : null),
    [boardId, itemId],
  );
  return useQuerySnapshot(q);
}

/** Real-time listener for replies on a specific update, oldest first. */
export function useUpdateReplies(
  boardId: string | undefined,
  itemId: string | undefined,
  updateId: string | undefined,
): SnapshotState<UpdateReplyDoc[]> {
  const q = useMemo(
    () => (boardId && itemId && updateId ? queries.replies(boardId, itemId, updateId) : null),
    [boardId, itemId, updateId],
  );
  return useQuerySnapshot(q);
}

/** Real-time listener for a single item. */
export function useItem(
  boardId: string | undefined,
  itemId: string | undefined,
): SnapshotState<ItemDoc | null> {
  const ref = useMemo(
    () => (boardId && itemId ? refs.item(boardId, itemId) : null),
    [boardId, itemId],
  );
  return useDocSnapshot(ref);
}

export interface CreateUpdateParams {
  boardId: string;
  itemId: string;
  authorId: string;
  authorName?: string;
  authorPhotoUrl?: string | null;
  content: string;
}

export interface CreateReplyParams {
  boardId: string;
  itemId: string;
  updateId: string;
  authorId: string;
  authorName?: string;
  authorPhotoUrl?: string | null;
  content: string;
}

export interface ToggleLikeParams {
  boardId: string;
  itemId: string;
  updateId: string;
  uid: string;
  currentLikes: readonly string[];
}

export interface ToggleLikeReplyParams {
  boardId: string;
  itemId: string;
  updateId: string;
  replyId: string;
  uid: string;
  currentLikes: readonly string[];
}

export interface DeleteUpdateParams {
  boardId: string;
  itemId: string;
  updateId: string;
}

export interface DeleteReplyParams {
  boardId: string;
  itemId: string;
  updateId: string;
  replyId: string;
}

/** Creates a new update post in the item feed. */
export async function createUpdate(params: CreateUpdateParams): Promise<string> {
  const parsed = createItemUpdateInputSchema.parse({ content: params.content });
  const collectionRef = refs.updates(params.boardId, params.itemId);
  const newRef = doc(collectionRef);

  // The post and the item's updates counter (the row bubble) land together or not at all.
  const batch = writeBatch(db);
  batch.set(newRef, {
    id: newRef.id,
    itemId: params.itemId,
    authorId: params.authorId,
    ...(params.authorName ? { authorName: params.authorName } : {}),
    ...(params.authorPhotoUrl !== undefined ? { authorPhotoUrl: params.authorPhotoUrl } : {}),
    content: parsed.content,
    likes: [],
    repliesCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(plainRefs.item(params.boardId, params.itemId), { updatesCount: increment(1) });
  await batch.commit();

  return newRef.id;
}

/** Toggles like status for the user on an update. */
export async function toggleLikeUpdate(params: ToggleLikeParams): Promise<void> {
  const ref = refs.update(params.boardId, params.itemId, params.updateId);
  const isLiked = params.currentLikes.includes(params.uid);

  await updateDoc(ref, {
    likes: isLiked ? arrayRemove(params.uid) : arrayUnion(params.uid),
  });
}

/** Creates a reply to an update post and increments parent repliesCount. */
export async function createReply(params: CreateReplyParams): Promise<string> {
  const parsed = createUpdateReplyInputSchema.parse({ content: params.content });
  const collectionRef = refs.replies(params.boardId, params.itemId, params.updateId);
  const newRef = doc(collectionRef);

  await setDoc(newRef, {
    id: newRef.id,
    updateId: params.updateId,
    authorId: params.authorId,
    ...(params.authorName ? { authorName: params.authorName } : {}),
    ...(params.authorPhotoUrl !== undefined ? { authorPhotoUrl: params.authorPhotoUrl } : {}),
    content: parsed.content,
    likes: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Increment repliesCount on the parent update doc
  try {
    const parentRef = refs.update(params.boardId, params.itemId, params.updateId);
    await updateDoc(parentRef, {
      repliesCount: increment(1),
    });
  } catch (error) {
    console.warn('Could not increment update repliesCount', error);
  }

  return newRef.id;
}

/** Toggles like status for the user on a reply. */
export async function toggleLikeReply(params: ToggleLikeReplyParams): Promise<void> {
  const ref = refs.reply(params.boardId, params.itemId, params.updateId, params.replyId);
  const isLiked = params.currentLikes.includes(params.uid);

  await updateDoc(ref, {
    likes: isLiked ? arrayRemove(params.uid) : arrayUnion(params.uid),
  });
}

/** Deletes an update post. */
export async function deleteUpdate(params: DeleteUpdateParams): Promise<void> {
  const ref = refs.update(params.boardId, params.itemId, params.updateId);
  await deleteDoc(ref);

  // Items from before the counter existed sit at 0, where the rules refuse a decrement: not fatal.
  try {
    await updateDoc(plainRefs.item(params.boardId, params.itemId), {
      updatesCount: increment(-1),
    });
  } catch (error) {
    console.warn('Could not decrement the item updatesCount', error);
  }
}

/** Deletes a reply and decrements parent repliesCount. */
export async function deleteReply(params: DeleteReplyParams): Promise<void> {
  const ref = refs.reply(params.boardId, params.itemId, params.updateId, params.replyId);
  await deleteDoc(ref);

  try {
    const parentRef = refs.update(params.boardId, params.itemId, params.updateId);
    await updateDoc(parentRef, {
      repliesCount: increment(-1),
    });
  } catch (error) {
    console.warn('Could not decrement update repliesCount', error);
  }
}

/** Updates the name of an item. */
export async function updateItemName(
  boardId: string,
  itemId: string,
  name: string,
  uid: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const ref = refs.item(boardId, itemId);
  await updateDoc(ref, {
    name: trimmed,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
}
