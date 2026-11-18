import { describe, expect, it } from 'vitest';
import { deliveryHeaders, newWebhookSecret, signWebhook } from './signature';

describe('signWebhook', () => {
  it('matches a vector computed independently with openssl', () => {
    // printf '1700000000.{"id":"a1","type":"ping"}' | openssl dgst -sha256 -hmac 'whsec_test-secret-0123456789'
    expect(
      signWebhook('whsec_test-secret-0123456789', '1700000000', '{"id":"a1","type":"ping"}'),
    ).toBe('v1=64e5b71fd2b907d8c3356f515edbd0ac53bb9404333ea643bf49722baad77e1d');
  });

  it('changes with the secret, the timestamp and the body', () => {
    const base = signWebhook('s', '1', 'b');
    expect(signWebhook('t', '1', 'b')).not.toBe(base);
    expect(signWebhook('s', '2', 'b')).not.toBe(base);
    expect(signWebhook('s', '1', 'c')).not.toBe(base);
  });
});

describe('deliveryHeaders', () => {
  it('sets every header and signs the same timestamp it sends', () => {
    const body = '{"id":"a1","type":"ping"}';
    const headers = deliveryHeaders({
      eventId: 'a1',
      eventType: 'ping',
      secret: 'whsec_test-secret-0123456789',
      body,
      nowMs: 1_700_000_000_999,
    });
    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': 'Atrium-Webhooks/1',
      'Atrium-Event-Id': 'a1',
      'Atrium-Event-Type': 'ping',
      'Atrium-Timestamp': '1700000000',
      'Atrium-Signature': 'v1=64e5b71fd2b907d8c3356f515edbd0ac53bb9404333ea643bf49722baad77e1d',
    });
  });
});

describe('newWebhookSecret', () => {
  it('is whsec_ plus 32 random bytes in base64url, and different every time', () => {
    const a = newWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(newWebhookSecret()).not.toBe(a);
  });
});
