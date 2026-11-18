import { z } from 'zod';
import { ACTIVITY_KINDS } from './schemas/activity';
import { idSchema, timestampSchema } from './schemas/common';

/**
 * Outgoing webhooks (P8 PR 6, docs/specs/P8-public-api-and-webhooks.md section 5.1): the limits, the
 * callable request and result shapes, and the documents. `boards/{boardId}/webhooks/{id}` is readable
 * by board owners and written only by Cloud Functions. The signing secret lives in
 * `boards/{boardId}/webhookSecrets/{id}` and the queue in `webhookDeliveries/{id}`: both Functions-only.
 */

export const WEBHOOK_NAME_MAX = 60;
export const WEBHOOK_URL_MAX = 2048;
/** Webhooks one board may have. */
export const WEBHOOK_MAX_PER_BOARD = 5;
/** Consecutive failed attempts after which a webhook is switched off. */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 20;
/** Total delivery attempts (the first plus four retries), then the delivery is `dead`. */
export const WEBHOOK_MAX_ATTEMPTS = 5;
/** Wait before attempt 2, 3, 4 and 5 (1 minute, 5 minutes, 30 minutes, 3 hours). */
export const WEBHOOK_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 10_800_000] as const;
/** Delivery documents expire this many days after they were queued (Firestore TTL on `expiresAt`). */
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 14;
/** The largest event body, in bytes. */
export const WEBHOOK_PAYLOAD_MAX_BYTES = 64 * 1024;
/** Characters of the receiver's response kept on a delivery. */
export const WEBHOOK_RESPONSE_MAX_CHARS = 500;
/** Characters of an item name or text value kept in a payload. */
export const WEBHOOK_TEXT_MAX = 200;
/** Every signing secret starts with this, followed by 32 random bytes in base64url. */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';
/** The signature scheme of the `Atrium-Signature` header. */
export const WEBHOOK_SIGNATURE_VERSION = 'v1';
export const WEBHOOK_USER_AGENT = 'Atrium-Webhooks/1';

/** Callable names, shared so the web wrappers and the functions cannot drift. */
export const CREATE_WEBHOOK_CALLABLE = 'createWebhook';
export const UPDATE_WEBHOOK_CALLABLE = 'updateWebhook';
export const DELETE_WEBHOOK_CALLABLE = 'deleteWebhook';
export const ROTATE_WEBHOOK_SECRET_CALLABLE = 'rotateWebhookSecret';
export const TEST_WEBHOOK_CALLABLE = 'testWebhook';

/** An event a webhook can subscribe to: an activity kind, or `*` for all of them. */
export const WEBHOOK_EVENT_ALL = '*';
/** The event the Test button sends; it is not an activity kind and cannot be subscribed to. */
export const WEBHOOK_PING_EVENT = 'ping';

export const webhookEventSchema = z.union([z.literal(WEBHOOK_EVENT_ALL), z.enum(ACTIVITY_KINDS)]);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const webhookEventsSchema = z
  .array(webhookEventSchema)
  .min(1)
  .max(ACTIVITY_KINDS.length + 1)
  .refine((events) => new Set(events).size === events.length, 'Events must be unique.')
  .refine(
    (events) => !events.includes(WEBHOOK_EVENT_ALL) || events.length === 1,
    'Use "*" on its own, or a list of event kinds.',
  );

/** HTTPS only, at most 2048 characters. The SSRF guard checks the host on save and at delivery. */
export const webhookUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(WEBHOOK_URL_MAX)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Use a full https:// address.');

export const webhookNameSchema = z.string().trim().min(1).max(WEBHOOK_NAME_MAX);

export const createWebhookRequestSchema = z
  .object({
    boardId: idSchema,
    name: webhookNameSchema,
    url: webhookUrlSchema,
    events: webhookEventsSchema,
  })
  .strict();
export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>;

export const webhookSecretSchema = z.string().startsWith(WEBHOOK_SECRET_PREFIX).max(128);

export const createWebhookResultSchema = z.object({
  webhookId: idSchema,
  /** The signing secret. Shown once; read it back only by rotating. */
  secret: webhookSecretSchema,
});
export type CreateWebhookResult = z.infer<typeof createWebhookResultSchema>;

export const updateWebhookRequestSchema = z
  .object({
    boardId: idSchema,
    webhookId: idSchema,
    name: webhookNameSchema.optional(),
    url: webhookUrlSchema.optional(),
    events: webhookEventsSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.url !== undefined ||
      v.events !== undefined ||
      v.enabled !== undefined,
    'Nothing to change.',
  );
export type UpdateWebhookRequest = z.infer<typeof updateWebhookRequestSchema>;

export const updateWebhookResultSchema = z.object({
  webhookId: idSchema,
  enabled: z.boolean(),
});
export type UpdateWebhookResult = z.infer<typeof updateWebhookResultSchema>;

export const deleteWebhookRequestSchema = z
  .object({ boardId: idSchema, webhookId: idSchema })
  .strict();
export type DeleteWebhookRequest = z.infer<typeof deleteWebhookRequestSchema>;

export const deleteWebhookResultSchema = z.object({ webhookId: idSchema, deleted: z.boolean() });
export type DeleteWebhookResult = z.infer<typeof deleteWebhookResultSchema>;

export const rotateWebhookSecretRequestSchema = deleteWebhookRequestSchema;
export type RotateWebhookSecretRequest = DeleteWebhookRequest;

export const rotateWebhookSecretResultSchema = z.object({
  webhookId: idSchema,
  secret: webhookSecretSchema,
});
export type RotateWebhookSecretResult = z.infer<typeof rotateWebhookSecretResultSchema>;

export const testWebhookRequestSchema = deleteWebhookRequestSchema;
export type TestWebhookRequest = DeleteWebhookRequest;

export const testWebhookResultSchema = z.object({
  webhookId: idSchema,
  /** The queued `ping` delivery; the next minute's sweep sends it. */
  deliveryId: idSchema,
});
export type TestWebhookResult = z.infer<typeof testWebhookResultSchema>;

/** `boards/{boardId}/webhooks/{id}`. Board owners read it; only Cloud Functions write it. No secret. */
export const webhookSchema = z.object({
  name: z.string().max(WEBHOOK_NAME_MAX),
  url: z.string().max(WEBHOOK_URL_MAX),
  events: z.array(z.string().max(40)).max(ACTIVITY_KINDS.length + 1),
  enabled: z.boolean(),
  createdBy: z.string().min(1).max(128),
  createdAt: timestampSchema,
  consecutiveFailures: z.number().int().min(0),
  disabledReason: z.string().max(200).nullable(),
  lastDeliveryAt: timestampSchema.nullable(),
});
export type Webhook = z.infer<typeof webhookSchema>;

/** The body of one event, as POSTed (spec 5.1). No email addresses. */
export const webhookEventPayloadSchema = z.object({
  id: z.string().min(1).max(256),
  type: z.string().min(1).max(40),
  createdAt: z.string().max(40),
  boardId: idSchema,
  itemId: idSchema.nullable(),
  itemName: z.string().max(WEBHOOK_TEXT_MAX).nullable(),
  columnId: idSchema.nullable(),
  actor: z.object({ id: z.string().max(128), name: z.string().max(WEBHOOK_TEXT_MAX) }),
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEventPayload = z.infer<typeof webhookEventPayloadSchema>;

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'dead'] as const;
export const webhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUSES);
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;

/** `webhookDeliveries/{webhookId}_{eventId}`: the queue. Functions-only; TTL on `expiresAt`. */
export const webhookDeliverySchema = z.object({
  boardId: idSchema,
  webhookId: idSchema,
  eventId: z.string().min(1).max(256),
  eventType: z.string().min(1).max(40),
  /** The JSON body, kept as text so the signature covers exactly what is sent. */
  payload: z.string(),
  /** Attempts made so far. */
  attempt: z.number().int().min(0).max(WEBHOOK_MAX_ATTEMPTS),
  nextAttemptAt: timestampSchema,
  status: webhookDeliveryStatusSchema,
  lastStatus: z.number().int().nullable(),
  lastError: z.string().max(WEBHOOK_RESPONSE_MAX_CHARS).nullable(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
