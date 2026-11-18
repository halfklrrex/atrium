import { createHmac, randomBytes } from 'node:crypto';
import {
  WEBHOOK_SECRET_PREFIX,
  WEBHOOK_SIGNATURE_VERSION,
  WEBHOOK_USER_AGENT,
} from '@atrium/shared';

/** A fresh signing secret: `whsec_` + 32 random bytes, base64url. Never log it. */
export const newWebhookSecret = (): string =>
  `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;

/**
 * The `Atrium-Signature` value: `v1=` and the hex HMAC-SHA256 of `"<timestamp>.<body>"` keyed with the
 * secret. `timestamp` is the same text as the `Atrium-Timestamp` header (Unix seconds).
 */
export const signWebhook = (secret: string, timestamp: string, body: string): string =>
  `${WEBHOOK_SIGNATURE_VERSION}=${createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')}`;

export interface DeliveryHeadersInput {
  eventId: string;
  eventType: string;
  secret: string;
  body: string;
  /** Epoch milliseconds; the header carries whole seconds. */
  nowMs: number;
}

export function deliveryHeaders(input: DeliveryHeadersInput): Record<string, string> {
  const timestamp = String(Math.floor(input.nowMs / 1000));
  return {
    'Content-Type': 'application/json',
    'User-Agent': WEBHOOK_USER_AGENT,
    'Atrium-Event-Id': input.eventId,
    'Atrium-Event-Type': input.eventType,
    'Atrium-Timestamp': timestamp,
    'Atrium-Signature': signWebhook(input.secret, timestamp, input.body),
  };
}
