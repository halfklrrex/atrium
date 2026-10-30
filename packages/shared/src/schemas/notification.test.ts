import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_LIMITS,
  createItemUpdateInputSchema,
  createUpdateReplyInputSchema,
  itemUpdateSchema,
  mentionsSchema,
  notificationPrefsSchema,
  notificationSchema,
  updateReplySchema,
  userProfileUpdateSchema,
  userSchema,
} from '../index';

const ts = { seconds: 1, nanoseconds: 0, toDate: () => new Date(1000), toMillis: () => 1000 };

const notification = {
  kind: 'mention',
  actorId: 'u1',
  actorName: 'Avery Quinn',
  actorPhotoURL: null,
  workspaceId: 'ws1',
  boardId: 'b1',
  boardName: 'Board',
  itemId: 'i1',
  itemName: 'Item',
  updateId: 'up1',
  replyId: null,
  columnId: null,
  snippet: 'hello',
  createdAt: ts,
  readAt: null,
};

describe('notificationSchema', () => {
  it('accepts a valid notification', () => {
    expect(notificationSchema.safeParse(notification).success).toBe(true);
    expect(notificationSchema.safeParse({ ...notification, readAt: ts }).success).toBe(true);
  });

  it('rejects an unknown kind and an over-long snippet', () => {
    expect(notificationSchema.safeParse({ ...notification, kind: 'email' }).success).toBe(false);
    const snippet = 'x'.repeat(NOTIFICATION_LIMITS.snippet + 1);
    expect(notificationSchema.safeParse({ ...notification, snippet }).success).toBe(false);
  });
});

describe('notificationPrefsSchema', () => {
  it('defaults every kind to on', () => {
    expect(notificationPrefsSchema.parse({})).toEqual({
      assigned: true,
      reply: true,
      mention: true,
    });
  });

  it('refuses non-booleans and extra keys', () => {
    expect(notificationPrefsSchema.safeParse({ assigned: 'yes' }).success).toBe(false);
    expect(notificationPrefsSchema.safeParse({ email: true }).success).toBe(false);
  });

  it('is optional on the user and allowed in the profile update', () => {
    const prefs = { assigned: false, reply: true, mention: true };
    expect(userProfileUpdateSchema.safeParse({ notificationPrefs: prefs }).success).toBe(true);
    expect(userSchema.shape.notificationPrefs.safeParse(undefined).success).toBe(true);
  });
});

describe('mentions', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

  it('allows up to the limit and refuses more', () => {
    expect(mentionsSchema.safeParse(ids(NOTIFICATION_LIMITS.mentions)).success).toBe(true);
    expect(mentionsSchema.safeParse(ids(NOTIFICATION_LIMITS.mentions + 1)).success).toBe(false);
  });

  it('refuses duplicates', () => {
    expect(mentionsSchema.safeParse(['u1', 'u1']).success).toBe(false);
  });

  it('is optional on updates, replies and both create inputs', () => {
    const base = { content: 'hi' };
    expect(createItemUpdateInputSchema.safeParse(base).success).toBe(true);
    expect(createItemUpdateInputSchema.safeParse({ ...base, mentions: ['u2'] }).success).toBe(true);
    expect(createItemUpdateInputSchema.safeParse({ ...base, mentions: ['a', 'a'] }).success).toBe(
      false,
    );
    expect(createUpdateReplyInputSchema.safeParse({ ...base, mentions: ['u2'] }).success).toBe(
      true,
    );
    const doc = { authorId: 'u1', content: 'hi', likes: [], createdAt: ts, updatedAt: ts };
    expect(
      itemUpdateSchema.safeParse({ ...doc, itemId: 'i1', repliesCount: 0, mentions: ['u2'] })
        .success,
    ).toBe(true);
    expect(updateReplySchema.safeParse({ ...doc, updateId: 'u1', mentions: ['u2'] }).success).toBe(
      true,
    );
  });
});
