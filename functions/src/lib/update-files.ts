import {
  LIST_BOARD_UPDATE_FILES_MAX_DOCS,
  LIST_BOARD_UPDATE_FILES_MAX_ENTRIES,
  resolveBoardRole,
  updateAttachmentsSchema,
  type Board,
  type ListBoardUpdateFilesRequest,
  type ListBoardUpdateFilesResult,
  type UpdateFileEntry,
  type Workspace,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';

/** One update or reply document, reduced to the fields the Files view needs. */
export interface PostFilesRow {
  itemId: string;
  updateId: string;
  replyId: string | null;
  authorId: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** The raw `attachments` field; validated here so a corrupt post is skipped, not fatal. */
  attachments: unknown;
}

export interface UpdateFilesStore {
  getBoard(boardId: string): Promise<Board | null>;
  getWorkspace(workspaceId: string): Promise<Workspace | null>;
  /** Reads at most `limit` update and reply documents of the board; `truncated` when more exist. */
  listPosts(boardId: string, limit: number): Promise<{ rows: PostFilesRow[]; truncated: boolean }>;
}

/** Whether an item's update files are listed: active and top-level (like the Files view). */
export function isListableItem(item: { state?: unknown; parentItemId?: unknown }): boolean {
  return item.state === 'active' && (item.parentItemId ?? null) === null;
}

/**
 * Metadata of every file attached to the board's updates and replies. Any board role may read it
 * (viewers included); callers without one get `not-found`, so board ids can't be probed. No
 * download URLs here: those still come from `getUpdateAttachmentUrl`.
 */
export async function listBoardUpdateFiles(
  store: UpdateFilesStore,
  request: ListBoardUpdateFilesRequest,
  authUid: string,
  maxDocs: number = LIST_BOARD_UPDATE_FILES_MAX_DOCS,
  maxEntries: number = LIST_BOARD_UPDATE_FILES_MAX_ENTRIES,
): Promise<ListBoardUpdateFilesResult> {
  const board = await store.getBoard(request.boardId);
  const workspace = board ? await store.getWorkspace(board.workspaceId) : null;
  const role = board ? resolveBoardRole(board, authUid, workspace?.roles?.[authUid] ?? null) : null;
  if (!board || !role) throw new HttpsError('not-found', 'Board not found');

  const { rows, truncated: docsCapped } = await store.listPosts(request.boardId, maxDocs);
  const entries: UpdateFileEntry[] = [];
  for (const row of rows) {
    // A post without an author can't be returned (the schema requires one); skip it, don't fail.
    if (!row.authorId) continue;
    const parsed = updateAttachmentsSchema.safeParse(row.attachments ?? []);
    if (!parsed.success) continue;
    for (const file of parsed.data) {
      entries.push({
        itemId: row.itemId,
        updateId: row.updateId,
        replyId: row.replyId,
        authorId: row.authorId,
        createdAt: row.createdAt,
        file,
      });
    }
  }
  entries.sort((a, b) => b.createdAt - a.createdAt);
  const entriesCapped = entries.length > maxEntries;
  return {
    files: entriesCapped ? entries.slice(0, maxEntries) : entries,
    truncated: docsCapped || entriesCapped,
  };
}
