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

export const notificationKindSchema = z.enum([
  'assigned',
  'reply',
  'mention',
  'button',
  'automation',
  'automation_disabled',
  /** Site admins: a new account waits for approval (ADMIN-2). Always delivered, no pref switch. */
  'account_request',
  /** The person: an admin approved the account (ADMIN-2). Always delivered, no pref switch. */
  'account_approved',
  /** Site admins: a new appeal or feedback, or a sender reply (ADMIN-4). One per thread, no pref switch. */
  'inbox_new',
  /** A feedback sender: an admin replied (ADMIN-4). One per thread, no pref switch. */
  'inbox_reply',
]);
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
  /** Assigned: the People column. Button: the button column. */
  columnId: idSchema.nullable(),
  /** Button: the button's label when it was clicked. Absent on other kinds. */
  buttonLabel: z.string().max(50).nullable().optional(),
  /** Automation kinds: the recipe name. Absent on other kinds. */
  recipeName: z.string().max(80).nullable().optional(),
  /** First characters of the update or reply (button: the message); '' for assigned. */
  snippet: z.string().max(NOTIFICATION_LIMITS.snippet),
  createdAt: timestampSchema,
  readAt: timestampSchema.nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationWrite = WriteDoc<Notification>;

/**
 * `users/{uid}.notificationPrefs.push`: which kinds also push to the user's devices (PWA-2). When
 * present it holds exactly these six booleans. `account` covers `account_request` and
 * `account_approved`.
 */
export const pushPrefsSchema = z
  .object({
    assigned: z.boolean(),
    reply: z.boolean(),
    mention: z.boolean(),
    button: z.boolean(),
    automation: z.boolean(),
    account: z.boolean(),
  })
  .strict();
export type PushPrefs = z.infer<typeof pushPrefsSchema>;

/** Push defaults for a freshly enabled device (owner decision 2026-11-07): automation is noisy, off. */
export const DEFAULT_PUSH_PREFS: PushPrefs = {
  assigned: true,
  reply: true,
  mention: true,
  button: true,
  automation: false,
  account: true,
};

/** `users/{uid}.notificationPrefs`: which kinds notify. Missing means all on. */
export const notificationPrefsSchema = z
  .object({
    assigned: z.boolean().default(true),
    reply: z.boolean().default(true),
    mention: z.boolean().default(true),
    /** Added later: prefs documents written before it have no `button` key, which means on. */
    button: z.boolean().default(true),
    /** Added later, also covers `automation_disabled`; missing means on. */
    automation: z.boolean().default(true),
    /** Per-kind push switches (PWA-2). Missing means the defaults in `DEFAULT_PUSH_PREFS`. */
    push: pushPrefsSchema.optional(),
  })
  .strict();
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

/** `mentions` on an update or reply: unique uids, at most `NOTIFICATION_LIMITS.mentions`. */
export const mentionsSchema = z
  .array(uidSchema)
  .max(NOTIFICATION_LIMITS.mentions)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Mentions must be unique' });
