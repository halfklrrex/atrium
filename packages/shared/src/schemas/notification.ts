import { z } from 'zod';
import { idSchema, timestampSchema, uidSchema, type WriteDoc } from './common';

/** Limits shared by the schemas, the rules and the Functions (P4 notifications). */
export const NOTIFICATION_LIMITS = {
  /** Most `mentions` ids on one update or reply. */
  mentions: 20,
  /** Characters of the update or reply text kept on a notification. */
  snippet: 200,
  /** Notifications older than this are deleted by the daily sweep. */
  retentionDays: 180,
  /** Page size of the bell panel list. */
  pageSize: 50,
} as const;

export const notificationKindSchema = z.enum(['assigned', 'reply', 'mention']);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/**
 * `users/{uid}/notifications/{id}`. Written only by Cloud Functions; the recipient may set `readAt`
 * or delete. The id is `${kind}-${eventId}-${uid}`, so a retried trigger overwrites nothing.
 * Display fields are denormalised at write time and never rewritten.
 */
export const notificationSchema = z.object({
  kind: notificationKindSchema,
  actorId: uidSchema,
  actorName: z.string().max(200),
  actorPhotoURL: z.string().max(2048).nullable(),
  workspaceId: idSchema,
  boardId: idSchema,
  boardName: z.string().max(200),
  itemId: idSchema,
  itemName: z.string().max(500),
  /** Reply and mention: the update (thread) to open. */
  updateId: idSchema.nullable(),
  /** Set when the event is a reply. */
  replyId: idSchema.nullable(),
  /** Assigned: the People column. */
  columnId: idSchema.nullable(),
  /** First characters of the update or reply; '' for assigned. */
  snippet: z.string().max(NOTIFICATION_LIMITS.snippet),
  createdAt: timestampSchema,
  readAt: timestampSchema.nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationWrite = WriteDoc<Notification>;

/** `users/{uid}.notificationPrefs`: which kinds notify. Missing means all on. */
export const notificationPrefsSchema = z
  .object({
    assigned: z.boolean().default(true),
    reply: z.boolean().default(true),
    mention: z.boolean().default(true),
  })
  .strict();
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

/** `mentions` on an update or reply: unique uids, at most `NOTIFICATION_LIMITS.mentions`. */
export const mentionsSchema = z
  .array(uidSchema)
  .max(NOTIFICATION_LIMITS.mentions)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Mentions must be unique' });
