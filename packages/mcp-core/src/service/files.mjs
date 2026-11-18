// Service methods: files. `listFiles` reads Firestore metadata only and works in both modes; the link,
// upload and delete methods need Cloud Storage and so go through `serverOps`, which only the hosted
// Function provides (it calls the file callables' own library code). Receives the shared helpers of
// `createService` (see ../service.mjs). Mirrors `functions/src/lib/file-storage.ts` and
// `update-attachments.ts`; the callables' checks run again inside `serverOps`.
import {
  filesSettingsSchema,
  filesValueSchema,
  isFileAllowed,
  updateAttachmentsSchema,
} from '@atrium/shared';
import { McpUserError, assertId } from '../errors.mjs';
import { findColumn } from '../refs.mjs';

/** Largest file the connector takes (the `/mcp` body limit is 1 MB of JSON, and base64 adds a third). */
export const MAX_UPLOAD_BYTES = 512 * 1024;
/** Most entries one `listFiles` call returns. */
const MAX_LISTED = 500;
/** Items whose updates one board-wide listing reads (only items with updates are read). */
const MAX_ITEMS_WITH_UPDATES = 200;
const CONCURRENCY = 10;
const CONTENT_TYPE = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const NEEDS_HOSTED_MESSAGE =
  'This needs the hosted Atrium connector (file storage); the local server cannot do it.';

export function filesService(h, serverOps) {
  const { client, uid, loadBoard, memberProfiles, memberName, itemsOf, iso, assertWritableColumn } =
    h;

  const filesColumns = (board) => board.columns.filter((c) => c.type === 'files');

  /** The Files column to use: the one named, or the only one on the board. */
  function pickFilesColumn(board, ref) {
    if (ref !== undefined && ref !== null) {
      const column = findColumn(board, ref);
      if (column.type !== 'files') {
        throw new McpUserError(`Column "${column.title}" is not a Files column.`);
      }
      return column;
    }
    const all = filesColumns(board);
    if (all.length === 1) return all[0];
    if (all.length === 0) {
      throw new McpUserError('This board has no Files column. Add one with atrium_add_column.');
    }
    throw new McpUserError(
      `Name the Files column with "column": ${all.map((c) => `"${c.title}"`).join(', ')}.`,
    );
  }

  /** An item that is active or archived (links and deletes still work on archived items). */
  async function liveItem(boardId, itemId) {
    assertId(itemId, 'itemId');
    const item = await client.getDoc(`boards/${boardId}/items/${itemId}`);
    if (!item || item.state === 'deleted') {
      throw new McpUserError(`Item "${itemId}" was not found on this board.`);
    }
    return item;
  }

  const cellFiles = (item, column) => {
    const raw = item.values?.[column.id];
    if (!raw) return [];
    const parsed = filesValueSchema.safeParse(raw);
    return parsed.success ? parsed.data.files : [];
  };

  const postFiles = (post) => {
    const parsed = updateAttachmentsSchema.safeParse(post?.attachments ?? []);
    return parsed.success ? parsed.data : [];
  };

  const shapeFile = (file, names) => ({
    id: file.id,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    uploadedAt: file.uploadedAt,
    uploadedBy: { uid: file.uploadedBy, name: names.get(file.uploadedBy) ?? null },
  });

  /** Every update and reply of one item that holds attachments: `{ updateId, replyId?, files }`. */
  async function postsWithFiles(boardId, itemId, item) {
    const base = `boards/${boardId}/items/${itemId}/updates`;
    const out = [];
    if ((item.updatesCount ?? 1) <= 0) return out;
    for (const update of await client.listAllDocs(base)) {
      const files = postFiles(update.data);
      if (files.length > 0)
        out.push({ updateId: update.id, files, authorId: update.data.authorId });
      if ((update.data.repliesCount ?? 0) > 0) {
        for (const reply of await client.listAllDocs(`${base}/${update.id}/replies`)) {
          const replyFiles = postFiles(reply.data);
          if (replyFiles.length > 0) {
            out.push({
              updateId: update.id,
              replyId: reply.id,
              files: replyFiles,
              authorId: reply.data.authorId,
            });
          }
        }
      }
    }
    return out;
  }

  /** Where a file id lives on an item: a Files column cell or an update or reply attachment. */
  async function locateFile({ boardId, loaded, itemId, item, fileId, column, updateId, replyId }) {
    assertId(fileId, 'fileId');
    const notFound = () =>
      new McpUserError(
        `File "${fileId}" was not found on this item. Call atrium_list_files for its files.`,
      );
    if (updateId !== undefined) {
      assertId(updateId, 'updateId');
      if (replyId !== undefined) assertId(replyId, 'replyId');
      const path = `boards/${boardId}/items/${itemId}/updates/${updateId}`;
      const post = await client.getDoc(replyId === undefined ? path : `${path}/replies/${replyId}`);
      const file = postFiles(post).find((f) => f.id === fileId);
      if (!file) throw notFound();
      return { kind: 'update', updateId, replyId, file, authorId: post.authorId };
    }
    const columns =
      column === undefined || column === null
        ? filesColumns(loaded.board)
        : [pickFilesColumn(loaded.board, column)];
    for (const col of columns) {
      const file = cellFiles(item, col).find((f) => f.id === fileId);
      if (file) return { kind: 'column', column: col, file };
    }
    if (column === undefined || column === null) {
      for (const post of await postsWithFiles(boardId, itemId, item)) {
        const file = post.files.find((f) => f.id === fileId);
        if (file) {
          return {
            kind: 'update',
            updateId: post.updateId,
            replyId: post.replyId,
            file,
            authorId: post.authorId,
          };
        }
      }
    }
    throw notFound();
  }

  const sourceOf = (found) =>
    found.kind === 'column'
      ? { column: found.column.title }
      : {
          updateId: found.updateId,
          ...(found.replyId === undefined ? {} : { replyId: found.replyId }),
        };

  function requireServerOps() {
    if (!serverOps) throw new McpUserError(NEEDS_HOSTED_MESSAGE);
    return serverOps;
  }

  return {
    hasServerOps: Boolean(serverOps),

    async listFiles({ boardId, itemId, column, includeUpdates = true }) {
      const loaded = await loadBoard(boardId, 'view');
      const columns = column === undefined ? filesColumns(loaded.board) : [];
      if (column !== undefined) columns.push(pickFilesColumn(loaded.board, column));
      const names = new Map(
        [...(await memberProfiles(loaded.workspaceId))].map(([memberUid, p]) => [
          memberUid,
          memberName(p, memberUid),
        ]),
      );
      const notes = [];
      let docs;
      if (itemId !== undefined) {
        assertId(itemId, 'itemId');
        const item = await liveItem(boardId, itemId);
        if (item.state !== 'active') notes.push(`Item "${itemId}" is ${item.state}.`);
        docs = [{ id: itemId, data: item }];
      } else {
        // Like the Files gallery: active, top-level items.
        docs = (await itemsOf(boardId)).filter(
          (d) => d.data.state === 'active' && (d.data.parentItemId ?? null) === null,
        );
      }
      const entries = [];
      for (const doc of docs) {
        for (const col of columns) {
          for (const file of cellFiles(doc.data, col)) {
            entries.push({
              ...shapeFile(file, names),
              itemId: doc.id,
              itemName: doc.data.name ?? null,
              source: { column: col.title },
            });
          }
        }
      }
      // Update and reply attachments belong to no column, so naming one leaves them out.
      if (includeUpdates && column === undefined) {
        let candidates = docs.filter((d) => (d.data.updatesCount ?? 0) > 0);
        if (candidates.length > MAX_ITEMS_WITH_UPDATES) {
          notes.push(
            `Update attachments were read for the first ${MAX_ITEMS_WITH_UPDATES} of ${candidates.length} items with updates; name an item to read the others.`,
          );
          candidates = candidates.slice(0, MAX_ITEMS_WITH_UPDATES);
        }
        for (let start = 0; start < candidates.length; start += CONCURRENCY) {
          const chunk = candidates.slice(start, start + CONCURRENCY);
          const found = await Promise.all(
            chunk.map((doc) => postsWithFiles(boardId, doc.id, doc.data)),
          );
          chunk.forEach((doc, at) => {
            for (const post of found[at]) {
              for (const file of post.files) {
                entries.push({
                  ...shapeFile(file, names),
                  itemId: doc.id,
                  itemName: doc.data.name ?? null,
                  source: {
                    updateId: post.updateId,
                    ...(post.replyId === undefined ? {} : { replyId: post.replyId }),
                  },
                });
              }
            }
          });
        }
      }
      entries.sort(
        (a, b) =>
          String(b.uploadedAt).localeCompare(String(a.uploadedAt)) || a.id.localeCompare(b.id),
      );
      const shown = entries.slice(0, MAX_LISTED);
      if (entries.length > shown.length) {
        notes.push(`Showing ${shown.length} of ${entries.length} files; name an item or a column.`);
      }
      return {
        boardId,
        filesColumns: filesColumns(loaded.board).map((c) => c.title),
        files: shown,
        total: entries.length,
        ...(notes.length > 0 ? { notes } : {}),
      };
    },

    async getFileLink({ boardId, itemId, fileId, column, updateId, replyId }) {
      const ops = requireServerOps();
      const loaded = await loadBoard(boardId, 'view');
      const item = await liveItem(boardId, itemId);
      const found = await locateFile({
        boardId,
        loaded,
        itemId,
        item,
        fileId,
        column,
        updateId,
        replyId,
      });
      const link = await ops.getFileLink({
        uid,
        boardId,
        itemId,
        fileId,
        ...(found.kind === 'column'
          ? { columnId: found.column.id }
          : { updateId: found.updateId, replyId: found.replyId }),
      });
      return {
        file: {
          id: found.file.id,
          name: found.file.name,
          size: found.file.size,
          mimeType: found.file.mimeType,
        },
        source: sourceOf(found),
        url: link.url,
        expiresAt: iso(new Date(link.expiresAt)),
        note: 'Private link to the file; it expires in about 5 minutes. Do not share it.',
      };
    },

    async uploadFile({ boardId, itemId, column, name, contentType, dataBase64 }) {
      const ops = requireServerOps();
      const loaded = await loadBoard(boardId, 'edit');
      const item = await liveItem(boardId, itemId);
      if (item.state !== 'active') {
        throw new McpUserError(`Item "${itemId}" is ${item.state}; files go on active items.`);
      }
      const col = pickFilesColumn(loaded.board, column);
      assertWritableColumn(loaded, col);

      const fileName = String(name ?? '').trim();
      if (fileName.length < 1 || fileName.length > 255) {
        throw new McpUserError('A file name is 1 to 255 characters.');
      }
      if (/[/\\]/.test(fileName)) {
        throw new McpUserError('A file name cannot contain a slash.');
      }
      if (!CONTENT_TYPE.test(String(contentType ?? ''))) {
        throw new McpUserError('contentType must look like "image/png".');
      }
      const encoded = String(dataBase64 ?? '').replace(/\s+/g, '');
      if (encoded.length === 0 || !BASE64.test(encoded) || encoded.length % 4 === 1) {
        throw new McpUserError('dataBase64 must be the file bytes as standard base64.');
      }
      // Check the size from the text before decoding, so an oversized file is never allocated.
      const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
      const decodedSize = Math.floor((encoded.length * 3) / 4) - padding;
      if (decodedSize > MAX_UPLOAD_BYTES) {
        throw new McpUserError(
          `The file is ${decodedSize} bytes; the connector takes files up to ${MAX_UPLOAD_BYTES / 1024} KB. Upload larger files in Atrium.`,
        );
      }
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length === 0) throw new McpUserError('The file is empty.');

      const settings = filesSettingsSchema.safeParse(col.settings ?? {});
      if (!settings.success) throw new McpUserError(`Column "${col.title}" has invalid settings.`);
      if (bytes.length > settings.data.maxFileSizeMb * 1024 * 1024) {
        throw new McpUserError(
          `The file is larger than this column's limit of ${settings.data.maxFileSizeMb} MB.`,
        );
      }
      if (
        !isFileAllowed({ name: fileName, size: bytes.length, mimeType: contentType }, settings.data)
      ) {
        throw new McpUserError(
          `Column "${col.title}" does not allow this file type (${contentType}, "${fileName}").` +
            (settings.data.allowedTypes
              ? ` Allowed: ${settings.data.allowedTypes.join(', ')}.`
              : ''),
        );
      }
      if (cellFiles(item, col).length >= 100) {
        throw new McpUserError('A Files cell holds at most 100 files.');
      }
      const saved = await ops.uploadFile({
        uid,
        boardId,
        itemId,
        columnId: col.id,
        name: fileName,
        contentType,
        bytes,
      });
      return {
        itemId,
        column: col.title,
        file: {
          id: saved.file.id,
          name: saved.file.name,
          size: saved.file.size,
          mimeType: saved.file.mimeType,
          uploadedAt: saved.file.uploadedAt,
        },
        filesInCell: saved.filesInCell,
      };
    },

    async deleteFile({ boardId, itemId, fileId, column, updateId, replyId }) {
      const ops = requireServerOps();
      const loaded = await loadBoard(boardId, 'edit');
      const item = await liveItem(boardId, itemId);
      const found = await locateFile({
        boardId,
        loaded,
        itemId,
        item,
        fileId,
        column,
        updateId,
        replyId,
      });
      if (found.kind === 'column') {
        assertWritableColumn(loaded, found.column);
      } else if (found.authorId !== uid && loaded.role !== 'owner') {
        throw new McpUserError('Only the author or a board owner can remove an update attachment.');
      }
      const result = await ops.deleteFile({
        uid,
        boardId,
        itemId,
        fileId,
        ...(found.kind === 'column'
          ? { columnId: found.column.id }
          : { updateId: found.updateId, replyId: found.replyId }),
      });
      return {
        deleted: {
          id: found.file.id,
          name: found.file.name,
          size: found.file.size,
          mimeType: found.file.mimeType,
          uploadedAt: found.file.uploadedAt,
          uploadedBy: found.file.uploadedBy,
          source: sourceOf(found),
        },
        remaining: result.remaining,
        note: 'The file itself is gone; only this description remains.',
      };
    },
  };
}
