import { INBOX_ERROR_REASONS } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  appealWait,
  describeInboxError,
  inboxErrorReason,
  senderCanReply,
  upheldNotice,
} from './inbox-sender';

const err = (reason: string, extra: Record<string, unknown> = {}) => ({
  code: 'functions/resource-exhausted',
  message: 'server text',
  details: { reason, ...extra },
});

describe('describeInboxError', () => {
  it('maps every known reason to its own text', () => {
    const texts = INBOX_ERROR_REASONS.filter((r) => r !== 'account-not-approved').map((r) =>
      describeInboxError(err(r), 'fallback'),
    );
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).not.toContain('server text');
    expect(texts).not.toContain('fallback');
  });

  it('uses the exact open-thread-limit text from the spec', () => {
    expect(describeInboxError(err('open-thread-limit'), 'x')).toBe(
      'You can have 3 open conversations at a time. Wait for a reply or for one to close.',
    );
  });

  it('picks the daily message cap by account state', () => {
    expect(describeInboxError(err('daily-message-limit'), 'x')).toContain('30 messages');
    expect(describeInboxError(err('daily-message-limit'), 'x', { blocked: true })).toContain(
      '10 messages',
    );
  });

  it('names the retry date for appeal-wait when the server sends it', () => {
    const text = describeInboxError(
      err('appeal-wait', { retryAfter: '2026-11-01T10:00:00.000Z' }),
      'x',
    );
    expect(text).toMatch(/^You can send a new appeal from .*2026/);
  });

  it('falls back for unknown or missing reasons', () => {
    expect(describeInboxError(new Error('boom'), 'Could not send.')).toBe('Could not send.');
    expect(inboxErrorReason(err('made-up'))).toBeNull();
  });
});

describe('appealWait', () => {
  const day = 86_400_000;
  const closed = {
    status: 'closed',
    outcome: 'upheld',
    closedAt: { toMillis: () => 1_000_000 },
  } as const;

  it('is the decision date plus 7 days', () => {
    const wait = appealWait(closed, 1_000_000 + day)!;
    expect(wait.retryFrom.toMillis()).toBe(1_000_000 + 7 * day);
    expect(wait.waiting).toBe(true);
  });

  it('stops waiting exactly at 7 days', () => {
    expect(appealWait(closed, 1_000_000 + 7 * day - 1)!.waiting).toBe(true);
    expect(appealWait(closed, 1_000_000 + 7 * day)!.waiting).toBe(false);
  });

  it('applies only to a closed, upheld appeal', () => {
    expect(appealWait({ ...closed, outcome: 'unblocked' })).toBeNull();
    expect(appealWait({ ...closed, status: 'answered' })).toBeNull();
    expect(appealWait({ ...closed, closedAt: null })).toBeNull();
  });

  it('writes the notice with both dates', () => {
    const text = upheldNotice(appealWait(closed, 0)!);
    expect(text).toMatch(
      /^Your appeal was not accepted on .*\. You can send a new appeal from .*\.$/,
    );
  });
});

describe('senderCanReply', () => {
  it('is false only when closed', () => {
    expect(senderCanReply({ status: 'open' })).toBe(true);
    expect(senderCanReply({ status: 'answered' })).toBe(true);
    expect(senderCanReply({ status: 'closed' })).toBe(false);
  });
});
