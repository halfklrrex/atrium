import { z } from 'zod';
import { boardKindSchema, boardRoleSchema } from '../roles';
import { idSchema, timestampSchema, uidSchema, type WriteDoc } from './common';

/** Limits shared by the schemas, the Functions and the web (P4 activity log). */
export const ACTIVITY_LIMITS = {
  /** Entries expire this many days after they were written (Firestore TTL on `expiresAt`). */
  retentionDays: 90,
  /** Characters kept of a display text (`fromText`, `toText`, names, titles). */
  text: 200,
  /** A raw value (`fromValue`, `toValue`) is stored only when its JSON is at most this many bytes. */
  rawBytes: 2048,
  /** One write produces at most this many entries; the rest are summarised in one with `data.more`. */
  perEvent: 20,
  /** Characters of an update kept as `data.snippet`. */
  snippet: 120,
  /** Page size of the activity lists. */
  pageSize: 50,
} as const;

export const ACTIVITY_KINDS = [
  'item_created',
  'item_renamed',
  'item_moved',
  'item_archived',
  'item_deleted',
  'item_restored',
  'value_changed',
  'column_added',
  'column_renamed',
  'column_deleted',
  'column_type_changed',
  'column_type_reverted',
  'group_added',
  'group_renamed',
  'group_deleted',
  'board_renamed',
  'board_kind_changed',
  'board_access_changed',
  'board_left',
  'update_posted',
  'button_clicked',
] as const;
export const activityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof activityKindSchema>;

const text = z.string().max(ACTIVITY_LIMITS.text);

/** Kind-specific details. Everything is optional; the web reads what its kind needs. */
export const activityDataSchema = z.object({
  /** Display text of the old and new value (people as member names, capped). */
  fromText: text.optional(),
  toText: text.optional(),
  /** The raw stored value, only when its JSON fits `ACTIVITY_LIMITS.rawBytes`. */
  fromValue: z.unknown().optional(),
  toValue: z.unknown().optional(),
  /** `board_access_changed`: the person and their role before and after (`null` is no access). */
  fromRole: boardRoleSchema.nullable().optional(),
  toRole: boardRoleSchema.nullable().optional(),
  targetUid: uidSchema.optional(),
  targetName: text.optional(),
  /** `board_kind_changed`. */
  fromKind: boardKindSchema.optional(),
  toKind: boardKindSchema.optional(),
  /** `update_posted`: first characters of the update. */
  snippet: z.string().max(ACTIVITY_LIMITS.snippet).optional(),
  /** `value_changed` summary entry: how many further changes were left out. */
  more: z.number().int().min(1).optional(),
  /** `item_moved`: the group the item came from. */
  fromGroupId: idSchema.optional(),
  fromGroupTitle: text.optional(),
  /** `button_clicked`. */
  columnColor: z.string().max(40).optional(),
});
export type ActivityData = z.infer<typeof activityDataSchema>;

/**
 * `boards/{boardId}/activity/{eventId}`. Written only by Cloud Functions, read by board readers.
 * Display fields (names, titles) are denormalised at write time so the log reads correctly after
 * renames and deletions. `expiresAt` is `createdAt` plus the retention (Firestore TTL).
 */
export const activityEventSchema = z.object({
  kind: activityKindSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  actorId: z.string().min(1).max(128),
  actorName: text,
  actorPhotoUrl: z.string().max(2048).nullable(),
  itemId: idSchema.nullable(),
  itemName: z.string().max(500).nullable(),
  parentItemId: idSchema.nullable(),
  columnId: idSchema.nullable(),
  columnTitle: text.nullable(),
  columnType: z.string().max(40).nullable(),
  groupId: idSchema.nullable(),
  groupTitle: text.nullable(),
  data: activityDataSchema,
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivityWrite = WriteDoc<ActivityEvent>;
