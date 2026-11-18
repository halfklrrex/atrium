import { describe, expect, it } from 'vitest';
import {
  INCOMING_HOOK_BASE_URL,
  createIncomingHookRequestSchema,
  createIncomingHookResultSchema,
  incomingHookBodySchema,
  incomingHookSchema,
  listWebhookDeliveriesRequestSchema,
  listWebhookDeliveriesResultSchema,
  updateIncomingHookRequestSchema,
} from './incoming-hooks';

const ts = { seconds: 1, nanoseconds: 0, toDate: () => new Date(1000), toMillis: () => 1000 };

describe('createIncomingHookRequestSchema', () => {
  it('trims the name and refuses an empty, a long or an extra field', () => {
    expect(createIncomingHookRequestSchema.parse({ boardId: 'b1', name: ' Form ' }).name).toBe(
      'Form',
    );
    for (const bad of [
      { boardId: 'b1', name: '   ' },
      { boardId: 'b1', name: 'x'.repeat(61) },
      { boardId: 'b1', name: 'Form', url: 'https://x.example.com' },
      { name: 'Form' },
    ]) {
      expect(createIncomingHookRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('createIncomingHookResultSchema', () => {
  it('only accepts a URL under the hooks base', () => {
    const ok = createIncomingHookResultSchema.safeParse({
      hookId: 'h1',
      url: `${INCOMING_HOOK_BASE_URL}h1.secret`,
    });
    expect(ok.success).toBe(true);
    expect(
      createIncomingHookResultSchema.safeParse({ hookId: 'h1', url: 'https://evil.example.com/x' })
        .success,
    ).toBe(false);
  });
});

describe('updateIncomingHookRequestSchema', () => {
  it('needs a change and lets the group be cleared with null', () => {
    expect(updateIncomingHookRequestSchema.safeParse({ boardId: 'b', hookId: 'h' }).success).toBe(
      false,
    );
    expect(
      updateIncomingHookRequestSchema.safeParse({ boardId: 'b', hookId: 'h', defaultGroupId: null })
        .success,
    ).toBe(true);
    expect(
      updateIncomingHookRequestSchema.safeParse({ boardId: 'b', hookId: 'h', enabled: false })
        .success,
    ).toBe(true);
  });
});

describe('incomingHookBodySchema', () => {
  it('takes a name 1 to 255, optional values and group, and nothing else', () => {
    expect(
      incomingHookBodySchema.parse({ name: ' Hi ', values: { Note: 'x' }, group: 'g1' }),
    ).toEqual({ name: 'Hi', values: { Note: 'x' }, group: 'g1' });
    for (const bad of [
      {},
      { name: '' },
      { name: 'x'.repeat(256) },
      { name: 'a', values: 'nope' },
      { name: 'a', values: [] },
      { name: 'a', group: '' },
      { name: 'a', extra: 1 },
    ]) {
      expect(incomingHookBodySchema.safeParse(bad).success).toBe(false);
    }
    expect(incomingHookBodySchema.safeParse({ name: 'x'.repeat(255) }).success).toBe(true);
  });
});

describe('incomingHookSchema', () => {
  it('has no secret or hash field and allows a missing default group', () => {
    const doc = {
      name: 'Form',
      enabled: true,
      createdBy: 'u1',
      createdAt: ts,
      lastUsedAt: null,
    };
    expect(incomingHookSchema.safeParse(doc).success).toBe(true);
    expect(Object.keys(incomingHookSchema.shape)).not.toContain('secret');
    expect(Object.keys(incomingHookSchema.shape)).not.toContain('hash');
  });
});

describe('delivery log schemas', () => {
  it('caps the limit at 50 and defaults nothing in the request', () => {
    const base = { boardId: 'b', webhookId: 'w' };
    expect(listWebhookDeliveriesRequestSchema.safeParse({ ...base, limit: 50 }).success).toBe(true);
    expect(listWebhookDeliveriesRequestSchema.safeParse({ ...base, limit: 51 }).success).toBe(
      false,
    );
    expect(listWebhookDeliveriesRequestSchema.safeParse({ ...base, limit: 0 }).success).toBe(false);
    expect(listWebhookDeliveriesRequestSchema.safeParse(base).success).toBe(true);
  });

  it('has no payload or secret in a result row', () => {
    const row = {
      id: 'w_e1',
      eventType: 'ping',
      status: 'sent',
      attempt: 1,
      lastStatus: 200,
      lastError: null,
      createdAt: 1,
      nextAttemptAt: 2,
    };
    const parsed = listWebhookDeliveriesResultSchema.parse({
      deliveries: [{ ...row, payload: '{"secret":1}', secret: 'whsec_x' }],
    });
    expect(JSON.stringify(parsed)).not.toContain('payload');
    expect(JSON.stringify(parsed)).not.toContain('whsec_');
  });
});
