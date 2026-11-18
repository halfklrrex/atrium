import { describe, expect, it } from 'vitest';
import {
  describeWebhookStatus,
  isWebhooksOff,
  parseWebhookForm,
  summarizeEvents,
  urlHost,
  validateWebhookUrl,
} from './integrations-model';

describe('integrations model', () => {
  it('shows only the host of a receiver address', () => {
    expect(urlHost('https://hooks.example.com/secret/path?token=abc')).toBe('hooks.example.com');
    expect(urlHost('nonsense')).toBe('Invalid address');
  });

  it('summarizes events', () => {
    expect(summarizeEvents(['*'])).toBe('All events');
    expect(summarizeEvents(['item_created'])).toBe('Item created');
    expect(summarizeEvents(['item_created', 'value_changed'])).toBe('Item created and 1 more');
  });

  it('validates addresses on the client', () => {
    expect(validateWebhookUrl('https://example.com/hook')).toBeNull();
    expect(validateWebhookUrl('http://example.com/hook')).toMatch(/https/);
    expect(validateWebhookUrl('https://10.0.0.1/hook')).toMatch(/IP address/);
    expect(validateWebhookUrl('https://[::1]/hook')).toMatch(/IP address/);
    expect(validateWebhookUrl('')).toMatch(/Enter the address/);
  });

  it('builds the request from the form', () => {
    const base = { name: ' Chat ', url: 'https://example.com/x', allEvents: true, events: [] };
    expect(parseWebhookForm(base)).toEqual({
      ok: true,
      value: { name: 'Chat', url: 'https://example.com/x', events: ['*'] },
    });
    expect(parseWebhookForm({ ...base, allEvents: false })).toMatchObject({ ok: false });
    expect(parseWebhookForm({ ...base, allEvents: false, events: ['item_created'] })).toMatchObject(
      { ok: true, value: { events: ['item_created'] } },
    );
  });

  it('recognizes the feature-off refusal and describes status', () => {
    expect(
      isWebhooksOff({
        code: 'functions/failed-precondition',
        message: 'Webhooks are not switched on for this site yet.',
      }),
    ).toBe(true);
    expect(isWebhooksOff({ code: 'functions/failed-precondition', message: 'Limit reached' })).toBe(
      false,
    );
    expect(describeWebhookStatus({ enabled: true, disabledReason: null })).toBe('Active');
    expect(describeWebhookStatus({ enabled: false, disabledReason: 'Too many failures' })).toBe(
      'Disabled: Too many failures',
    );
  });
});
