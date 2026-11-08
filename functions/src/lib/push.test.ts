import { describe, expect, it, vi } from 'vitest';
import type { NewNotification } from './notifications';
import {
  APP_BASE_URL,
  sendPush,
  withPushOnCreate,
  type PushDeps,
  type PushMessage,
  type PushNotificationData,
} from './push';

const SECRET_TOKEN = 'fcm-token-SECRET-aaaa';
const kinds = [
  'assigned',
  'reply',
  'mention',
  'button',
  'automation',
  'automation_disabled',
  'account_request',
  'account_approved',
  'inbox_new',
  'inbox_reply',
] as const;

const note = (over: Partial<NewNotification> = {}): NewNotification => ({
  kind: 'assigned',
  actorId: 'u-actor',
  actorName: 'Avery Quinn',
  actorPhotoURL: null,
  workspaceId: 'w1',
  boardId: 'b1',
  boardName: 'Launch plan',
  itemId: 'i1',
  itemName: 'Write copy',
  updateId: null,
  replyId: null,
  columnId: null,
  snippet: '',
  ...over,
});

interface Setup {
  deps: PushDeps;
  sent: PushMessage[];
  deleted: string[];
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

function setup(
  opts: {
    tokens?: string[];
    prefs?: unknown;
    errors?: Record<string, string>; // token -> code
    sendThrows?: boolean;
    listThrows?: boolean;
    deleteThrows?: boolean;
  } = {},
): Setup {
  const tokens = opts.tokens ?? [SECRET_TOKEN];
  const sent: PushMessage[] = [];
  const deleted: string[] = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps: PushDeps = {
    logger,
    store: {
      listTokens: async () => {
        if (opts.listThrows) throw Object.assign(new Error('boom'), { code: 'unavailable' });
        return tokens.map((token, i) => ({ id: `id${i}`, token }));
      },
      getPrefs: async () => opts.prefs as never,
      deleteToken: async (_uid, id) => {
        if (opts.deleteThrows) throw new Error('nope');
        deleted.push(id);
      },
    },
    messaging: {
      sendEachForMulticast: async (message) => {
        if (opts.sendThrows) {
          throw Object.assign(new Error(`denied ${SECRET_TOKEN}`), {
            code: 'messaging/mismatched-credential',
          });
        }
        sent.push(message);
        return {
          responses: message.tokens.map((t) => {
            const code = opts.errors?.[t];
            return code ? { success: false, error: { code } } : { success: true };
          }),
        };
      },
    },
  };
  return { deps, sent, deleted, logger };
}

const allLogs = (l: Setup['logger']) =>
  JSON.stringify([...l.info.mock.calls, ...l.warn.mock.calls, ...l.error.mock.calls]);

describe('sendPush: gating', () => {
  it('sends nothing when the user has no token docs', async () => {
    const s = setup({ tokens: [] });
    await sendPush(s.deps, 'u1', 'n1', note());
    expect(s.sent).toHaveLength(0);
  });

  it.each([
    ['assigned', 'assigned'],
    ['reply', 'reply'],
    ['mention', 'mention'],
    ['button', 'button'],
    ['automation', 'automation'],
    ['automation_disabled', 'automation'],
    ['account_request', 'account'],
    ['account_approved', 'account'],
    ['inbox_new', 'inbox'],
    ['inbox_reply', 'inbox'],
  ] as const)('%s follows the %s switch', async (kind, key) => {
    const all = {
      assigned: true,
      reply: true,
      mention: true,
      button: true,
      automation: true,
      account: true,
      inbox: true,
    };
    const on = setup({ prefs: { push: all } });
    await sendPush(on.deps, 'u1', 'n1', note({ kind }));
    expect(on.sent).toHaveLength(1);
    const off = setup({ prefs: { push: { ...all, [key]: false } } });
    await sendPush(off.deps, 'u1', 'n1', note({ kind }));
    expect(off.sent).toHaveLength(0);
  });

  it('inbox and account switches are independent', async () => {
    const all = {
      assigned: true,
      reply: true,
      mention: true,
      button: true,
      automation: true,
      account: true,
      inbox: true,
    };
    const a = setup({ prefs: { push: { ...all, inbox: false } } });
    await sendPush(a.deps, 'u1', 'n1', note({ kind: 'inbox_new' }));
    expect(a.sent).toHaveLength(0);
    const b = setup({ prefs: { push: { ...all, account: false } } });
    await sendPush(b.deps, 'u1', 'n1', note({ kind: 'inbox_new' }));
    await sendPush(b.deps, 'u1', 'n2', note({ kind: 'account_request' }));
    expect(b.sent).toHaveLength(1);
    const c = setup({ prefs: { push: { ...all, account: false } } });
    await sendPush(c.deps, 'u1', 'n1', note({ kind: 'account_approved' }));
    expect(c.sent).toHaveLength(0);
  });

  it('uses the defaults when the push map is missing: automation off, others on', async () => {
    for (const kind of kinds) {
      const s = setup({ prefs: { assigned: true } });
      await sendPush(s.deps, 'u1', 'n1', note({ kind }));
      const expected = kind === 'automation' || kind === 'automation_disabled' ? 0 : 1;
      expect(s.sent, kind).toHaveLength(expected);
    }
    const none = setup({ prefs: undefined });
    await sendPush(none.deps, 'u1', 'n1', note({ kind: 'mention' }));
    expect(none.sent).toHaveLength(1);
  });

  it('pushes nothing for an unknown kind', async () => {
    const s = setup();
    await sendPush(s.deps, 'u1', 'n1', note({ kind: 'brand_new' as never }));
    expect(s.sent).toHaveLength(0);
  });
});

describe('sendPush: payload', () => {
  const first = async (n: PushNotificationData) => {
    const s = setup({
      prefs: {
        push: {
          assigned: true,
          reply: true,
          mention: true,
          button: true,
          automation: true,
          account: true,
          inbox: true,
        },
      },
    });
    await sendPush(s.deps, 'u1', 'n1', n);
    return s.sent[0]!;
  };

  it('is data only, with string values and no notification field', async () => {
    const m = await first(note());
    expect(m).not.toHaveProperty('notification');
    expect(Object.keys(m.data).sort()).toEqual(['body', 'kind', 'tag', 'title', 'url']);
    expect(Object.values(m.data).every((v) => typeof v === 'string')).toBe(true);
  });

  it('builds title, body and url for board kinds', async () => {
    expect((await first(note())).data).toMatchObject({
      title: 'Avery Quinn assigned you to an item',
      body: 'Write copy · Launch plan',
      url: `${APP_BASE_URL}/boards/b1/items/i1`,
      kind: 'assigned',
    });
    expect((await first(note({ kind: 'reply', snippet: 'Looks good' }))).data).toMatchObject({
      title: 'Avery Quinn replied to your update',
      body: 'Looks good',
    });
    expect(
      (await first(note({ kind: 'mention', updateId: 'u9', snippet: 'Hi @you' }))).data.title,
    ).toBe('Avery Quinn mentioned you in an update');
    expect((await first(note({ kind: 'button', buttonLabel: 'Ship it' }))).data.title).toBe(
      'Avery Quinn clicked "Ship it"',
    );
    expect((await first(note({ kind: 'automation', recipeName: 'Weekly' }))).data.title).toBe(
      'Avery Quinn ran automation "Weekly"',
    );
  });

  it('builds the account and inbox kinds with the bell routes', async () => {
    const req = (await first(note({ kind: 'account_request', itemId: 'uX' }))).data;
    expect(req).toMatchObject({
      title: 'Avery Quinn asked for access',
      url: `${APP_BASE_URL}/admin`,
      body: '',
    });
    expect((await first(note({ kind: 'account_approved' }))).data.url).toBe(`${APP_BASE_URL}/`);
    const inboxNew = (
      await first(note({ kind: 'inbox_new', itemId: 't1', snippet: 'Please help' }))
    ).data;
    expect(inboxNew).toMatchObject({
      url: `${APP_BASE_URL}/admin/inbox/t1`,
      body: 'Please help',
      title: 'Avery Quinn wrote to the site admins',
    });
    const reply = (
      await first(
        note({
          kind: 'inbox_reply',
          actorName: 'Site Administrator',
          actorId: 'u-recipient',
          itemId: 't2',
          snippet: 'Fixed',
        }),
      )
    ).data;
    expect(reply).toMatchObject({
      title: 'Site Administrator replied to your feedback',
      url: `${APP_BASE_URL}/feedback/t2`,
    });
  });

  it('never carries an email or an actor id', async () => {
    const m = await first(
      note({
        kind: 'inbox_reply',
        actorName: 'Site Administrator',
        actorId: 'uid-of-admin-123',
        itemName: 'Subject',
      }),
    );
    const text = JSON.stringify(m);
    expect(text).not.toContain('uid-of-admin-123');
    expect(text).not.toContain('@example.com');
    expect(m.tokens).toEqual([SECRET_TOKEN]);
  });

  it('collapses per item: same tag for the same item, different for another', async () => {
    const a = (await first(note({ kind: 'reply' }))).data.tag;
    const b = (await first(note({ kind: 'mention' }))).data.tag;
    const c = (await first(note({ itemId: 'i2' }))).data.tag;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('sendPush: delivery', () => {
  it('chunks multicast at 500 tokens', async () => {
    const tokens = Array.from({ length: 1201 }, (_, i) => `tok${i}`);
    const s = setup({ tokens });
    await sendPush(s.deps, 'u1', 'n1', note());
    expect(s.sent.map((m) => m.tokens.length)).toEqual([500, 500, 201]);
  });

  it('deletes tokens for both dead codes and keeps live and otherwise failed ones', async () => {
    const s = setup({
      tokens: ['live', 'gone', 'bad', 'flaky'],
      errors: {
        gone: 'messaging/registration-token-not-registered',
        bad: 'messaging/invalid-registration-token',
        flaky: 'messaging/internal-error',
      },
    });
    await sendPush(s.deps, 'u1', 'n1', note());
    expect(s.deleted.sort()).toEqual(['id1', 'id2']);
  });

  it('logs and swallows a send failure, without the token or message text', async () => {
    const s = setup({ sendThrows: true });
    await expect(
      sendPush(s.deps, 'u1', 'n1', note({ snippet: 'private words' })),
    ).resolves.toBeUndefined();
    expect(s.logger.error).toHaveBeenCalled();
    const logs = allLogs(s.logger);
    expect(logs).toContain('messaging/mismatched-credential');
    expect(logs).toContain('u1');
    expect(logs).toContain('n1');
    expect(logs).not.toContain(SECRET_TOKEN);
    expect(logs).not.toContain('private words');
    expect(logs).not.toContain('Avery Quinn');
  });

  it('swallows a token read failure and a delete failure', async () => {
    const a = setup({ listThrows: true });
    await expect(sendPush(a.deps, 'u1', 'n1', note())).resolves.toBeUndefined();
    expect(a.sent).toHaveLength(0);
    expect(a.logger.error).toHaveBeenCalled();
    const b = setup({
      tokens: ['x'],
      errors: { x: 'messaging/registration-token-not-registered' },
      deleteThrows: true,
    });
    await expect(sendPush(b.deps, 'u1', 'n1', note())).resolves.toBeUndefined();
    expect(allLogs(b.logger)).not.toContain('"x"');
  });

  it('never logs a token, even for failed sends and on success', async () => {
    const s = setup({
      tokens: [SECRET_TOKEN, 'other-SECRET'],
      errors: { 'other-SECRET': 'messaging/internal-error' },
    });
    await sendPush(s.deps, 'u1', 'n1', note());
    const logs = allLogs(s.logger);
    expect(logs).not.toContain('SECRET');
    expect(logs).toContain('"devices":2');
  });
});

describe('withPushOnCreate', () => {
  const base = (created: boolean) => ({
    createNotification: vi.fn(async (_u: string, _i: string, _d: NewNotification) => created),
    upsertNotification: vi.fn(async (_u: string, _i: string, _d: NewNotification) => undefined),
    getPrefs: vi.fn(async (_u?: string) => undefined),
  });

  it('pushes after a newly created notification only', async () => {
    const push = vi.fn(async () => undefined);
    const fresh = withPushOnCreate(base(true), push);
    expect(await fresh.createNotification('u1', 'n1', note())).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    const retried = withPushOnCreate(base(false), push);
    expect(await retried.createNotification('u1', 'n1', note())).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('pushes after an upsert and keeps the other methods', async () => {
    const push = vi.fn(async () => undefined);
    const store = withPushOnCreate(base(true), push);
    await store.upsertNotification('u1', 'n1', note({ kind: 'inbox_new' }));
    expect(push).toHaveBeenCalledWith('u1', 'n1', expect.objectContaining({ kind: 'inbox_new' }));
    expect(await store.getPrefs('u1')).toBeUndefined();
  });

  it('does not push when the write itself fails', async () => {
    const push = vi.fn(async () => undefined);
    const b = base(true);
    b.createNotification.mockRejectedValue(new Error('write failed'));
    await expect(withPushOnCreate(b, push).createNotification('u1', 'n1', note())).rejects.toThrow(
      'write failed',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('a throwing push never fails or blocks the notification', async () => {
    const push = vi.fn(async () => {
      throw new Error('push exploded');
    });
    const store = withPushOnCreate(base(true), push);
    expect(await store.createNotification('u1', 'n1', note())).toBe(true);
    await expect(store.upsertNotification('u1', 'n1', note())).resolves.toBeUndefined();
  });
});
