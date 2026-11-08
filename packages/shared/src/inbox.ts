import { z } from 'zod';
import { INBOX_LIMITS, inboxCategorySchema, inboxStatusSchema } from './schemas/inbox';

/** Callable names of the Inbox (ADMIN-4), shared so client and server cannot drift. */
export const SEND_INBOX_MESSAGE_CALLABLE = 'sendInboxMessage';
export const MANAGE_INBOX_THREAD_CALLABLE = 'manageInboxThread';

/** Reasons in `HttpsError.details.reason`, so the web shows exact messages. */
export const INBOX_ERROR_REASONS = [
  'daily-thread-limit',
  'open-thread-limit',
  'daily-message-limit',
  'thread-full',
  'appeal-open',
  'appeal-wait',
  'closed',
  'account-not-approved',
] as const;
export type InboxErrorReason = (typeof INBOX_ERROR_REASONS)[number];

/** Trim and strip control characters except newline and tab (plain text only). */
export function normalizeInboxText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- the point is to remove control characters
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .trim()
  );
}

const requestIdSchema = z.uuid();
const threadIdSchema = z.string().min(1).max(128);
const messageTextSchema = z
  .string()
  .transform(normalizeInboxText)
  .pipe(z.string().min(1).max(INBOX_LIMITS.text));
const subjectSchema = z
  .string()
  .transform(normalizeInboxText)
  .pipe(z.string().min(1).max(INBOX_LIMITS.subject));

/** `sendInboxMessage`: the sender side. The role of a message is fixed by the callable (T2). */
export const sendInboxMessageRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('feedback'),
      requestId: requestIdSchema,
      category: inboxCategorySchema,
      subject: subjectSchema,
      text: messageTextSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('appeal'),
      requestId: requestIdSchema,
      text: messageTextSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('reply'),
      requestId: requestIdSchema,
      threadId: threadIdSchema,
      text: messageTextSchema,
    })
    .strict(),
]);
export type SendInboxMessageRequest = z.infer<typeof sendInboxMessageRequestSchema>;

export const sendInboxMessageResultSchema = z
  .object({ threadId: threadIdSchema, status: inboxStatusSchema.optional() })
  .strict();
export type SendInboxMessageResult = z.infer<typeof sendInboxMessageResultSchema>;

/** `manageInboxThread`: the admin side (actions `reply`, `close`, `reopen`, `keepBlocked`, `delete`). */
export const manageInboxThreadRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('reply'),
      threadId: threadIdSchema,
      requestId: requestIdSchema,
      text: messageTextSchema,
    })
    .strict(),
  z.object({ action: z.literal('close'), threadId: threadIdSchema }).strict(),
  z.object({ action: z.literal('reopen'), threadId: threadIdSchema }).strict(),
  z
    .object({
      action: z.literal('keepBlocked'),
      threadId: threadIdSchema,
      requestId: requestIdSchema.optional(),
      text: messageTextSchema.optional(),
    })
    .strict()
    .refine((v) => (v.requestId === undefined) === (v.text === undefined), {
      message: 'requestId and text go together',
      path: ['text'],
    }),
  z.object({ action: z.literal('delete'), threadId: threadIdSchema }).strict(),
]);
export type ManageInboxThreadRequest = z.infer<typeof manageInboxThreadRequestSchema>;

export const manageInboxThreadResultSchema = z
  .object({ threadId: threadIdSchema, status: inboxStatusSchema.nullable() })
  .strict();
export type ManageInboxThreadResult = z.infer<typeof manageInboxThreadResultSchema>;
