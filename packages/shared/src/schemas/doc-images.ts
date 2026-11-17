import { z } from 'zod';
import { safeIdSchema } from './files-upload';
import {
  DESCRIPTION_IMAGE_MAX_BYTES,
  DESCRIPTION_IMAGE_TYPES,
  descriptionImageSchema,
  isDescriptionImageType,
} from './description-images';
import { DOC_LIMITS } from './doc';

/**
 * Doc images (P7 docs, PR 5): the same callables as description images, scoped to a doc. Storage
 * objects live at `docs/{docId}/images/{fileId}` and are listed in the Functions-only
 * `docs/{docId}/content/images` map (keyed by fileId). The doc body stores just the fileId.
 */

export const DOC_IMAGE_MAX_BYTES = DESCRIPTION_IMAGE_MAX_BYTES;
export const DOC_IMAGE_MAX_PER_DOC = DOC_LIMITS.images;
export const DOC_IMAGE_TYPES = DESCRIPTION_IMAGE_TYPES;
export const isDocImageType = isDescriptionImageType;

export const REQUEST_DOC_IMAGE_UPLOAD_CALLABLE = 'requestDocImageUpload';
export const FINALIZE_DOC_IMAGE_CALLABLE = 'finalizeDocImage';
export const GET_DOC_IMAGE_URL_CALLABLE = 'getDocImageUrl';

/** One entry of `docs/{d}/content/images`, keyed by fileId. */
export const docImageSchema = descriptionImageSchema;
export type DocImage = z.infer<typeof docImageSchema>;

export const docImagesSchema = z.record(safeIdSchema, docImageSchema);
export type DocImages = z.infer<typeof docImagesSchema>;

export const requestDocImageUploadRequestSchema = z
  .object({
    docId: safeIdSchema,
    fileName: z.string().min(1).max(255),
    contentType: z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
    size: z.number().int().positive(),
  })
  .strict();
export type RequestDocImageUploadRequest = z.infer<typeof requestDocImageUploadRequestSchema>;

export const requestDocImageUploadResultSchema = z
  .object({
    uploadUrl: z.string().url(),
    fileId: safeIdSchema,
    expiresAt: z.number().int().positive(),
    headers: z.record(z.string(), z.string()),
  })
  .strict();
export type RequestDocImageUploadResult = z.infer<typeof requestDocImageUploadResultSchema>;

export const finalizeDocImageRequestSchema = z
  .object({
    docId: safeIdSchema,
    fileId: safeIdSchema,
    fileName: z.string().min(1).max(255),
  })
  .strict();
export type FinalizeDocImageRequest = z.infer<typeof finalizeDocImageRequestSchema>;

export const finalizeDocImageResultSchema = z
  .object({ fileId: safeIdSchema, image: docImageSchema })
  .strict();
export type FinalizeDocImageResult = z.infer<typeof finalizeDocImageResultSchema>;

export const getDocImageUrlRequestSchema = z
  .object({ docId: safeIdSchema, fileId: safeIdSchema })
  .strict();
export type GetDocImageUrlRequest = z.infer<typeof getDocImageUrlRequestSchema>;

export const getDocImageUrlResultSchema = z
  .object({ url: z.string().url(), expiresAt: z.number().int().positive() })
  .strict();
export type GetDocImageUrlResult = z.infer<typeof getDocImageUrlResultSchema>;
