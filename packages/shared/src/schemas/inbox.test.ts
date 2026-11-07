import { describe, expect, it } from 'vitest';
import {
  INBOX_LIMITS,
  inboxAuditEntrySchema,
  inboxLimitsSchema,
  inboxMessageSchema,
  inboxNoteSchema,
  inboxThreadSchema,
} from '../index';

const ts = { seconds: 1, nanoseconds: 0, toDate: () => new Date(1000), toMillis: () => 1000 };

const thread = {
  kind: 'feedback',
  category: 'idea',
  subject: 'Dark mode for forms',
  senderUid: 'u1',
  senderName: 'Avery Quinn',
  senderEmail: 'avery@example.com',
  senderPhotoURL: null,
  status: 'open',
  outcome: null,
  messageCount: 1,
  lastMessageAt: ts,
  lastMessageBy: 'sender',
  lastSnippet: 'Hello',
  adminUnread: true,
  senderUnread: false,
  createdAt: ts,
  updatedAt: ts,
  closedAt: null,
};

const message = {
  seq: 1,
  authorRole: 'sender',
  authorUid: 'u1',
  authorName: 'Avery Quinn',
  authorPhotoURL: null,
  text: 'Hello',
  createdAt: ts,
};

describe('inboxThreadSchema', () => {
  it('accepts a valid feedback thread and an appeal', () => {
    expect(inboxThreadSchema.safeParse(thread).success).toBe(true);
    expect(
      inboxThreadSchema.safeParse({
        ...thread,
        kind: 'appeal',
        category: null,
        subject: 'Appeal',
        status: 'closed',
        outcome: 'upheld',
        closedAt: ts,
      }).success,
    ).toBe(true);
  });

  it('rejects bad enums, long subjects and missing fields', () => {
    expect(inboxThreadSchema.safeParse({ ...thread, kind: 'other' }).success).toBe(false);
    expect(inboxThreadSchema.safeParse({ ...thread, status: 'done' }).success).toBe(false);
    expect(inboxThreadSchema.safeParse({ ...thread, category: 'praise' }).success).toBe(false);
    expect(inboxThreadSchema.safeParse({ ...thread, subject: '' }).success).toBe(false);
    expect(
      inboxThreadSchema.safeParse({ ...thread, subject: 'x'.repeat(INBOX_LIMITS.subject + 1) })
        .success,
    ).toBe(false);
    expect(
      inboxThreadSchema.safeParse({ ...thread, lastSnippet: 'x'.repeat(INBOX_LIMITS.snippet + 1) })
        .success,
    ).toBe(false);
    const { senderEmail: _omit, ...rest } = thread;
    expect(inboxThreadSchema.safeParse(rest).success).toBe(false);
  });
});

describe('inboxMessageSchema', () => {
  it('accepts a sender message and an anonymous admin message', () => {
    expect(inboxMessageSchema.safeParse(message).success).toBe(true);
    expect(
      inboxMessageSchema.safeParse({
        ...message,
        authorRole: 'admin',
        authorUid: null,
        authorName: null,
      }).success,
    ).toBe(true);
  });

  it('refuses an admin message that carries an identity (T6)', () => {
    expect(inboxMessageSchema.safeParse({ ...message, authorRole: 'admin' }).success).toBe(false);
    expect(
      inboxMessageSchema.safeParse({
        ...message,
        authorRole: 'admin',
        authorUid: null,
        authorName: 'Someone',
      }).success,
    ).toBe(false);
  });

  it('enforces the text length and seq', () => {
    expect(inboxMessageSchema.safeParse({ ...message, text: '' }).success).toBe(false);
    expect(
      inboxMessageSchema.safeParse({ ...message, text: 'x'.repeat(INBOX_LIMITS.text) }).success,
    ).toBe(true);
    expect(
      inboxMessageSchema.safeParse({ ...message, text: 'x'.repeat(INBOX_LIMITS.text + 1) }).success,
    ).toBe(false);
    expect(inboxMessageSchema.safeParse({ ...message, seq: 0 }).success).toBe(false);
  });
});

describe('inboxNoteSchema, inboxLimitsSchema, inboxAuditEntrySchema', () => {
  it('validate their documents', () => {
    expect(inboxNoteSchema.safeParse({ text: 'n', updatedAt: ts, updatedBy: 'a1' }).success).toBe(
      true,
    );
    expect(
      inboxNoteSchema.safeParse({
        text: 'x'.repeat(INBOX_LIMITS.note + 1),
        updatedAt: ts,
        updatedBy: 'a1',
      }).success,
    ).toBe(false);
    const limits = {
      day: '2026-11-07',
      threadsToday: 1,
      messagesToday: 2,
      appealRefusedAt: null,
      updatedAt: ts,
    };
    expect(inboxLimitsSchema.safeParse(limits).success).toBe(true);
    expect(inboxLimitsSchema.safeParse({ ...limits, day: '07/11/2026' }).success).toBe(false);
    expect(
      inboxAuditEntrySchema.safeParse({
        adminUid: 'system:unblock',
        action: 'unblock',
        createdAt: ts,
      }).success,
    ).toBe(true);
    expect(
      inboxAuditEntrySchema.safeParse({ adminUid: 'a1', action: 'nuke', createdAt: ts }).success,
    ).toBe(false);
  });
});
