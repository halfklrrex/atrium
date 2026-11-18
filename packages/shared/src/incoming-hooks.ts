import { z } from 'zod';
import { idSchema, timestampSchema } from './schemas/common';
import { WEBHOOK_DELIVERY_STATUSES, WEBHOOK_NAME_MAX, webhookNameSchema } from './webhooks';

/**
 * Incoming webhooks (P8 PR 7a, docs/specs/P8-public-api-and-webhooks.md section 5.2): a secret URL
 * that creates one item on a board. `boards/{boardId}/incomingHooks/{id}` is readable by board owners
 * and written only by Cloud Functions; `incomingHookIndex/{sha256hex}` (hash of the whole token ->
 * board and hook) is Functions-only. The URL carries the secret; only its hash is stored.
 */

/** Incoming hooks one board may have. */
export const INCOMING_HOOK_MAX_PER_BOARD = 5;
/** Calls per minute and per day, per hook. */
export const INCOMING_HOOK_CALLS_PER_MINUTE = 60;
export const INCOMING_HOOK_DAILY_CALLS = 1000;
/** The largest request body the receiving route reads. */
export const INCOMING_HOOK_BODY_MAX_BYTES = 64 * 1024;
/** Where a hook's URL lives; the token (`{hookId}.{secret}`) follows. */
export const INCOMING_HOOK_BASE_URL = 'https://atrium-workboards.web.app/api/hooks/';
/** The token is `{hookId}.{secret}`; the secret is 32 random bytes in base64url (43 characters). */
export const INCOMING_HOOK_SECRET_LENGTH = 43;

/** Callable names, shared so the web wrappers and the functions cannot drift. */
export const CREATE_INCOMING_HOOK_CALLABLE = 'createIncomingHook';
export const UPDATE_INCOMING_HOOK_CALLABLE = 'updateIncomingHook';
export const ROTATE_INCOMING_HOOK_SECRET_CALLABLE = 'rotateIncomingHookSecret';
export const DELETE_INCOMING_HOOK_CALLABLE = 'deleteIncomingHook';
export const LIST_WEBHOOK_DELIVERIES_CALLABLE = 'listWebhookDeliveries';

/** Delivery log: how many rows a call returns. */
export const WEBHOOK_DELIVERY_LIST_DEFAULT = 20;
export const WEBHOOK_DELIVERY_LIST_MAX = 50;
/** Characters of `lastError` a delivery row shows. */
export const WEBHOOK_DELIVERY_ERROR_MAX = 200;

export const incomingHookNameSchema = webhookNameSchema;

/** `boards/{boardId}/incomingHooks/{id}`. Board owners read it; only Cloud Functions write it. No secret, no hash. */
export const incomingHookSchema = z.object({
  name: z.string().max(WEBHOOK_NAME_MAX),
  enabled: z.boolean(),
  createdBy: z.string().min(1).max(128),
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
  /** The group new items go to when the call names none; the board's first group when absent. */
  defaultGroupId: idSchema.nullable().optional(),
});
export type IncomingHook = z.infer<typeof incomingHookSchema>;

/** `incomingHookIndex/{sha256hex}`: how the route finds a hook from the presented token. Functions-only. */
export const incomingHookIndexSchema = z.object({
  boardId: idSchema,
  hookId: idSchema,
  createdAt: timestampSchema,
});
export type IncomingHookIndex = z.infer<typeof incomingHookIndexSchema>;

export const createIncomingHookRequestSchema = z
  .object({
    boardId: idSchema,
    name: incomingHookNameSchema,
    defaultGroupId: idSchema.optional(),
  })
  .strict();
export type CreateIncomingHookRequest = z.infer<typeof createIncomingHookRequestSchema>;

/** The full secret URL. Shown once (at creation and after a rotation); only its hash is kept. */
export const incomingHookUrlSchema = z
  .string()
  .startsWith(INCOMING_HOOK_BASE_URL)
  .max(INCOMING_HOOK_BASE_URL.length + 128);

export const createIncomingHookResultSchema = z.object({
  hookId: idSchema,
  url: incomingHookUrlSchema,
});
export type CreateIncomingHookResult = z.infer<typeof createIncomingHookResultSchema>;

export const updateIncomingHookRequestSchema = z
  .object({
    boardId: idSchema,
    hookId: idSchema,
    name: incomingHookNameSchema.optional(),
    enabled: z.boolean().optional(),
    /** `null` clears it (back to the board's first group). */
    defaultGroupId: idSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) => v.name !== undefined || v.enabled !== undefined || v.defaultGroupId !== undefined,
    'Nothing to change.',
  );
export type UpdateIncomingHookRequest = z.infer<typeof updateIncomingHookRequestSchema>;

export const updateIncomingHookResultSchema = z.object({
  hookId: idSchema,
  enabled: z.boolean(),
});
export type UpdateIncomingHookResult = z.infer<typeof updateIncomingHookResultSchema>;

export const rotateIncomingHookSecretRequestSchema = z
  .object({ boardId: idSchema, hookId: idSchema })
  .strict();
export type RotateIncomingHookSecretRequest = z.infer<typeof rotateIncomingHookSecretRequestSchema>;

export const rotateIncomingHookSecretResultSchema = createIncomingHookResultSchema;
export type RotateIncomingHookSecretResult = CreateIncomingHookResult;

export const deleteIncomingHookRequestSchema = rotateIncomingHookSecretRequestSchema;
export type DeleteIncomingHookRequest = RotateIncomingHookSecretRequest;

export const deleteIncomingHookResultSchema = z.object({ hookId: idSchema, deleted: z.boolean() });
export type DeleteIncomingHookResult = z.infer<typeof deleteIncomingHookResultSchema>;

/**
 * The body of `POST /api/hooks/{token}`. `values` is keyed by column id or title (as the API and the
 * MCP tools take it); `group` is a group id or title. Unknown keys are refused.
 */
export const incomingHookBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    values: z.record(z.string(), z.unknown()).optional(),
    group: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type IncomingHookBody = z.infer<typeof incomingHookBodySchema>;

/** The answer to a good call. */
export const incomingHookResponseSchema = z.object({ id: idSchema, boardId: idSchema });
export type IncomingHookResponse = z.infer<typeof incomingHookResponseSchema>;

// ---- delivery log (outgoing webhooks, board owners) -------------------------------------------------

export const listWebhookDeliveriesRequestSchema = z
  .object({
    boardId: idSchema,
    webhookId: idSchema,
    limit: z.number().int().min(1).max(WEBHOOK_DELIVERY_LIST_MAX).optional(),
  })
  .strict();
export type ListWebhookDeliveriesRequest = z.infer<typeof listWebhookDeliveriesRequestSchema>;

/** One row of the log. Never the payload, the secret or the receiver's response body. */
export const webhookDeliveryRowSchema = z.object({
  id: z.string().min(1).max(300),
  eventType: z.string().max(40),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES),
  attempt: z.number().int().min(0),
  lastStatus: z.number().int().nullable(),
  lastError: z.string().max(WEBHOOK_DELIVERY_ERROR_MAX).nullable(),
  /** Epoch milliseconds. */
  createdAt: z.number(),
  nextAttemptAt: z.number(),
});
export type WebhookDeliveryRow = z.infer<typeof webhookDeliveryRowSchema>;

export const listWebhookDeliveriesResultSchema = z.object({
  deliveries: z.array(webhookDeliveryRowSchema).max(WEBHOOK_DELIVERY_LIST_MAX),
});
export type ListWebhookDeliveriesResult = z.infer<typeof listWebhookDeliveriesResultSchema>;
