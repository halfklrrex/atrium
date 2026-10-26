/**
 * Writes for saved board views (`boards/{boardId}/views/{viewId}`). Shared views follow board edit
 * rights, personal ones belong to their owner (see firestore.rules).
 */
import {
  MAIN_VIEW_ID,
  MAIN_VIEW_NAME,
  MAIN_VIEW_POSITION,
  viewSettingsSchema,
  type ViewSettings,
  type ViewType,
} from '@atrium/shared';
import {
  deleteDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { plainRefs } from './firestore';
import type { BoardViewDoc } from './model';

export interface NewViewInput {
  type: ViewType;
  name: string;
  /** `null` = shared, a uid = that user's personal view. */
  ownerId: string | null;
  position: string;
  settings: ViewSettings;
}

/** Settings as Firestore takes them: validated, and without `undefined` (not storable). */
export function cleanSettings(settings: ViewSettings): ViewSettings {
  return viewSettingsSchema.parse(JSON.parse(JSON.stringify(settings)));
}

function createData(uid: string, input: NewViewInput) {
  return {
    name: input.name,
    type: input.type,
    position: input.position,
    ownerId: input.ownerId,
    settings: cleanSettings(input.settings),
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
}

const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

export const viewWrites = {
  /** Add a view (a fresh id) and return its id. */
  async create(boardId: string, uid: string, input: NewViewInput): Promise<string> {
    const ref = plainRefs.newView(boardId);
    await setDoc(ref, createData(uid, input));
    return ref.id;
  },

  /**
   * Persist a view's filters, sorts, group-by and hidden columns. The built-in `main` view is only
   * created now, the first time somebody saves it.
   */
  async saveSettings(
    boardId: string,
    uid: string,
    view: Pick<BoardViewDoc, 'id' | 'synthetic'>,
    settings: ViewSettings,
  ): Promise<void> {
    const ref = plainRefs.view(boardId, view.id);
    const clean = cleanSettings(settings);
    if (view.id !== MAIN_VIEW_ID || !view.synthetic) {
      await updateDoc(ref, { settings: clean, ...stamp(uid) });
      return;
    }
    // Somebody else may have saved `main` since this client last looked: update then, create otherwise.
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        tx.update(ref, { settings: clean, ...stamp(uid) });
      } else {
        tx.set(
          ref,
          createData(uid, {
            type: 'table',
            name: MAIN_VIEW_NAME,
            position: MAIN_VIEW_POSITION,
            ownerId: null,
            settings: clean,
          }),
        );
      }
    });
  },

  async rename(boardId: string, uid: string, viewId: string, name: string): Promise<void> {
    await updateDoc(plainRefs.view(boardId, viewId), { name, ...stamp(uid) });
  },

  async reorder(boardId: string, uid: string, viewId: string, position: string): Promise<void> {
    await updateDoc(plainRefs.view(boardId, viewId), { position, ...stamp(uid) });
  },

  /** Delete a view (never `main`; the rules refuse it). */
  async remove(boardId: string, viewId: string): Promise<void> {
    await deleteDoc(plainRefs.view(boardId, viewId));
  },

  /** Put a deleted view back under its old id (the "Undo" of a delete). */
  async restore(boardId: string, uid: string, view: BoardViewDoc): Promise<void> {
    await setDoc(
      plainRefs.view(boardId, view.id),
      createData(uid, {
        type: view.type,
        name: view.name,
        ownerId: view.ownerId,
        position: view.position,
        settings: view.settings,
      }),
    );
  },

  /**
   * Make a view personal or shared. The owner of a view never changes, so this writes a copy with
   * the new owner and deletes the original in one batch. Returns the copy's id.
   */
  async changeScope(
    boardId: string,
    uid: string,
    view: BoardViewDoc,
    ownerId: string | null,
  ): Promise<string> {
    const copy = plainRefs.newView(boardId);
    const batch = writeBatch(db);
    batch.set(
      copy,
      createData(uid, {
        type: view.type,
        name: view.name,
        ownerId,
        position: view.position,
        settings: view.settings,
      }),
    );
    batch.delete(plainRefs.view(boardId, view.id));
    await batch.commit();
    return copy.id;
  },
};
