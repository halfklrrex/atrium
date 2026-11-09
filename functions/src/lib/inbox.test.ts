import { INBOX_ADMIN_LABEL, INBOX_LIMITS, type InboxStatus } from '@atrium/shared';
import type { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import {
  SYSTEM_UNBLOCK,
  closeOpenAppeals,
  deleteThread,
  manageInboxThread,
  sendInboxMessage,
  type AuditData,
  type InboxAuth,
  type InboxDeps,
  type InboxSender,
  type InboxStore,
  type InboxTx,
  type LimitsData,
  type MessageData,
  type ThreadData,
} from './inbox';
import { notificationId, type NewNotification } from './notifications';

// -- an in-memory store: writes are buffered and applied only when the transaction function ends,
//    and a read after a write throws (Firestore refuses it too) --------------------------------

class FakeStore implements InboxStore {
  threads = new Map<string, ThreadData>();
  messages = new Map<string, MessageData>();
  limits = new Map<string, LimitsData>();
  audit = new Map<string, AuditData>();
  notes = new Set<string>();
  notifications = new Map<string, NewNotification & { readAt: null }>();
  upserts: string[] = [];
  failUpsertFor: string | null = null;
  deleteBatches: Array<{ what: string; limit: number }> = [];
  deletedNotificationBatches: number[] = [];

  transaction<T>(fn: (tx: InboxTx) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the buffered tx closes over the store
    const store = this;
    const guard = () => {
      if (writes.length > 0) throw new Error('read after write in a transaction');
    };
    const tx: InboxTx = {
      getThread: async (id) => (guard(), structuredClone(store.threads.get(id) ?? null)),
      getMessage: async (tid, mid) => {
        guard();
        const m = store.messages.get(`${tid}/${mid}`);
        return m ? { authorRole: m.authorRole, authorUid: m.authorUid } : null;
      },
      getLimits: async (uid) => (guard(), structuredClone(store.limits.get(uid) ?? null)),
      findSenderThreads: async (q) => {
        guard();
        return [...store.threads.entries()]
          .filter(
            ([, t]) =>
              t.senderUid === q.senderUid && t.kind === q.kind && q.statuses.includes(t.status),
          )
          .slice(0, q.limit)
          .map(([id]) => ({ id }));
      },
      createThread: (id, data) =>
        writes.push(() => {
          if (store.threads.has(id)) throw new Error('exists');
          store.threads.set(id, structuredClone(data));
        }),
      updateThread: (id, patch) =>
        writes.push(() => {
          const t = store.threads.get(id);
          if (!t) throw new Error('missing');
          store.threads.set(id, { ...t, ...structuredClone(patch) });
        }),
      createMessage: (tid, mid, data) =>
        writes.push(() => {
          if (store.messages.has(`${tid}/${mid}`)) throw new Error('exists');
          store.messages.set(`${tid}/${mid}`, structuredClone(data));
        }),
      setLimits: (uid, data) => writes.push(() => store.limits.set(uid, structuredClone(data))),
      createAudit: (tid, eid, data) =>
        writes.push(() => store.audit.set(`${tid}/${eid}`, structuredClone(data))),
    };
    return fn(tx).then((value) => {
      for (const w of writes) w();
      return value;
    });
  }
  getThread(id: string) {
    return Promise.resolve(structuredClone(this.threads.get(id) ?? null));
  }
  private deleteWhere(prefix: string, map: Map<string, unknown>, limit: number, what: string) {
    this.deleteBatches.push({ what, limit });
    const keys = [...map.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit);
    for (const k of keys) map.delete(k);
    return Promise.resolve(keys.length);
  }
  deleteMessagesBatch(threadId: string, limit: number) {
    return this.deleteWhere(`${threadId}/`, this.messages, limit, 'messages');
  }
  deleteAuditBatch(threadId: string, limit: number) {
    return this.deleteWhere(`${threadId}/`, this.audit, limit, 'audit');
  }
  deleteNotifications(refs: ReadonlyArray<{ uid: string; id: string }>) {
    this.deletedNotificationBatches.push(refs.length);
    for (const r of refs) this.notifications.delete(`${r.uid}/${r.id}`);
    return Promise.resolve();
  }
  notified = new Map<string, Set<string>>();
  addNotifiedUids(threadId: string, uids: ReadonlyArray<string>) {
    const set = this.notified.get(threadId) ?? new Set<string>();
    for (const uid of uids) set.add(uid);
    this.notified.set(threadId, set);
    return Promise.resolve();
  }
  getNotifiedUids(threadId: string) {
    return Promise.resolve([...(this.notified.get(threadId) ?? [])]);
  }
  deleteNoteAndThread(threadId: string) {
    this.notified.delete(threadId);
    this.notes.delete(threadId);
    this.threads.delete(threadId);
    return Promise.resolve();
  }
  upsertNotification(uid: string, id: string, data: NewNotification) {
    if (this.failUpsertFor === uid) return Promise.reject(new Error('notification failed'));
    this.upserts.push(`${uid}/${id}`);
    this.notifications.set(`${uid}/${id}`, { ...structuredClone(data), readAt: null });
    return Promise.resolve();
  }
}

class FakeAuth implements InboxAuth {
  admins = ['adm1', 'adm2'];
  statuses = new Map<string, 'approved' | 'blocked' | 'pending'>([['b1', 'blocked']]);
  failList = false;
  listAdminUids() {
    return this.failList ? Promise.reject(new Error('auth down')) : Promise.resolve(this.admins);
  }
  getAccountStatus(uid: string) {
    return Promise.resolve(this.statuses.get(uid) ?? null);
  }
}

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function setup(now = new Date('2026-11-10T12:00:00.000Z')) {
  const store = new FakeStore();
  const auth = new FakeAuth();
  const clock = { now };
  const deps: InboxDeps = { store, auth, now: () => clock.now, newId: uuid };
  return { store, auth, deps, clock };
}

const approved: InboxSender = {
  uid: 'u1',
  displayName: 'Avery Quinn',
  email: 'avery@example.com',
  photoURL: 'https://example.com/a.png',
  accountStatus: 'approved',
};
const blocked: InboxSender = { ...approved, uid: 'b1', accountStatus: 'blocked' };
const pending: InboxSender = { ...approved, uid: 'p1', accountStatus: 'pending' };
const adm = { uid: 'adm1' };

const feedback = (requestId = uuid(), over: Record<string, unknown> = {}) =>
  ({
    action: 'feedback',
    requestId,
    category: 'idea',
    subject: 'Dark mode',
    text: 'Please add it',
    ...over,
  }) as never;
const appeal = (requestId = uuid(), text = 'I think this is a mistake') =>
  ({ action: 'appeal', requestId, text }) as never;
const reply = (threadId: string, requestId = uuid(), text = 'More detail') =>
  ({ action: 'reply', threadId, requestId, text }) as never;

async function refusal(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    return error as HttpsError;
  }
  throw new Error('expected a refusal');
}

const detail = (e: HttpsError) => e.details as Record<string, unknown>;

describe('sendInboxMessage: feedback', () => {
  it('creates the thread and message 1, sets the counters, and notifies every admin once', async () => {
    const { store, deps } = setup();
    const id = uuid();
    const result = await sendInboxMessage(deps, approved, feedback(id));
    expect(result).toEqual({ threadId: id });
    expect(store.threads.get(id)).toMatchObject({
      kind: 'feedback',
      category: 'idea',
      subject: 'Dark mode',
      senderUid: 'u1',
      senderName: 'Avery Quinn',
      senderEmail: 'avery@example.com',
      status: 'open',
      outcome: null,
      messageCount: 1,
      lastMessageBy: 'sender',
      adminUnread: true,
      senderUnread: false,
      closedAt: null,
    });
    expect(store.messages.get(`${id}/${id}`)).toMatchObject({
      seq: 1,
      authorRole: 'sender',
      authorUid: 'u1',
      text: 'Please add it',
    });
    expect(store.limits.get('u1')).toMatchObject({
      day: '2026-11-10',
      threadsToday: 1,
      messagesToday: 1,
    });
    expect(store.upserts.sort()).toEqual([
      `adm1/${notificationId('inbox_new', id, 'adm1')}`,
      `adm2/${notificationId('inbox_new', id, 'adm2')}`,
    ]);
  });

  it('never notifies the author when the sender is an admin', async () => {
    const { store, deps } = setup();
    const id = uuid();
    await sendInboxMessage(deps, { ...approved, uid: 'adm1' }, feedback(id));
    expect(store.upserts).toEqual([`adm2/${notificationId('inbox_new', id, 'adm2')}`]);
  });

  it('normalises the text and refuses empty or over-long text and subject (defence in depth)', async () => {
    const { store, deps } = setup();
    const id = uuid();
    await sendInboxMessage(deps, approved, feedback(id, { text: '  hi\u0000 there\u0007  ' }));
    expect(store.messages.get(`${id}/${id}`)!.text).toBe('hi there');
    for (const bad of [
      { text: '   ' },
      { text: 'x'.repeat(INBOX_LIMITS.text + 1) },
      { subject: ' \u0001 ' },
      { subject: 'x'.repeat(INBOX_LIMITS.subject + 1) },
    ]) {
      expect((await refusal(sendInboxMessage(deps, approved, feedback(uuid(), bad)))).code).toBe(
        'invalid-argument',
      );
    }
  });

  it('stores no email on a missing token field, and a photo over the limit is dropped', async () => {
    const { store, deps } = setup();
    const id = uuid();
    await sendInboxMessage(
      deps,
      { ...approved, email: null, displayName: null, photoURL: 'x'.repeat(3000) },
      feedback(id),
    );
    expect(store.threads.get(id)).toMatchObject({
      senderEmail: null,
      senderName: 'Someone',
      senderPhotoURL: null,
    });
  });

  it('the 5th new thread of the day passes and the 6th fails (3 open at once is checked separately)', async () => {
    const { store, deps } = setup();
    for (let i = 0; i < INBOX_LIMITS.feedbackThreadsPerDay; i += 1) {
      const id = uuid();
      await sendInboxMessage(deps, approved, feedback(id));
      // close it so the open-thread limit never applies
      store.threads.get(id)!.status = 'closed';
    }
    const error = await refusal(sendInboxMessage(deps, approved, feedback()));
    expect(error.code).toBe('resource-exhausted');
    expect(detail(error).reason).toBe('daily-thread-limit');
  });

  it('allows 3 open or answered threads and refuses the 4th; a closed one does not count', async () => {
    const { store, deps } = setup();
    const ids: string[] = [];
    for (let i = 0; i < INBOX_LIMITS.openFeedbackThreads; i += 1) {
      const id = uuid();
      ids.push(id);
      await sendInboxMessage(deps, approved, feedback(id));
    }
    store.threads.get(ids[0]!)!.status = 'answered';
    const error = await refusal(sendInboxMessage(deps, approved, feedback()));
    expect(detail(error).reason).toBe('open-thread-limit');
    store.threads.get(ids[0]!)!.status = 'closed';
    await expect(sendInboxMessage(deps, approved, feedback())).resolves.toBeDefined();
  });

  it('counts only the sender own open threads', async () => {
    const { deps } = setup();
    for (let i = 0; i < 3; i += 1) await sendInboxMessage(deps, approved, feedback());
    await expect(
      sendInboxMessage(deps, { ...approved, uid: 'u2' }, feedback()),
    ).resolves.toBeDefined();
  });

  it('refuses at 30 messages a day (the 30th passes) and resets on the next UTC day', async () => {
    const { store, deps, clock } = setup();
    store.threads.set('t1', thread({ senderUid: 'u1', kind: 'feedback' }));
    store.limits.set('u1', limits({ messagesToday: 29 }));
    await sendInboxMessage(deps, approved, reply('t1'));
    expect(store.limits.get('u1')!.messagesToday).toBe(30);
    const error = await refusal(sendInboxMessage(deps, approved, reply('t1')));
    expect(detail(error).reason).toBe('daily-message-limit');
    clock.now = new Date('2026-11-11T00:00:00.000Z');
    await sendInboxMessage(deps, approved, reply('t1'));
    expect(store.limits.get('u1')).toMatchObject({ day: '2026-11-11', messagesToday: 1 });
  });

  it('a blocked sender cannot send feedback; a pending sender can do nothing', async () => {
    const { store, deps } = setup();
    for (const who of [blocked, pending]) {
      const error = await refusal(sendInboxMessage(deps, who, feedback()));
      expect(error.code).toBe('permission-denied');
      expect(detail(error)).toMatchObject({
        reason: 'account-not-approved',
        status: who.accountStatus,
      });
      expect((await refusal(sendInboxMessage(deps, who, reply('t1')))).code).toBe(
        who === pending ? 'not-found' : 'not-found',
      );
    }
    expect(store.threads.size).toBe(0);
    expect(store.limits.size).toBe(0);
  });

  it('is idempotent by requestId: a retry changes nothing and notifies nobody again', async () => {
    const { store, deps } = setup();
    const id = uuid();
    await sendInboxMessage(deps, approved, feedback(id));
    const upserts = store.upserts.length;
    const limitsBefore = structuredClone(store.limits.get('u1'));
    expect(await sendInboxMessage(deps, approved, feedback(id))).toEqual({ threadId: id });
    expect(store.threads.size).toBe(1);
    expect(store.messages.size).toBe(1);
    expect(store.limits.get('u1')).toEqual(limitsBefore);
    expect(store.upserts.length).toBe(upserts);
  });

  it('a requestId already used by someone else, or for another kind, is already-exists', async () => {
    const { deps } = setup();
    const id = uuid();
    await sendInboxMessage(deps, approved, feedback(id));
    expect(
      (await refusal(sendInboxMessage(deps, { ...approved, uid: 'u2' }, feedback(id)))).code,
    ).toBe('already-exists');
    expect((await refusal(sendInboxMessage(deps, blocked, appeal(id)))).code).toBe(
      'already-exists',
    );
  });

  it('a failed notification never fails the send', async () => {
    const { store, deps } = setup();
    store.failUpsertFor = 'adm1';
    const id = uuid();
    await expect(sendInboxMessage(deps, approved, feedback(id))).resolves.toEqual({ threadId: id });
    expect(store.upserts).toEqual([`adm2/${notificationId('inbox_new', id, 'adm2')}`]);
  });

  it('a failing admin lookup never fails the send', async () => {
    const { auth, deps } = setup();
    auth.failList = true;
    await expect(sendInboxMessage(deps, approved, feedback())).resolves.toBeDefined();
  });
});

describe('sendInboxMessage: appeal', () => {
  it('a blocked sender opens an appeal: fixed subject, no category, 10 a day applies', async () => {
    const { store, deps } = setup();
    const id = uuid();
    await sendInboxMessage(deps, blocked, appeal(id));
    expect(store.threads.get(id)).toMatchObject({
      kind: 'appeal',
      subject: 'Appeal',
      category: null,
      outcome: null,
      status: 'open',
    });
    expect(store.limits.get('b1')).toMatchObject({ threadsToday: 0, messagesToday: 1 });
    expect(store.upserts).toHaveLength(2);
  });

  it('an approved or pending sender cannot appeal', async () => {
    const { store, deps } = setup();
    expect((await refusal(sendInboxMessage(deps, approved, appeal()))).code).toBe(
      'permission-denied',
    );
    const error = await refusal(sendInboxMessage(deps, pending, appeal()));
    expect(error.code).toBe('permission-denied');
    expect(store.threads.size).toBe(0);
  });

  it('a stale blocked token cannot open an appeal after an unblock', async () => {
    const { store, auth, deps } = setup();
    auth.statuses.set('b1', 'approved'); // unblocked; the token still says blocked
    const error = await refusal(sendInboxMessage(deps, blocked, appeal()));
    expect(error.code).toBe('failed-precondition');
    expect(store.threads.size).toBe(0);
  });

  it('a stale blocked token cannot reply on an appeal after an unblock', async () => {
    const { store, auth, deps } = setup();
    store.threads.set('a1', thread({ senderUid: 'b1', kind: 'appeal', status: 'answered' }));
    auth.statuses.set('b1', 'approved');
    const error = await refusal(sendInboxMessage(deps, blocked, reply('a1')));
    expect(error.code).toBe('failed-precondition');
    expect(store.messages.size).toBe(0);
  });

  it('only one open or answered appeal: already-exists with the thread id', async () => {
    const { store, deps } = setup();
    const id = uuid();
    await sendInboxMessage(deps, blocked, appeal(id));
    const error = await refusal(sendInboxMessage(deps, blocked, appeal()));
    expect(error.code).toBe('already-exists');
    expect(detail(error)).toMatchObject({ reason: 'appeal-open', threadId: id });
    store.threads.get(id)!.status = 'answered';
    expect(detail(await refusal(sendInboxMessage(deps, blocked, appeal()))).reason).toBe(
      'appeal-open',
    );
  });

  it('waits 7 days after a refused appeal: 1 ms short fails, exactly 7 days passes', async () => {
    const refused = new Date('2026-11-03T12:00:00.000Z');
    const { store, deps, clock } = setup(new Date('2026-11-10T11:59:59.999Z'));
    store.limits.set('b1', limits({ day: '2026-11-10', appealRefusedAt: refused }));
    const error = await refusal(sendInboxMessage(deps, blocked, appeal()));
    expect(error.code).toBe('resource-exhausted');
    expect(detail(error)).toMatchObject({
      reason: 'appeal-wait',
      retryAfter: '2026-11-10T12:00:00.000Z',
    });
    clock.now = new Date('2026-11-10T12:00:00.000Z');
    await expect(sendInboxMessage(deps, blocked, appeal())).resolves.toBeDefined();
    // the wait survives the daily reset
    expect(store.limits.get('b1')!.appealRefusedAt).toEqual(refused);
  });

  it('10 messages a day for a blocked account (the 10th passes, the 11th fails)', async () => {
    const { store, deps } = setup();
    store.limits.set('b1', limits({ messagesToday: 9 }));
    await sendInboxMessage(deps, blocked, appeal());
    store.threads.clear();
    const error = await refusal(sendInboxMessage(deps, blocked, appeal()));
    expect(detail(error).reason).toBe('daily-message-limit');
  });
});

describe('sendInboxMessage: reply', () => {
  it('a reply on an answered thread reopens it and marks it unread for admins', async () => {
    const { store, deps } = setup();
    store.threads.set(
      't1',
      thread({ status: 'answered', lastMessageBy: 'admin', messageCount: 2 }),
    );
    const rid = uuid();
    const result = await sendInboxMessage(deps, approved, reply('t1', rid, 'Thanks'));
    expect(result).toEqual({ threadId: 't1', status: 'open' });
    expect(store.threads.get('t1')).toMatchObject({
      status: 'open',
      messageCount: 3,
      adminUnread: true,
      lastMessageBy: 'sender',
      lastSnippet: 'Thanks',
    });
    expect(store.messages.get(`t1/${rid}`)).toMatchObject({ seq: 3, authorRole: 'sender' });
    expect(store.upserts).toHaveLength(2);
  });

  it("someone else's thread, or a missing one, is not-found and reveals nothing", async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread({ senderUid: 'someone-else' }));
    const other = await refusal(sendInboxMessage(deps, approved, reply('t1')));
    const missing = await refusal(sendInboxMessage(deps, approved, reply('nope')));
    expect(other.code).toBe('not-found');
    expect(other.message).toBe(missing.message);
    expect(store.messages.size).toBe(0);
  });

  it('a blocked sender cannot reply to their own feedback thread; an approved one not to an appeal', async () => {
    const { store, deps } = setup();
    store.threads.set('f1', thread({ senderUid: 'b1', kind: 'feedback' }));
    store.threads.set('a1', thread({ senderUid: 'u1', kind: 'appeal' }));
    expect(detail(await refusal(sendInboxMessage(deps, blocked, reply('f1')))).reason).toBe(
      'account-not-approved',
    );
    expect(detail(await refusal(sendInboxMessage(deps, approved, reply('a1')))).reason).toBe(
      'account-not-approved',
    );
    expect(store.messages.size).toBe(0);
  });

  it('a blocked sender replies on their own appeal', async () => {
    const { store, deps } = setup();
    store.threads.set('a1', thread({ senderUid: 'b1', kind: 'appeal', status: 'answered' }));
    await sendInboxMessage(deps, blocked, reply('a1'));
    expect(store.threads.get('a1')!.status).toBe('open');
  });

  it('refuses a closed thread (reason closed)', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread({ status: 'closed', closedAt: new Date() }));
    const error = await refusal(sendInboxMessage(deps, approved, reply('t1')));
    expect(error.code).toBe('failed-precondition');
    expect(detail(error).reason).toBe('closed');
  });

  it('199 messages passes (the 200th), and a full thread refuses', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread({ messageCount: 199 }));
    await sendInboxMessage(deps, approved, reply('t1'));
    expect(store.threads.get('t1')!.messageCount).toBe(200);
    const error = await refusal(sendInboxMessage(deps, approved, reply('t1')));
    expect(detail(error).reason).toBe('thread-full');
  });

  it('is idempotent by requestId; the same id from another author is already-exists', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread());
    const rid = uuid();
    await sendInboxMessage(deps, approved, reply('t1', rid));
    const upserts = store.upserts.length;
    const counted = store.limits.get('u1')!.messagesToday;
    expect(await sendInboxMessage(deps, approved, reply('t1', rid))).toEqual({
      threadId: 't1',
      status: 'open',
    });
    expect(store.messages.size).toBe(1);
    expect(store.limits.get('u1')!.messagesToday).toBe(counted);
    expect(store.upserts.length).toBe(upserts);
    store.messages.set('t1/adm-msg', adminMsg(2));
    expect((await refusal(sendInboxMessage(deps, approved, reply('t1', 'adm-msg')))).code).toBe(
      'already-exists',
    );
  });

  it('a retry of a delivered reply still succeeds after an admin closed the thread', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread());
    const rid = uuid();
    await sendInboxMessage(deps, approved, reply('t1', rid));
    store.threads.get('t1')!.status = 'closed';
    await expect(sendInboxMessage(deps, approved, reply('t1', rid))).resolves.toMatchObject({
      threadId: 't1',
    });
  });
});

describe('manageInboxThread: reply', () => {
  it('stores no admin identity, answers the thread, audits the admin, notifies a feedback sender', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread({ senderUid: 'u1' }));
    const rid = uuid();
    const result = await manageInboxThread(deps, adm, {
      action: 'reply',
      threadId: 't1',
      requestId: rid,
      text: 'On it',
    });
    expect(result).toEqual({ threadId: 't1', status: 'answered' });
    const message = store.messages.get(`t1/${rid}`)!;
    expect(message).toMatchObject({
      seq: 2,
      authorRole: 'admin',
      authorUid: null,
      authorName: null,
      authorPhotoURL: null,
    });
    expect(store.threads.get('t1')).toMatchObject({
      status: 'answered',
      senderUnread: true,
      adminUnread: false,
      lastMessageBy: 'admin',
    });
    expect(store.audit.get(`t1/${rid}`)).toMatchObject({ adminUid: 'adm1', action: 'reply' });
    const card = store.notifications.get(`u1/${notificationId('inbox_reply', 't1', 'u1')}`)!;
    expect(card).toMatchObject({
      kind: 'inbox_reply',
      actorId: 'u1',
      actorName: INBOX_ADMIN_LABEL,
      actorPhotoURL: null,
      itemId: 't1',
      readAt: null,
    });
  });

  it('nothing the sender can read mentions the admin (no uid, no name) and no email in cards', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread({ senderUid: 'u1', senderEmail: 'avery@example.com' }));
    await manageInboxThread(
      deps,
      { uid: 'adm-secret-uid' },
      {
        action: 'reply',
        threadId: 't1',
        requestId: uuid(),
        text: 'Hello',
      },
    );
    await manageInboxThread(deps, { uid: 'adm-secret-uid' }, { action: 'close', threadId: 't1' });
    const senderReadable = JSON.stringify([
      [...store.threads.values()],
      [...store.messages.values()],
      [...store.notifications.entries()].filter(([k]) => k.startsWith('u1/')),
    ]);
    expect(senderReadable).not.toContain('adm-secret-uid');
    // senderEmail is on the thread only, never copied into a card
    expect(JSON.stringify([...store.notifications.values()])).not.toContain('avery@example.com');
    // the audit (admin-only) is where the admin lives
    expect(JSON.stringify([...store.audit.values()])).toContain('adm-secret-uid');
  });

  it('no bell for an appeal sender, nor when the admin wrote the feedback themselves', async () => {
    const { store, deps } = setup();
    store.threads.set('a1', thread({ kind: 'appeal', senderUid: 'b1' }));
    store.threads.set('f1', thread({ kind: 'feedback', senderUid: 'adm1' }));
    for (const threadId of ['a1', 'f1']) {
      await manageInboxThread(deps, adm, {
        action: 'reply',
        threadId,
        requestId: uuid(),
        text: 'Hi',
      });
    }
    expect(store.upserts).toEqual([]);
  });

  it('a repeated reply (same requestId) writes and notifies nothing more', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread());
    const input = { action: 'reply', threadId: 't1', requestId: uuid(), text: 'Hi' } as const;
    await manageInboxThread(deps, adm, input);
    const upserts = store.upserts.length;
    await manageInboxThread(deps, adm, input);
    expect(store.messages.size).toBe(1);
    expect(store.threads.get('t1')!.messageCount).toBe(2);
    expect(store.upserts.length).toBe(upserts);
  });

  it('refuses closed, full and missing threads, and a requestId used by the sender', async () => {
    const { store, deps } = setup();
    store.threads.set('c', thread({ status: 'closed' }));
    store.threads.set('f', thread({ messageCount: 200 }));
    store.threads.set('s', thread());
    store.messages.set('s/mine', senderMsg(1));
    const go = (threadId: string, requestId = uuid()) =>
      manageInboxThread(deps, adm, { action: 'reply', threadId, requestId, text: 'x' });
    expect(detail(await refusal(go('c'))).reason).toBe('closed');
    expect(detail(await refusal(go('f'))).reason).toBe('thread-full');
    expect((await refusal(go('zzz'))).code).toBe('not-found');
    expect((await refusal(go('s', 'mine'))).code).toBe('already-exists');
  });

  it('has no daily cap', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread());
    store.limits.set('adm1', limits({ messagesToday: 999 }));
    await expect(
      manageInboxThread(deps, adm, {
        action: 'reply',
        threadId: 't1',
        requestId: uuid(),
        text: 'x',
      }),
    ).resolves.toBeDefined();
  });
});

describe('manageInboxThread: close and reopen', () => {
  it('closes feedback (adminUnread off, audit) and a repeat is a no-op', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread());
    expect(await manageInboxThread(deps, adm, { action: 'close', threadId: 't1' })).toEqual({
      threadId: 't1',
      status: 'closed',
    });
    expect(store.threads.get('t1')).toMatchObject({ status: 'closed', adminUnread: false });
    expect(store.threads.get('t1')!.closedAt).toBeInstanceOf(Date);
    expect([...store.audit.values()]).toMatchObject([{ adminUid: 'adm1', action: 'close' }]);
    await manageInboxThread(deps, adm, { action: 'close', threadId: 't1' });
    expect(store.audit.size).toBe(1);
  });

  it('refuses to close an appeal directly', async () => {
    const { store, deps } = setup();
    store.threads.set('a1', thread({ kind: 'appeal', senderUid: 'b1' }));
    expect(
      (await refusal(manageInboxThread(deps, adm, { action: 'close', threadId: 'a1' }))).code,
    ).toBe('failed-precondition');
  });

  it('reopen restores open (sender spoke last) or answered (admin spoke last) and clears closedAt/outcome', async () => {
    const { store, deps } = setup();
    store.threads.set(
      's',
      thread({ status: 'closed', lastMessageBy: 'sender', closedAt: new Date() }),
    );
    store.threads.set(
      'a',
      thread({ status: 'closed', lastMessageBy: 'admin', closedAt: new Date() }),
    );
    expect((await manageInboxThread(deps, adm, { action: 'reopen', threadId: 's' })).status).toBe(
      'open',
    );
    expect((await manageInboxThread(deps, adm, { action: 'reopen', threadId: 'a' })).status).toBe(
      'answered',
    );
    expect(store.threads.get('s')).toMatchObject({ closedAt: null, outcome: null });
  });

  it('reopen on a thread that is not closed changes nothing', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread());
    expect((await manageInboxThread(deps, adm, { action: 'reopen', threadId: 't1' })).status).toBe(
      'open',
    );
    expect(store.audit.size).toBe(0);
  });

  it('reopening an appeal needs a still-blocked sender and no other open appeal, and clears the wait', async () => {
    const { store, auth, deps } = setup();
    const upheld = thread({
      kind: 'appeal',
      senderUid: 'b1',
      status: 'closed',
      outcome: 'upheld',
      closedAt: new Date(),
      lastMessageBy: 'admin',
    });
    store.threads.set('a1', upheld);
    store.limits.set('b1', limits({ appealRefusedAt: new Date('2026-11-09T00:00:00Z') }));

    auth.statuses.set('b1', 'approved');
    expect(
      (await refusal(manageInboxThread(deps, adm, { action: 'reopen', threadId: 'a1' }))).code,
    ).toBe('failed-precondition');

    auth.statuses.set('b1', 'blocked');
    store.threads.set('a2', thread({ kind: 'appeal', senderUid: 'b1', status: 'open' }));
    expect(
      detail(await refusal(manageInboxThread(deps, adm, { action: 'reopen', threadId: 'a1' })))
        .reason,
    ).toBe('appeal-open');

    store.threads.delete('a2');
    const result = await manageInboxThread(deps, adm, { action: 'reopen', threadId: 'a1' });
    expect(result.status).toBe('answered');
    expect(store.limits.get('b1')!.appealRefusedAt).toBeNull();
    expect(store.threads.get('a1')).toMatchObject({ outcome: null, closedAt: null });
  });
});

describe('manageInboxThread: keepBlocked', () => {
  const upheldSetup = () => {
    const s = setup();
    s.store.threads.set('a1', thread({ kind: 'appeal', senderUid: 'b1', messageCount: 1 }));
    s.auth.statuses.set('b1', 'blocked');
    return s;
  };

  it('adds the final message, closes as upheld and starts the 7 day wait', async () => {
    const { store, deps } = upheldSetup();
    const rid = uuid();
    const result = await manageInboxThread(deps, adm, {
      action: 'keepBlocked',
      threadId: 'a1',
      requestId: rid,
      text: 'Not accepted',
    });
    expect(result).toEqual({ threadId: 'a1', status: 'closed' });
    expect(store.threads.get('a1')).toMatchObject({
      status: 'closed',
      outcome: 'upheld',
      messageCount: 2,
      senderUnread: true,
      adminUnread: false,
      lastMessageBy: 'admin',
    });
    expect(store.messages.get(`a1/${rid}`)).toMatchObject({ authorRole: 'admin', authorUid: null });
    expect(store.limits.get('b1')!.appealRefusedAt).toEqual(new Date('2026-11-10T12:00:00.000Z'));
    expect([...store.audit.values()]).toMatchObject([{ adminUid: 'adm1', action: 'keepBlocked' }]);
    expect(store.upserts).toEqual([]);
  });

  it('works without a message, and a repeat of it is a no-op', async () => {
    const { store, deps } = upheldSetup();
    const input = { action: 'keepBlocked', threadId: 'a1' } as const;
    await manageInboxThread(deps, adm, input);
    expect(store.threads.get('a1')).toMatchObject({ outcome: 'upheld', messageCount: 1 });
    expect(await manageInboxThread(deps, adm, input)).toEqual({ threadId: 'a1', status: 'closed' });
    expect(store.audit.size).toBe(1);
  });

  it('a repeat with the same requestId writes no second message', async () => {
    const { store, deps } = upheldSetup();
    const input = { action: 'keepBlocked', threadId: 'a1', requestId: uuid(), text: 'No' } as const;
    await manageInboxThread(deps, adm, input);
    await manageInboxThread(deps, adm, input);
    expect(store.messages.size).toBe(1);
  });

  it('refuses feedback, closed appeals and an appeal whose sender is no longer blocked', async () => {
    const { store, auth, deps } = upheldSetup();
    store.threads.set('f1', thread({ kind: 'feedback' }));
    store.threads.set(
      'c1',
      thread({ kind: 'appeal', senderUid: 'b1', status: 'closed', outcome: 'unblocked' }),
    );
    const go = (threadId: string) =>
      manageInboxThread(deps, adm, { action: 'keepBlocked', threadId });
    expect((await refusal(go('f1'))).code).toBe('failed-precondition');
    expect(detail(await refusal(go('c1'))).reason).toBe('closed');
    auth.statuses.set('b1', 'approved');
    expect((await refusal(go('a1'))).code).toBe('failed-precondition');
    expect(store.limits.size).toBe(0);
  });

  it('a final message on a full thread is refused', async () => {
    const { store, deps } = upheldSetup();
    store.threads.get('a1')!.messageCount = 200;
    const error = await refusal(
      manageInboxThread(deps, adm, {
        action: 'keepBlocked',
        threadId: 'a1',
        requestId: uuid(),
        text: 'x',
      }),
    );
    expect(detail(error).reason).toBe('thread-full');
  });
});

describe('closeOpenAppeals (unblock)', () => {
  it('closes open and answered appeals as unblocked, audits system:unblock, spares the rest', async () => {
    const { store, deps } = setup();
    store.threads.set('o', thread({ kind: 'appeal', senderUid: 'b1', status: 'open' }));
    store.threads.set('a', thread({ kind: 'appeal', senderUid: 'b1', status: 'answered' }));
    store.threads.set(
      'c',
      thread({ kind: 'appeal', senderUid: 'b1', status: 'closed', outcome: 'upheld' }),
    );
    store.threads.set('f', thread({ kind: 'feedback', senderUid: 'b1', status: 'open' }));
    store.threads.set('x', thread({ kind: 'appeal', senderUid: 'other', status: 'open' }));
    expect(await closeOpenAppeals(deps, 'b1')).toBe(2);
    for (const id of ['o', 'a']) {
      expect(store.threads.get(id)).toMatchObject({
        status: 'closed',
        outcome: 'unblocked',
        adminUnread: false,
      });
    }
    expect(store.threads.get('c')!.outcome).toBe('upheld');
    expect(store.threads.get('f')!.status).toBe('open');
    expect(store.threads.get('x')!.status).toBe('open');
    expect([...store.audit.values()].map((e) => e.adminUid)).toEqual([
      SYSTEM_UNBLOCK,
      SYSTEM_UNBLOCK,
    ]);
    expect(store.upserts).toEqual([]);
  });

  it('does nothing when there is no open appeal', async () => {
    const { store, deps } = setup();
    expect(await closeOpenAppeals(deps, 'b1')).toBe(0);
    expect(store.audit.size).toBe(0);
  });
});

describe('deleteThread', () => {
  it('removes messages, audit, note, thread and the cards of every admin and the sender; keeps the limits', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread({ senderUid: 'u1' }));
    store.threads.set('t2', thread({ senderUid: 'u1' }));
    store.messages.set('t1/m1', senderMsg(1));
    store.messages.set('t2/m1', senderMsg(1));
    store.audit.set('t1/e1', { adminUid: 'adm1', action: 'close', createdAt: new Date() });
    store.notes.add('t1');
    store.limits.set('u1', limits());
    for (const uid of ['adm1', 'adm2', 'u1']) {
      store.notifications.set(`${uid}/${notificationId('inbox_new', 't1', uid)}`, card());
      store.notifications.set(`${uid}/${notificationId('inbox_reply', 't1', uid)}`, card());
      store.notifications.set(`${uid}/${notificationId('inbox_new', 't2', uid)}`, card());
    }
    expect(await deleteThread(deps, 't1')).toBe(true);
    expect(store.threads.has('t1')).toBe(false);
    expect(store.threads.has('t2')).toBe(true);
    expect([...store.messages.keys()]).toEqual(['t2/m1']);
    expect(store.audit.size).toBe(0);
    expect(store.notes.has('t1')).toBe(false);
    expect([...store.notifications.keys()].every((k) => k.includes('t2'))).toBe(true);
    expect(store.notifications.size).toBe(3);
    expect(store.limits.has('u1')).toBe(true);
  });

  it('also deletes the card of a former admin who was notified of the thread', async () => {
    const { store, auth, deps } = setup();
    const id = uuid();
    await sendInboxMessage(deps, approved, feedback(id));
    const formerKey = `adm2/${notificationId('inbox_new', id, 'adm2')}`;
    expect(store.notifications.has(formerKey)).toBe(true);
    expect([...store.notified.get(id)!].sort()).toEqual(['adm1', 'adm2']);
    auth.admins = ['adm1']; // adm2 lost the role since
    await deleteThread(deps, id);
    expect(store.notifications.size).toBe(0);
    expect(store.notified.has(id)).toBe(false);
  });

  it('deletes in batches of at most 400 until empty, and the thread document last', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread());
    for (let i = 0; i < 950; i += 1) store.messages.set(`t1/m${i}`, senderMsg(1));
    await deleteThread(deps, 't1');
    const msgs = store.deleteBatches.filter((b) => b.what === 'messages');
    expect(msgs).toHaveLength(3);
    expect(msgs.every((b) => b.limit <= 400)).toBe(true);
    expect(store.messages.size).toBe(0);
    expect(store.threads.size).toBe(0);
  });

  it('is idempotent for a missing thread and still cleans up', async () => {
    const { store, deps } = setup();
    store.messages.set('gone/m1', senderMsg(1));
    expect(await deleteThread(deps, 'gone')).toBe(false);
    expect(store.messages.size).toBe(0);
  });

  it('manageInboxThread delete returns a null status', async () => {
    const { store, deps } = setup();
    store.threads.set('t1', thread());
    expect(await manageInboxThread(deps, adm, { action: 'delete', threadId: 't1' })).toEqual({
      threadId: 't1',
      status: null,
    });
    expect(store.threads.size).toBe(0);
  });

  it('chunks notification deletes under the batch limit', async () => {
    const { store, auth, deps } = setup();
    auth.admins = Array.from({ length: 500 }, (_, i) => `adm${i}`);
    store.threads.set('t1', thread());
    await deleteThread(deps, 't1');
    expect(store.deletedNotificationBatches.every((n) => n <= 400)).toBe(true);
    expect(store.deletedNotificationBatches.reduce((a, b) => a + b, 0)).toBe(1002);
  });
});

describe('notification cards', () => {
  it('a second message overwrites the card (same id) and turns it unread again', async () => {
    const { store, deps } = setup();
    const id = uuid();
    await sendInboxMessage(deps, approved, feedback(id));
    const key = `adm2/${notificationId('inbox_new', id, 'adm2')}`;
    expect(store.notifications.get(key)).toMatchObject({
      kind: 'inbox_new',
      actorId: 'u1',
      actorName: 'Avery Quinn',
      workspaceId: 'account',
      boardId: 'account',
      itemId: id,
      itemName: 'Dark mode',
      snippet: 'Please add it',
      readAt: null,
    });
    await sendInboxMessage(deps, approved, reply(id, uuid(), 'Any news?'));
    expect(store.notifications.size).toBe(2);
    expect(store.notifications.get(key)!.snippet).toBe('Any news?');
  });
});

// -- fixtures ------------------------------------------------------------------------------------

function thread(over: Partial<ThreadData> = {}): ThreadData {
  const at = new Date('2026-11-09T10:00:00.000Z');
  return {
    kind: 'feedback',
    category: 'idea',
    subject: 'Dark mode',
    senderUid: 'u1',
    senderName: 'Avery Quinn',
    senderEmail: 'avery@example.com',
    senderPhotoURL: null,
    status: 'open' as InboxStatus,
    outcome: null,
    messageCount: 1,
    lastMessageAt: at,
    lastMessageBy: 'sender',
    lastSnippet: 'hi',
    adminUnread: true,
    senderUnread: false,
    createdAt: at,
    updatedAt: at,
    closedAt: null,
    ...over,
  };
}

function limits(over: Partial<LimitsData> = {}): LimitsData {
  return {
    day: '2026-11-10',
    threadsToday: 0,
    messagesToday: 0,
    appealRefusedAt: null,
    updatedAt: new Date('2026-11-10T01:00:00.000Z'),
    ...over,
  };
}

function senderMsg(seq: number): MessageData {
  return {
    seq,
    authorRole: 'sender',
    authorUid: 'u1',
    authorName: 'Avery Quinn',
    authorPhotoURL: null,
    text: 'hi',
    createdAt: new Date(),
  };
}

function adminMsg(seq: number): MessageData {
  return {
    seq,
    authorRole: 'admin',
    authorUid: null,
    authorName: null,
    authorPhotoURL: null,
    text: 'hello',
    createdAt: new Date(),
  };
}

function card(): NewNotification & { readAt: null } {
  return {
    kind: 'inbox_new',
    actorId: 'x',
    actorName: 'x',
    actorPhotoURL: null,
    workspaceId: 'account',
    boardId: 'account',
    boardName: '',
    itemId: 't',
    itemName: '',
    updateId: null,
    replyId: null,
    columnId: null,
    snippet: '',
    readAt: null,
  };
}
