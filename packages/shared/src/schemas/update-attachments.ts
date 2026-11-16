import { z } from 'zod';
import { fileAttachmentSchema } from '../columns/files';
import { safeIdSchema } from './files-upload';

/**
 * Files attached to item updates and replies (spec P4 update attachments). Storage objects live at
 * `boards/{b}/items/{i}/updates/{u}/{fileId}` (replies: `.../updates/{u}/replies/{r}/{fileId}`) and
 * are listed on the update or reply document in `attachments`, written only by the finalize callable.
 * The entry is the Files column's attachment shape (`id`, `name`, `storagePath`, `size`, `mimeType`,
 * `uploadedAt`, `uploadedBy`).
 */

/** Per-file cap for update attachments (the Files column allows up to 100 MB). */
export const UPDATE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/** At most this many files per update or per reply. */
export const UPDATE_ATTACHMENT_MAX_PER_POST = 10;

export const REQUEST_UPDATE_ATTACHMENT_UPLOAD_CALLABLE = 'requestUpdateAttachmentUpload';
export const FINALIZE_UPDATE_ATTACHMENT_CALLABLE = 'finalizeUpdateAttachment';
export const GET_UPDATE_ATTACHMENT_URL_CALLABLE = 'getUpdateAttachmentUrl';
export const DELETE_UPDATE_ATTACHMENT_CALLABLE = 'deleteUpdateAttachment';
export const LIST_BOARD_UPDATE_FILES_CALLABLE = 'listBoardUpdateFiles';

/** Most update and reply documents one `listBoardUpdateFiles` call reads; more sets `truncated`. */
export const LIST_BOARD_UPDATE_FILES_MAX_DOCS = 5000;
/** Most entries one `listBoardUpdateFiles` call returns. */
export const LIST_BOARD_UPDATE_FILES_MAX_ENTRIES = 2000;

export const updateAttachmentsSchema = z
  .array(fileAttachmentSchema)
  .max(UPDATE_ATTACHMENT_MAX_PER_POST)
  .refine((files) => new Set(files.map((f) => f.id)).size === files.length, {
    message: 'Attachment ids must be unique',
  });
export type UpdateAttachments = z.infer<typeof updateAttachmentsSchema>;

/** Where an attachment lives: an update, or a reply when `replyId` is set. */
const target = {
  boardId: safeIdSchema,
  itemId: safeIdSchema,
  updateId: safeIdSchema,
  replyId: safeIdSchema.optional(),
};

export const requestUpdateAttachmentUploadRequestSchema = z
  .object({
    ...target,
    fileName: z.string().min(1).max(255),
    contentType: z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
    size: z.number().int().positive().max(UPDATE_ATTACHMENT_MAX_BYTES),
  })
  .strict();
export type RequestUpdateAttachmentUploadRequest = z.infer<
  typeof requestUpdateAttachmentUploadRequestSchema
>;

export const requestUpdateAttachmentUploadResultSchema = z
  .object({
    uploadUrl: z.string().url(),
    fileId: safeIdSchema,
    expiresAt: z.number().int().positive(),
    headers: z.record(z.string(), z.string()),
  })
  .strict();
export type RequestUpdateAttachmentUploadResult = z.infer<
  typeof requestUpdateAttachmentUploadResultSchema
>;

export const finalizeUpdateAttachmentRequestSchema = z
  .object({ ...target, fileId: safeIdSchema, fileName: z.string().min(1).max(255) })
  .strict();
export type FinalizeUpdateAttachmentRequest = z.infer<typeof finalizeUpdateAttachmentRequestSchema>;

export const finalizeUpdateAttachmentResultSchema = z
  .object({ attachment: fileAttachmentSchema })
  .strict();
export type FinalizeUpdateAttachmentResult = z.infer<typeof finalizeUpdateAttachmentResultSchema>;

export const getUpdateAttachmentUrlRequestSchema = z
  .object({ ...target, fileId: safeIdSchema })
  .strict();
export type GetUpdateAttachmentUrlRequest = z.infer<typeof getUpdateAttachmentUrlRequestSchema>;

export const getUpdateAttachmentUrlResultSchema = z
  .object({ downloadUrl: z.string().url(), expiresAt: z.number().int().positive() })
  .strict();
export type GetUpdateAttachmentUrlResult = z.infer<typeof getUpdateAttachmentUrlResultSchema>;

export const deleteUpdateAttachmentRequestSchema = z
  .object({ ...target, fileId: safeIdSchema })
  .strict();
export type DeleteUpdateAttachmentRequest = z.infer<typeof deleteUpdateAttachmentRequestSchema>;

export const deleteUpdateAttachmentResultSchema = z
  .object({ success: z.literal(true), attachments: updateAttachmentsSchema })
  .strict();
export type DeleteUpdateAttachmentResult = z.infer<typeof deleteUpdateAttachmentResultSchema>;

/** Every file on a board's updates and replies, for the Files view (metadata only, no URLs). */
export const listBoardUpdateFilesRequestSchema = z.object({ boardId: safeIdSchema }).strict();
export type ListBoardUpdateFilesRequest = z.infer<typeof listBoardUpdateFilesRequestSchema>;

export const updateFileEntrySchema = z
  .object({
    itemId: safeIdSchema,
    updateId: safeIdSchema,
    replyId: safeIdSchema.nullable(),
    authorId: z.string().min(1),
    /** When the update or reply was posted, in epoch milliseconds. */
    createdAt: z.number().int().nonnegative(),
    file: fileAttachmentSchema,
  })
  .strict();
export type UpdateFileEntry = z.infer<typeof updateFileEntrySchema>;

export const listBoardUpdateFilesResultSchema = z
  .object({
    files: z.array(updateFileEntrySchema).max(LIST_BOARD_UPDATE_FILES_MAX_ENTRIES),
    /** True when the board has more update files than one call returns or reads. */
    truncated: z.boolean(),
  })
  .strict();
export type ListBoardUpdateFilesResult = z.infer<typeof listBoardUpdateFilesResultSchema>;
