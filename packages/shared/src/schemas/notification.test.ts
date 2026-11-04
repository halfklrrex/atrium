import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_LIMITS,
  UPDATE_CONTENT_DOC_MAX_BYTES,
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
    for (const kind of ['automation', 'automation_disabled']) {
      const doc = { ...notification, kind, recipeName: 'Archive done items' };
      expect(notificationSchema.safeParse(doc).success).toBe(true);
    }
    const long = { ...notification, recipeName: 'x'.repeat(81) };
    expect(notificationSchema.safeParse(long).success).toBe(false);
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
      button: true,
      automation: true,
    });
  });

  it('keeps old three-key prefs documents valid (button defaults to on)', () => {
    expect(
      notificationPrefsSchema.parse({ assigned: false, reply: true, mention: true }).button,
    ).toBe(true);
    expect(notificationPrefsSchema.safeParse({ button: 'no' }).success).toBe(false);
    expect(notificationPrefsSchema.parse({}).automation).toBe(true);
    expect(notificationPrefsSchema.safeParse({ automation: 'no' }).success).toBe(false);
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

describe('contentDoc on updates and replies (spec P1d)', () => {
  const richDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
  const stored = { authorId: 'u1', content: 'hi', likes: [], createdAt: ts, updatedAt: ts };
  const update = { ...stored, itemId: 'i1', repliesCount: 0 };
  const reply = { ...stored, updateId: 'u1' };

  it('accepts a doc, keeps unknown keys, and still accepts plain posts', () => {
    expect(itemUpdateSchema.safeParse({ ...update, contentDoc: richDoc }).success).toBe(true);
    expect(updateReplySchema.safeParse({ ...reply, contentDoc: richDoc }).success).toBe(true);
    expect(itemUpdateSchema.safeParse(update).success).toBe(true);
    const parsed = createItemUpdateInputSchema.parse({
      content: 'hi',
      contentDoc: { ...richDoc, extra: 1 },
    });
    expect(parsed.contentDoc).toMatchObject({ extra: 1 });
    expect(
      createUpdateReplyInputSchema.safeParse({ content: 'hi', contentDoc: richDoc }).success,
    ).toBe(true);
  });

  it('refuses a non-doc, a wrong type and an oversized content list', () => {
    for (const contentDoc of ['x', null, { content: [] }, { type: 'paragraph' }]) {
      expect(createItemUpdateInputSchema.safeParse({ content: 'hi', contentDoc }).success).toBe(
        false,
      );
      expect(itemUpdateSchema.safeParse({ ...update, contentDoc }).success).toBe(false);
      expect(updateReplySchema.safeParse({ ...reply, contentDoc }).success).toBe(false);
    }
    const tooMany = {
      type: 'doc',
      content: Array.from({ length: 501 }, () => ({ type: 'paragraph' })),
    };
    expect(
      createItemUpdateInputSchema.safeParse({ content: 'hi', contentDoc: tooMany }).success,
    ).toBe(false);
  });

  it('refuses a doc over the size limit', () => {
    const big = {
      type: 'doc',
      content: [{ type: 'paragraph', text: 'x'.repeat(UPDATE_CONTENT_DOC_MAX_BYTES) }],
    };
    expect(createItemUpdateInputSchema.safeParse({ content: 'hi', contentDoc: big }).success).toBe(
      false,
    );
    expect(updateReplySchema.safeParse({ ...reply, contentDoc: big }).success).toBe(false);
  });

  it('requires a non-empty plain-text mirror when contentDoc is set', () => {
    expect(
      itemUpdateSchema.safeParse({ ...update, content: ' ', contentDoc: richDoc }).success,
    ).toBe(false);
    expect(
      createUpdateReplyInputSchema.safeParse({ content: '   ', contentDoc: richDoc }).success,
    ).toBe(false);
  });
});
