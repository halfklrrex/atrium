import { describe, expect, it } from 'vitest';
import {
  INBOX_ERROR_REASONS,
  INBOX_LIMITS,
  MANAGE_INBOX_THREAD_CALLABLE,
  SEND_INBOX_MESSAGE_CALLABLE,
  manageInboxThreadRequestSchema,
  normalizeInboxText,
  sendInboxMessageRequestSchema,
} from './index';

const id = '3f2b8c1e-9d4a-4b6e-8a1c-2d5e7f9a0b1c';

describe('callable names and reasons', () => {
  it('are fixed', () => {
    expect(SEND_INBOX_MESSAGE_CALLABLE).toBe('sendInboxMessage');
    expect(MANAGE_INBOX_THREAD_CALLABLE).toBe('manageInboxThread');
    expect(INBOX_ERROR_REASONS).toContain('appeal-wait');
    expect(new Set(INBOX_ERROR_REASONS).size).toBe(INBOX_ERROR_REASONS.length);
  });
});

describe('normalizeInboxText', () => {
  it('trims and strips control characters except newline and tab', () => {
    expect(normalizeInboxText('  hi\u0000 there\u0007\n\tok\u009f  ')).toBe('hi there\n\tok');
    expect(normalizeInboxText('a\r\nb')).toBe('a\nb');
    expect(normalizeInboxText(' \u0000 ')).toBe('');
  });

  it('keeps ZWJ and ZWNJ, which emoji sequences and Persian or Indic text need', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(normalizeInboxText(family)).toBe(family);
    const persian = '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645';
    expect(normalizeInboxText(persian)).toBe(persian);
    expect(normalizeInboxText(`${family}\u202E\u200B`)).toBe(family);
  });

  it('strips Unicode format characters and line separators', () => {
    expect(normalizeInboxText('pay\u202Eexe.txt\u200Bok\uFEFF\u2028\u2029!')).toBe('payexe.txtok!');
    expect(normalizeInboxText('\u200B\u202E\uFEFF')).toBe('');
    expect(
      sendInboxMessageRequestSchema.safeParse({
        action: 'feedback',
        requestId: id,
        category: 'bug',
        subject: 'ok',
        text: '\u200B\u202E',
      }).success,
    ).toBe(false);
  });
});

describe('sendInboxMessageRequestSchema', () => {
  it('accepts a complaint as a feedback category', () => {
    expect(
      sendInboxMessageRequestSchema.safeParse({
        action: 'feedback',
        requestId: id,
        category: 'complaint',
        subject: 'Delete my data',
        text: 'Please.',
      }).success,
    ).toBe(true);
  });

  it('parses each action and normalises the text', () => {
    const feedback = sendInboxMessageRequestSchema.parse({
      action: 'feedback',
      requestId: id,
      category: 'bug',
      subject: ' Crash ',
      text: ' It broke\u0000 ',
    });
    expect(feedback).toMatchObject({ subject: 'Crash', text: 'It broke' });
    expect(
      sendInboxMessageRequestSchema.safeParse({ action: 'appeal', requestId: id, text: 'Please' })
        .success,
    ).toBe(true);
    expect(
      sendInboxMessageRequestSchema.safeParse({
        action: 'reply',
        requestId: id,
        threadId: 't1',
        text: 'More',
      }).success,
    ).toBe(true);
  });

  it('refuses bad input', () => {
    const base = { requestId: id, text: 'x' };
    const bad = [
      { action: 'appeal', requestId: 'nope', text: 'x' },
      { action: 'appeal', requestId: id, text: '   ' },
      { action: 'appeal', requestId: id, text: 'x'.repeat(INBOX_LIMITS.text + 1) },
      { action: 'appeal', ...base, extra: 1 },
      { action: 'feedback', ...base, category: 'praise', subject: 's' },
      { action: 'feedback', ...base, category: 'bug', subject: '' },
      { action: 'feedback', ...base, category: 'bug', subject: 'x'.repeat(121) },
      { action: 'reply', ...base },
      { action: 'delete', threadId: 't1' },
    ];
    for (const input of bad) {
      expect(sendInboxMessageRequestSchema.safeParse(input).success, JSON.stringify(input)).toBe(
        false,
      );
    }
    expect(
      sendInboxMessageRequestSchema.safeParse({
        action: 'appeal',
        requestId: id,
        text: 'x'.repeat(2000),
      }).success,
    ).toBe(true);
  });
});

describe('manageInboxThreadRequestSchema', () => {
  it('parses each action', () => {
    for (const action of ['close', 'reopen', 'delete'] as const) {
      expect(manageInboxThreadRequestSchema.safeParse({ action, threadId: 't1' }).success).toBe(
        true,
      );
    }
    expect(
      manageInboxThreadRequestSchema.safeParse({
        action: 'reply',
        threadId: 't1',
        requestId: id,
        text: 'Hi',
      }).success,
    ).toBe(true);
    expect(
      manageInboxThreadRequestSchema.safeParse({ action: 'keepBlocked', threadId: 't1' }).success,
    ).toBe(true);
    expect(
      manageInboxThreadRequestSchema.safeParse({
        action: 'keepBlocked',
        threadId: 't1',
        requestId: id,
        text: 'Final',
      }).success,
    ).toBe(true);
  });

  it('refuses a half-given keepBlocked message and unknown or extra input', () => {
    expect(
      manageInboxThreadRequestSchema.safeParse({ action: 'keepBlocked', threadId: 't1', text: 'x' })
        .success,
    ).toBe(false);
    expect(
      manageInboxThreadRequestSchema.safeParse({
        action: 'keepBlocked',
        threadId: 't1',
        requestId: id,
      }).success,
    ).toBe(false);
    expect(manageInboxThreadRequestSchema.safeParse({ action: 'close' }).success).toBe(false);
    expect(
      manageInboxThreadRequestSchema.safeParse({ action: 'close', threadId: 't1', x: 1 }).success,
    ).toBe(false);
    expect(
      manageInboxThreadRequestSchema.safeParse({ action: 'appeal', threadId: 't1' }).success,
    ).toBe(false);
  });
});
