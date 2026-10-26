import {
  canEditBoard,
  resolveBoardRole,
  type EntityState,
  type WorkspaceRole,
} from '@atrium/shared';
import { writes, type BoardDoc, type FavoriteDoc, type FolderDoc } from '../../data';
import { positionAfterAll, positionBetween } from '../../lib/positions';
import { showToast } from '../toast-store';

/** Human readable message for a failed write (permission errors are the common one). */
export function describeError(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'permission-denied') return "You don't have permission to do that.";
  if (code === 'unavailable') return 'You appear to be offline. Try again in a moment.';
  return fallback;
}

/** Run a write and turn failure into a toast instead of an unhandled rejection. */
async function attempt(task: () => Promise<unknown>, failure: string): Promise<boolean> {
  try {
    await task();
    return true;
  } catch (error) {
    console.error(failure, error);
    showToast(describeError(error, failure), { type: 'negative' });
    return false;
  }
}

/** Boards that share a parent (folder or workspace root) with `board`, excluding it. */
export function siblingsOf(board: BoardDoc, all: readonly BoardDoc[]): BoardDoc[] {
  return all.filter((b) => b.id !== board.id && b.folderId === board.folderId);
}

export const boardActions = {
  async rename(board: BoardDoc, name: string): Promise<void> {
    await attempt(() => writes.updateBoard(board.id, { name }), 'Could not rename the board.');
  },

  async setDescription(board: BoardDoc, description: string): Promise<void> {
    await attempt(
      () => writes.updateBoard(board.id, { description }),
      'Could not save the description.',
    );
  },

  async toggleFavorite(
    uid: string,
    board: BoardDoc,
    favorites: readonly FavoriteDoc[],
  ): Promise<void> {
    const existing = favorites.some((f) => f.boardId === board.id);
    if (existing) {
      await attempt(() => writes.removeFavorite(uid, board.id), 'Could not update favorites.');
      return;
    }
    const position = positionAfterAll(favorites);
    await attempt(() => writes.addFavorite(uid, board, position), 'Could not update favorites.');
  },

  /** Structure-only copy placed at the end of the same folder. */
  async duplicate(
    uid: string,
    board: BoardDoc,
    workspaceBoards: readonly BoardDoc[],
  ): Promise<void> {
    const position = positionAfterAll(siblingsOf(board, workspaceBoards));
    const ok = await attempt(
      () => writes.duplicateBoard(uid, board, position),
      'Could not duplicate the board.',
    );
    if (ok) showToast(`Duplicated "${board.name}".`, { type: 'positive' });
  },

  /** Move to a folder (or the workspace root with `null`), landing at the end of the target. */
  async moveToFolder(
    board: BoardDoc,
    folderId: string | null,
    workspaceBoards: readonly BoardDoc[],
  ): Promise<void> {
    if (board.folderId === folderId) return;
    const target = workspaceBoards.filter((b) => b.id !== board.id && b.folderId === folderId);
    const position = positionAfterAll(target);
    await attempt(
      () => writes.updateBoard(board.id, { folderId, position }),
      'Could not move the board.',
    );
  },

  /** Archive or delete (soft), offering Undo. Returns true when the write succeeded. */
  async retire(
    board: BoardDoc,
    state: Extract<EntityState, 'archived' | 'deleted'>,
  ): Promise<boolean> {
    const ok = await attempt(
      () => writes.setBoardState(board.id, state),
      state === 'archived' ? 'Could not archive the board.' : 'Could not delete the board.',
    );
    if (!ok) return false;
    showToast(`"${board.name}" was ${state === 'archived' ? 'archived' : 'deleted'}.`, {
      action: {
        label: 'Undo',
        onClick: () => {
          void attempt(
            () => writes.setBoardState(board.id, 'active'),
            'Could not restore the board.',
          );
        },
      },
    });
    return true;
  },

  async restore(board: BoardDoc): Promise<void> {
    await attempt(() => writes.setBoardState(board.id, 'active'), 'Could not restore the board.');
  },

  /** Drop a board into a folder (end) or the root at the top of the boards, from drag and drop. */
  async moveTo(
    board: BoardDoc,
    destination: { folderId: string | null; position: string },
  ): Promise<void> {
    await attempt(() => writes.updateBoard(board.id, destination), 'Could not move the board.');
  },
};

export const folderActions = {
  async rename(workspaceId: string, folder: FolderDoc, name: string): Promise<void> {
    await attempt(
      () => writes.updateFolder(workspaceId, folder.id, { name }),
      'Could not rename the folder.',
    );
  },

  async reorder(workspaceId: string, folderId: string, position: string): Promise<void> {
    await attempt(
      () => writes.updateFolder(workspaceId, folderId, { position }),
      'Could not move the folder.',
    );
  },

  /**
   * Delete a folder after moving its boards and sub-folders to the workspace root (one batch). Boards
   * the user cannot edit are left alone: the UI shows a board with a missing folder at the root.
   */
  async remove(args: {
    uid: string;
    workspaceRole: WorkspaceRole | null | undefined;
    workspaceId: string;
    folder: FolderDoc;
    folders: readonly FolderDoc[];
    boards: readonly BoardDoc[];
  }): Promise<boolean> {
    const { uid, workspaceRole, workspaceId, folder, folders, boards } = args;
    const rootBoards = boards.filter((b) => b.folderId === null);
    const rootFolders = folders.filter((f) => f.parentFolderId === null);

    // Boards in this folder and in its sub-folders all land at the root, after the existing ones.
    const subFolders = folders.filter((f) => f.parentFolderId === folder.id);
    const insideIds = new Set([folder.id, ...subFolders.map((f) => f.id)]);
    let last = positionAfterAll(rootBoards);
    const movedBoards = boards
      .filter((b) => b.folderId !== null && insideIds.has(b.folderId))
      .filter((b) => canEditBoard(resolveBoardRole(b, uid, workspaceRole)))
      .map((b) => {
        const position = last;
        last = positionBetween(last, null);
        return { id: b.id, position };
      });

    let lastFolder = positionAfterAll(rootFolders);
    const movedFolders = subFolders.map((f) => {
      const position = lastFolder;
      lastFolder = positionBetween(lastFolder, null);
      return { id: f.id, position };
    });

    return attempt(
      () =>
        writes.deleteFolder(workspaceId, folder.id, { boards: movedBoards, folders: movedFolders }),
      'Could not delete the folder.',
    );
  },
};
