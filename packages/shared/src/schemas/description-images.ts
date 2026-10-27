import { z } from 'zod';
import { uidSchema } from './common';
import { safeIdSchema } from './files-upload';

/**
 * Item description images (P1 description editor, pass 2). The files column is column-bound, so
 * description images have their own Functions-only path: Storage objects at
 * `boards/{b}/items/{i}/description/{fileId}`, listed on the item in `descriptionImages` (a map
 * keyed by fileId, written only by the finalize callable). The doc itself stores just the fileId.
 */

export const DESCRIPTION_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const DESCRIPTION_IMAGE_MAX_PER_ITEM = 50;
export const DESCRIPTION_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
export type DescriptionImageType = (typeof DESCRIPTION_IMAGE_TYPES)[number];

export function isDescriptionImageType(value: string): value is DescriptionImageType {
  return (DESCRIPTION_IMAGE_TYPES as readonly string[]).includes(value);
}

export const REQUEST_DESCRIPTION_IMAGE_UPLOAD_CALLABLE = 'requestDescriptionImageUpload';
export const FINALIZE_DESCRIPTION_IMAGE_CALLABLE = 'finalizeDescriptionImage';
export const GET_DESCRIPTION_IMAGE_URL_CALLABLE = 'getDescriptionImageUrl';

/** One entry of `items/{i}.descriptionImages`, keyed by fileId. */
export const descriptionImageSchema = z
  .object({
    name: z.string().min(1).max(255),
    size: z.number().int().min(0).max(DESCRIPTION_IMAGE_MAX_BYTES),
    mimeType: z.enum(DESCRIPTION_IMAGE_TYPES),
    uploadedAt: z.string().datetime(),
    uploadedBy: uidSchema,
  })
  .strict();
export type DescriptionImage = z.infer<typeof descriptionImageSchema>;

export const descriptionImagesSchema = z.record(safeIdSchema, descriptionImageSchema);
export type DescriptionImages = z.infer<typeof descriptionImagesSchema>;

export const requestDescriptionImageUploadRequestSchema = z
  .object({
    boardId: safeIdSchema,
    itemId: safeIdSchema,
    fileName: z.string().min(1).max(255),
    contentType: z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
    size: z.number().int().positive(),
  })
  .strict();
export type RequestDescriptionImageUploadRequest = z.infer<
  typeof requestDescriptionImageUploadRequestSchema
>;

export const requestDescriptionImageUploadResultSchema = z
  .object({
    uploadUrl: z.string().url(),
    fileId: safeIdSchema,
    expiresAt: z.number().int().positive(),
    headers: z.record(z.string(), z.string()),
  })
  .strict();
export type RequestDescriptionImageUploadResult = z.infer<
  typeof requestDescriptionImageUploadResultSchema
>;

export const finalizeDescriptionImageRequestSchema = z
  .object({
    boardId: safeIdSchema,
    itemId: safeIdSchema,
    fileId: safeIdSchema,
    fileName: z.string().min(1).max(255),
  })
  .strict();
export type FinalizeDescriptionImageRequest = z.infer<typeof finalizeDescriptionImageRequestSchema>;

export const finalizeDescriptionImageResultSchema = z
  .object({ fileId: safeIdSchema, image: descriptionImageSchema })
  .strict();
export type FinalizeDescriptionImageResult = z.infer<typeof finalizeDescriptionImageResultSchema>;

export const getDescriptionImageUrlRequestSchema = z
  .object({ boardId: safeIdSchema, itemId: safeIdSchema, fileId: safeIdSchema })
  .strict();
export type GetDescriptionImageUrlRequest = z.infer<typeof getDescriptionImageUrlRequestSchema>;

export const getDescriptionImageUrlResultSchema = z
  .object({ url: z.string().url(), expiresAt: z.number().int().positive() })
  .strict();
export type GetDescriptionImageUrlResult = z.infer<typeof getDescriptionImageUrlResultSchema>;
