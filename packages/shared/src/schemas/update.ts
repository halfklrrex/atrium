import { z } from 'zod';
import { mentionsSchema } from './notification';
import { idSchema, timestampSchema, uidSchema, type WriteDoc } from './common';

/** Largest `contentDoc` (JSON length) an update or reply may carry (spec P1d). */
export const UPDATE_CONTENT_DOC_MAX_BYTES = 100_000;

/**
 * Rich-text body of an update or reply (spec P1d): a ProseMirror JSON document. `content` stays
 * the plain-text mirror derived from it. The node tree is passed through; the renderer only walks
 * known nodes, so nothing here is HTML.
 */
export const updateContentDocSchema = z.looseObject({
  type: z.literal('doc'),
  content: z.array(z.unknown()).max(500).optional(),
});
export type UpdateContentDoc = z.infer<typeof updateContentDocSchema>;

/** Size limit on `contentDoc`, and a non-empty plain-text mirror whenever it is set. */
function refineContentDoc(
  value: { content: string; contentDoc?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (value.contentDoc === undefined) return;
  if (JSON.stringify(value.contentDoc).length > UPDATE_CONTENT_DOC_MAX_BYTES) {
    ctx.addIssue({
      code: 'custom',
      path: ['contentDoc'],
      message: `contentDoc is larger than ${UPDATE_CONTENT_DOC_MAX_BYTES} characters`,
    });
  }
  if (value.content.trim() === '') {
    ctx.addIssue({
      code: 'custom',
      path: ['content'],
      message: 'content (the plain-text mirror) must not be empty when contentDoc is set',
    });
  }
}

/**
 * `boards/{boardId}/items/{itemId}/updates/{updateId}` (spec P1c).
 * An update post in the item card feed.
 */
export const itemUpdateSchema = z
  .object({
    itemId: idSchema,
    authorId: uidSchema,
    authorName: z.string().max(200).optional(),
    authorPhotoUrl: z.string().max(2048).nullable().optional(),
    content: z.string().min(1).max(50000),
    /** Rich-text document (spec P1d); `content` is its plain-text mirror. Absent on plain posts. */
    contentDoc: updateContentDocSchema.optional(),
    /** Uids mentioned with the @ picker (P4 notifications); set on create, never edited. */
    mentions: mentionsSchema.optional(),
    likes: z.array(uidSchema),
    repliesCount: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine(refineContentDoc);
export type ItemUpdate = z.infer<typeof itemUpdateSchema>;
export type ItemUpdateWrite = WriteDoc<ItemUpdate>;

/**
 * `boards/{boardId}/items/{itemId}/updates/{updateId}/replies/{replyId}`.
 * A reply in a thread under an update.
 */
export const updateReplySchema = z
  .object({
    updateId: idSchema,
    authorId: uidSchema,
    authorName: z.string().max(200).optional(),
    authorPhotoUrl: z.string().max(2048).nullable().optional(),
    content: z.string().min(1).max(50000),
    /** Rich-text document (spec P1d); `content` is its plain-text mirror. Absent on plain posts. */
    contentDoc: updateContentDocSchema.optional(),
    /** Uids mentioned with the @ picker (P4 notifications); set on create, never edited. */
    mentions: mentionsSchema.optional(),
    likes: z.array(uidSchema),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine(refineContentDoc);
export type UpdateReply = z.infer<typeof updateReplySchema>;
export type UpdateReplyWrite = WriteDoc<UpdateReply>;

/** Form input for creating or updating an update post. */
export const createItemUpdateInputSchema = z
  .object({
    content: z.string().trim().min(1).max(50000),
    contentDoc: updateContentDocSchema.optional(),
    mentions: mentionsSchema.optional(),
  })
  .superRefine(refineContentDoc);
export type CreateItemUpdateInput = z.infer<typeof createItemUpdateInputSchema>;

/** Form input for creating a reply to an update post. */
export const createUpdateReplyInputSchema = z
  .object({
    content: z.string().trim().min(1).max(50000),
    contentDoc: updateContentDocSchema.optional(),
    mentions: mentionsSchema.optional(),
  })
  .superRefine(refineContentDoc);
export type CreateUpdateReplyInput = z.infer<typeof createUpdateReplyInputSchema>;
