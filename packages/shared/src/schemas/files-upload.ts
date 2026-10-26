import { z } from 'zod';
import { fileAttachmentSchema, filesValueSchema } from '../columns/files';

export const safeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, 'Must be 1-128 alphanumeric, dash or underscore characters');

export const requestFileUploadRequestSchema = z
  .object({
    boardId: safeIdSchema,
    itemId: safeIdSchema,
    columnId: safeIdSchema,
    fileName: z.string().min(1).max(255),
    contentType: z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
    size: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
  })
  .strict();
export type RequestFileUploadRequest = z.infer<typeof requestFileUploadRequestSchema>;

export const requestFileUploadResultSchema = z
  .object({
    uploadUrl: z.string().url(),
    fileId: safeIdSchema,
    storagePath: z.string().min(1),
    expiresAt: z.number().int().positive(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type RequestFileUploadResult = z.infer<typeof requestFileUploadResultSchema>;

export const finalizeFileUploadRequestSchema = z
  .object({
    boardId: safeIdSchema,
    itemId: safeIdSchema,
    columnId: safeIdSchema,
    fileId: safeIdSchema,
    fileName: z.string().min(1).max(255),
  })
  .strict();
export type FinalizeFileUploadRequest = z.infer<typeof finalizeFileUploadRequestSchema>;

export const finalizeFileUploadResultSchema = z
  .object({
    file: fileAttachmentSchema,
    columnValue: filesValueSchema,
  })
  .strict();
export type FinalizeFileUploadResult = z.infer<typeof finalizeFileUploadResultSchema>;

export const getFileDownloadUrlRequestSchema = z
  .object({
    boardId: safeIdSchema,
    itemId: safeIdSchema,
    columnId: safeIdSchema,
    fileId: safeIdSchema,
  })
  .strict();
export type GetFileDownloadUrlRequest = z.infer<typeof getFileDownloadUrlRequestSchema>;

export const getFileDownloadUrlResultSchema = z
  .object({
    downloadUrl: z.string().url(),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type GetFileDownloadUrlResult = z.infer<typeof getFileDownloadUrlResultSchema>;

export const deleteFileAttachmentRequestSchema = z
  .object({
    boardId: safeIdSchema,
    itemId: safeIdSchema,
    columnId: safeIdSchema,
    fileId: safeIdSchema,
  })
  .strict();
export type DeleteFileAttachmentRequest = z.infer<typeof deleteFileAttachmentRequestSchema>;

export const deleteFileAttachmentResultSchema = z
  .object({
    success: z.literal(true),
    columnValue: filesValueSchema,
  })
  .strict();
export type DeleteFileAttachmentResult = z.infer<typeof deleteFileAttachmentResultSchema>;

// Aliases for backwards compatibility with earlier draft callables
export const uploadFileAttachmentRequestSchema = finalizeFileUploadRequestSchema;
export type UploadFileAttachmentRequest = FinalizeFileUploadRequest;
export const uploadFileAttachmentResultSchema = finalizeFileUploadResultSchema;
export type UploadFileAttachmentResult = FinalizeFileUploadResult;
