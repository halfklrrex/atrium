import { z } from 'zod';
import { entityStateSchema } from '../roles';
import { idSchema, positionSchema, timestampSchema, uidSchema, type WriteDoc } from './common';
import { slugIdSchema } from './board';
import { descriptionImagesSchema } from './description-images';

/**
 * Per-column cell values keyed by column id. Each value uses the monday-compatible JSON shape of its
 * column type and is validated against the column registry (`columnRegistry.parseValue`).
 */
export const itemValuesSchema = z.record(slugIdSchema, z.unknown());
export type ItemValues = z.infer<typeof itemValuesSchema>;

/** Rich-text description (P1 full item view): ProseMirror JSON plus its plain text, for search. */
export const ITEM_DESCRIPTION_TEXT_MAX = 10_000;
/** Client-side cap of the serialised `doc` (about 200 KB). */
export const ITEM_DESCRIPTION_DOC_MAX_BYTES = 200_000;
export const itemDescriptionSchema = z.object({
  doc: z.record(z.string(), z.unknown()),
  text: z.string().max(ITEM_DESCRIPTION_TEXT_MAX),
});
export type ItemDescription = z.infer<typeof itemDescriptionSchema>;

/** `boards/{boardId}/items/{itemId}` (architecture §5.5). A non-null `parentItemId` marks a subitem. */
export const itemSchema = z.object({
  name: z.string().min(1).max(500),
  groupId: slugIdSchema,
  position: positionSchema,
  parentItemId: idSchema.nullable(),
  values: itemValuesSchema,
  state: entityStateSchema,
  deletedAt: timestampSchema.nullable(),
  /** How many updates the item has (the row bubble); client-maintained, absent on older items. */
  updatesCount: z.number().int().min(0).optional(),
  /** Account-wide item number; server-assigned by `onItemCreated`, never client-written. */
  seq: z.number().int().min(1).optional(),
  /** Per-board creation number (subitems have their own sequence); server-assigned. */
  boardSeq: z.number().int().min(1).optional(),
  /** Uids assigned in a People column; server-maintained index (`onItemPeopleAssigned`), never client-written. */
  assigneeUids: z.array(uidSchema).optional(),
  /** Search tokens of `name`; server-maintained index, never client-written. */
  nameTokens: z.array(z.string()).optional(),
  /** Rich-text description; absent or `null` when empty. */
  description: itemDescriptionSchema.nullable().optional(),
  /** Description images by fileId; Functions-only (finalizeDescriptionImage), never client-written. */
  descriptionImages: descriptionImagesSchema.optional(),
  createdAt: timestampSchema,
  createdBy: uidSchema,
  updatedAt: timestampSchema,
  updatedBy: uidSchema,
});
export type Item = z.infer<typeof itemSchema>;
/** Client item writes never carry the server-assigned numbers (rules refuse them). */
export type ItemWrite = Omit<WriteDoc<Item>, 'seq' | 'boardSeq' | 'descriptionImages' | 'assigneeUids' | 'nameTokens'>;
