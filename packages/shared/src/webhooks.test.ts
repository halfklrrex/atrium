import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_NAME_MAX,
  WEBHOOK_RETRY_DELAYS_MS,
  WEBHOOK_MAX_ATTEMPTS,
  createWebhookRequestSchema,
  createWebhookResultSchema,
  updateWebhookRequestSchema,
  webhookDeliverySchema,
  webhookEventPayloadSchema,
  webhookSchema,
} from './webhooks';

const ts = { seconds: 1, nanoseconds: 0, toDate: () => new Date(1000), toMillis: () => 1000 };
const valid = {
  boardId: 'b1',
  name: ' Deploy hook ',
  url: 'https://example.com/hook',
  events: ['value_changed'],
};

describe('createWebhookRequestSchema', () => {
  it('accepts a request and trims the name and url', () => {
    const parsed = createWebhookRequestSchema.parse({ ...valid, url: ' https://example.com/h ' });
    expect(parsed.name).toBe('Deploy hook');
    expect(parsed.url).toBe('https://example.com/h');
  });

  it.each([['*'], ['item_created', 'value_changed']])('accepts events %j', (...events) => {
    expect(createWebhookRequestSchema.safeParse({ ...valid, events }).success).toBe(true);
  });

  it.each([
    ['an empty list', []],
    ['an unknown kind', ['made_up']],
    ['the ping event', ['ping']],
    ['duplicates', ['item_created', 'item_created']],
    ['"*" mixed with a kind', ['*', 'item_created']],
  ])('rejects %s', (_label, events) => {
    expect(createWebhookRequestSchema.safeParse({ ...valid, events }).success).toBe(false);
  });

  it.each(['http://example.com/x', 'ftp://example.com', 'example.com', 'javascript:alert(1)', ''])(
    'rejects the url %j',
    (url) => {
      expect(createWebhookRequestSchema.safeParse({ ...valid, url }).success).toBe(false);
    },
  );

  it('rejects a url over 2048 characters and a name over the limit', () => {
    expect(
      createWebhookRequestSchema.safeParse({
        ...valid,
        url: `https://example.com/${'a'.repeat(2048)}`,
      }).success,
    ).toBe(false);
    expect(
      createWebhookRequestSchema.safeParse({ ...valid, name: 'x'.repeat(WEBHOOK_NAME_MAX + 1) })
        .success,
    ).toBe(false);
    expect(createWebhookRequestSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('is strict', () => {
    expect(createWebhookRequestSchema.safeParse({ ...valid, enabled: true }).success).toBe(false);
  });
});

describe('updateWebhookRequestSchema', () => {
  it('needs at least one change', () => {
    expect(updateWebhookRequestSchema.safeParse({ boardId: 'b', webhookId: 'w' }).success).toBe(
      false,
    );
    expect(
      updateWebhookRequestSchema.safeParse({ boardId: 'b', webhookId: 'w', enabled: false })
        .success,
    ).toBe(true);
  });
});

describe('results and documents', () => {
  it('the create result needs the whsec_ prefix', () => {
    expect(
      createWebhookResultSchema.safeParse({ webhookId: 'w', secret: 'whsec_abc' }).success,
    ).toBe(true);
    expect(createWebhookResultSchema.safeParse({ webhookId: 'w', secret: 'abc' }).success).toBe(
      false,
    );
  });

  it('parses a webhook document', () => {
    expect(
      webhookSchema.safeParse({
        name: 'n',
        url: 'https://example.com',
        events: ['*'],
        enabled: true,
        createdBy: 'u1',
        createdAt: ts,
        consecutiveFailures: 0,
        disabledReason: null,
        lastDeliveryAt: null,
      }).success,
    ).toBe(true);
  });

  it('parses a delivery document and a payload', () => {
    expect(
      webhookDeliverySchema.safeParse({
        boardId: 'b',
        webhookId: 'w',
        eventId: 'e',
        eventType: 'ping',
        payload: '{}',
        attempt: 0,
        nextAttemptAt: ts,
        status: 'pending',
        lastStatus: null,
        lastError: null,
        createdAt: ts,
        expiresAt: ts,
      }).success,
    ).toBe(true);
    expect(
      webhookEventPayloadSchema.safeParse({
        id: 'e',
        type: 'value_changed',
        createdAt: '2026-11-18T00:00:00.000Z',
        boardId: 'b',
        itemId: 'i',
        itemName: 'Item',
        columnId: 'c',
        actor: { id: 'u', name: 'Avery Quinn' },
        data: { from: 1, to: 2 },
      }).success,
    ).toBe(true);
  });

  it('has five attempts and four waits between them', () => {
    expect(WEBHOOK_RETRY_DELAYS_MS).toHaveLength(WEBHOOK_MAX_ATTEMPTS - 1);
  });
});
