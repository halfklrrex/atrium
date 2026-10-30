import { z } from 'zod';
import { mentionsSchema } from './notification';
import { idSchema, timestampSchema, uidSchema, type WriteDoc } from './common';

/**
 * `boards/{boardId}/items/{itemId}/updates/{updateId}` (spec P1c).
 * An update post in the item card feed.
 */
export const itemUpdateSchema = z.object({
  itemId: idSchema,
  authorId: uidSchema,
  authorName: z.string().max(200).optional(),
  authorPhotoUrl: z.string().max(2048).nullable().optional(),
  content: z.string().min(1).max(50000),
  /** Uids mentioned with the @ picker (P4 notifications); set on create, never edited. */
  mentions: mentionsSchema.optional(),
  likes: z.array(uidSchema),
  repliesCount: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ItemUpdate = z.infer<typeof itemUpdateSchema>;
export type ItemUpdateWrite = WriteDoc<ItemUpdate>;

/**
 * `boards/{boardId}/items/{itemId}/updates/{updateId}/replies/{replyId}`.
 * A reply in a thread under an update.
 */
export const updateReplySchema = z.object({
  updateId: idSchema,
  authorId: uidSchema,
  authorName: z.string().max(200).optional(),
  authorPhotoUrl: z.string().max(2048).nullable().optional(),
  content: z.string().min(1).max(50000),
  /** Uids mentioned with the @ picker (P4 notifications); set on create, never edited. */
  mentions: mentionsSchema.optional(),
  likes: z.array(uidSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type UpdateReply = z.infer<typeof updateReplySchema>;
export type UpdateReplyWrite = WriteDoc<UpdateReply>;

/** Form input for creating or updating an update post. */
export const createItemUpdateInputSchema = z.object({
  content: z.string().trim().min(1).max(50000),
  mentions: mentionsSchema.optional(),
});
export type CreateItemUpdateInput = z.infer<typeof createItemUpdateInputSchema>;

/** Form input for creating a reply to an update post. */
export const createUpdateReplyInputSchema = z.object({
  content: z.string().trim().min(1).max(50000),
  mentions: mentionsSchema.optional(),
});
export type CreateUpdateReplyInput = z.infer<typeof createUpdateReplyInputSchema>;
