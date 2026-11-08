import { z } from 'zod';
import { timestampSchema, uidSchema, type WriteDoc } from './common';

/**
 * Appeals and feedback Inbox (ADMIN-4, docs/specs/ADMIN-4-appeals-inbox.md). One shared constant for
 * the schemas, the Functions, the web counters and (as literals with a pointer comment) the rules.
 */
export const INBOX_LIMITS = {
  subject: 120,
  text: 2000,
  snippet: 200,
  note: 2000,
  feedbackThreadsPerDay: 5,
  openFeedbackThreads: 3,
  messagesPerDayApproved: 30,
  messagesPerDayBlocked: 10,
  messagesPerThread: 200,
  appealWaitDays: 7,
  retentionDays: 365,
  pageSize: 20,
} as const;

export const inboxKindSchema = z.enum(['appeal', 'feedback']);
export type InboxKind = z.infer<typeof inboxKindSchema>;

export const inboxCategorySchema = z.enum(['bug', 'idea', 'question', 'other']);
export type InboxCategory = z.infer<typeof inboxCategorySchema>;

/** `open`: waiting for an admin. `answered`: an admin replied last. `closed`: locked. */
export const inboxStatusSchema = z.enum(['open', 'answered', 'closed']);
export type InboxStatus = z.infer<typeof inboxStatusSchema>;

/** Appeals only, set when closed. */
export const inboxOutcomeSchema = z.enum(['unblocked', 'upheld']);
export type InboxOutcome = z.infer<typeof inboxOutcomeSchema>;

export const inboxAuthorRoleSchema = z.enum(['sender', 'admin']);
export type InboxAuthorRole = z.infer<typeof inboxAuthorRoleSchema>;

/** The fixed label the sender sees for every admin message (T6): no name, photo or uid is stored. */
export const INBOX_ADMIN_LABEL = 'Site Administrator';

/**
 * `inbox/{threadId}`: one thread. Readable by the sender, so it holds nothing admin-only (T4, T6):
 * the admin who closed it is in `inboxAudit`, the internal note in `inboxNotes`.
 */
export const inboxThreadSchema = z.object({
  kind: inboxKindSchema,
  /** Feedback only; `null` for appeals. */
  category: inboxCategorySchema.nullable(),
  subject: z.string().min(1).max(INBOX_LIMITS.subject),
  senderUid: uidSchema,
  senderName: z.string().max(200),
  senderEmail: z.string().max(320).nullable(),
  senderPhotoURL: z.string().max(2048).nullable(),
  status: inboxStatusSchema,
  /** Appeals only, set when closed. */
  outcome: inboxOutcomeSchema.nullable(),
  messageCount: z.number().int().min(0).max(INBOX_LIMITS.messagesPerThread),
  lastMessageAt: timestampSchema,
  lastMessageBy: inboxAuthorRoleSchema,
  lastSnippet: z.string().max(INBOX_LIMITS.snippet),
  adminUnread: z.boolean(),
  senderUnread: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  closedAt: timestampSchema.nullable(),
});
export type InboxThread = z.infer<typeof inboxThreadSchema>;
export type InboxThreadWrite = WriteDoc<InboxThread>;

/**
 * `inbox/{threadId}/messages/{messageId}`. `messageId` is the request's `requestId`. Admin messages
 * store no identity (T6): `authorUid`, `authorName` and `authorPhotoURL` are `null`.
 */
export const inboxMessageSchema = z
  .object({
    seq: z.number().int().min(1),
    authorRole: inboxAuthorRoleSchema,
    authorUid: uidSchema.nullable(),
    authorName: z.string().max(200).nullable(),
    authorPhotoURL: z.string().max(2048).nullable(),
    text: z.string().min(1).max(INBOX_LIMITS.text),
    createdAt: timestampSchema,
  })
  .superRefine((m, ctx) => {
    if (m.authorRole === 'admin' && (m.authorUid || m.authorName || m.authorPhotoURL)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Admin messages must not carry an author identity',
        path: ['authorRole'],
      });
    }
  });
export type InboxMessage = z.infer<typeof inboxMessageSchema>;
export type InboxMessageWrite = WriteDoc<InboxMessage>;

/** `inboxNotes/{threadId}`: admin-only internal note. */
export const inboxNoteSchema = z.object({
  text: z.string().max(INBOX_LIMITS.note),
  updatedAt: timestampSchema,
  updatedBy: uidSchema,
});
export type InboxNote = z.infer<typeof inboxNoteSchema>;
export type InboxNoteWrite = WriteDoc<InboxNote>;

/** `inboxLimits/{uid}`: Functions-only counters; `day` is `YYYY-MM-DD` (UTC). */
export const inboxLimitsSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  threadsToday: z.number().int().min(0),
  messagesToday: z.number().int().min(0),
  appealRefusedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
});
export type InboxLimitsDoc = z.infer<typeof inboxLimitsSchema>;
export type InboxLimitsWrite = WriteDoc<InboxLimitsDoc>;

/**
 * `inboxAudit/{threadId}/entries/{messageId}`: admin-only record of who acted (T6). Written by
 * Functions; `adminUid` is `system:unblock` when an unblock closed the appeal.
 */
export const inboxAuditEntrySchema = z.object({
  adminUid: z.string().min(1).max(128),
  action: z.enum(['reply', 'close', 'reopen', 'keepBlocked', 'unblock']),
  createdAt: timestampSchema,
});
export type InboxAuditEntry = z.infer<typeof inboxAuditEntrySchema>;
export type InboxAuditEntryWrite = WriteDoc<InboxAuditEntry>;
