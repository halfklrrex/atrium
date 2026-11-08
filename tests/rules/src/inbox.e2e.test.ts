import {
  assertFails,
  assertSucceeds,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AdminAccountModule from '../../../functions/src/lib/admin-account';
import { createTestEnv } from './helpers';

/**
 * End to end against the Firestore emulator (ADMIN-4 PR4): the real `sendInboxMessage` and
 * `manageInboxThread` handlers, with the real Admin SDK adapters, run with ID tokens that carry each
 * account state (`.run`, no Functions emulator). Results are read back through the real rules with a
 * sender token, which is what proves the sender never sees the admin. The Auth lookups (admin uids,
 * account status) go through a fake, because `test:rules` starts no Auth emulator.
 * Runs through `pnpm test:rules`.
 */

const auth = vi.hoisted(() => ({
  admins: ['admin1'] as string[],
  claims: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../../../functions/src/lib/admin-account', async (importOriginal) => {
  const original = await importOriginal<typeof AdminAccountModule>();
  return {
    ...original,
    adminAccountAuth: () => ({
      getUser: (uid: string) =>
        Promise.resolve(auth.claims.has(uid) ? { uid, claims: auth.claims.get(uid) } : null),
      listAdminUids: () => Promise.resolve(auth.admins),
    }),
  };
});

interface Details {
  reason?: string;
  retryAfter?: string;
  threadId?: string;
}
type Callable = { run: (request: CallableRequest<unknown>) => Promise<unknown> };
let send: Callable;
let manage: Callable;
let env: RulesTestEnvironment;

const APPROVED = { acct: 'approved' };
const BLOCKED = { acct: 'blocked' };
const ADMIN = { acct: 'approved', admin: true };

const request = (uid: string, claims: Record<string, unknown>, data: unknown) =>
  ({
    data,
    auth: {
      uid,
      token: {
        email: `${uid}@example.com`,
        email_verified: true,
        name: `Person ${uid}`,
        ...claims,
      },
    },
    rawRequest: {},
    acceptsStreaming: false,
  }) as unknown as CallableRequest;

const sendAs = (uid: string, claims: Record<string, unknown>, data: unknown) =>
  send.run(request(uid, claims, data)) as Promise<{ threadId: string; status?: string }>;
const manageAs = (data: unknown, uid = 'admin1', claims: Record<string, unknown> = ADMIN) =>
  manage.run(request(uid, claims, data)) as Promise<{ threadId: string; status: string | null }>;

async function failure(promise: Promise<unknown>): Promise<{ code: string; details: Details }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; details: Details };
  }
  throw new Error('expected the callable to refuse');
}

const rid = () => crypto.randomUUID();
const feedback = (over: Record<string, unknown> = {}) => ({
  action: 'feedback',
  requestId: rid(),
  category: 'bug',
  subject: 'Broken thing',
  text: 'It does not work',
  ...over,
});
const appeal = (over: Record<string, unknown> = {}) => ({
  action: 'appeal',
  requestId: rid(),
  text: 'Please unblock me',
  ...over,
});

const asUser = (uid: string, claims: Record<string, unknown>) =>
  env.authenticatedContext(uid, claims).firestore();

async function adminRead<T>(fn: (ctx: RulesTestContext) => Promise<T>) {
  let out!: T;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = await fn(ctx);
  });
  return out;
}

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  send = (await import('../../../functions/src/callable/sendInboxMessage'))
    .sendInboxMessage as unknown as Callable;
  manage = (await import('../../../functions/src/callable/manageInboxThread'))
    .manageInboxThread as unknown as Callable;
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  auth.admins = ['admin1'];
  auth.claims = new Map([
    ['admin1', ADMIN],
    ['blocked1', BLOCKED],
    ['user1', APPROVED],
    ['user2', APPROVED],
  ]);
});

const cards = (uid: string) =>
  adminRead(async (ctx) => {
    const snap = await getDocs(collection(ctx.firestore(), 'users', uid, 'notifications'));
    return snap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string },
    );
  });

describe('a blocked token', () => {
  it('can appeal and read its thread and messages through the rules', async () => {
    const { threadId } = await sendAs('blocked1', BLOCKED, appeal());
    const db = asUser('blocked1', BLOCKED);
    const thread = await assertSucceeds(getDoc(doc(db, 'inbox', threadId)));
    expect(thread.data()).toMatchObject({ kind: 'appeal', senderUid: 'blocked1', status: 'open' });
    const messages = await assertSucceeds(getDocs(collection(db, 'inbox', threadId, 'messages')));
    expect(messages.size).toBe(1);
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'inbox'),
          where('senderUid', '==', 'blocked1'),
          where('kind', '==', 'appeal'),
        ),
      ),
    );
  });

  it('cannot send feedback or open a second appeal, and can reply on its appeal', async () => {
    const first = await sendAs('blocked1', BLOCKED, appeal());
    const noFeedback = await failure(sendAs('blocked1', BLOCKED, feedback()));
    expect(noFeedback.code).toBe('permission-denied');
    expect(noFeedback.details.reason).toBe('account-not-approved');
    const second = await failure(sendAs('blocked1', BLOCKED, appeal()));
    expect(second.code).toBe('already-exists');
    expect(second.details).toMatchObject({ reason: 'appeal-open', threadId: first.threadId });
    await sendAs('blocked1', BLOCKED, {
      action: 'reply',
      threadId: first.threadId,
      requestId: rid(),
      text: 'More details',
    });
    const thread = await adminRead((ctx) => getDoc(doc(ctx.firestore(), 'inbox', first.threadId)));
    expect(thread.data()).toMatchObject({ messageCount: 2 });
  });

  it('cannot touch inboxLimits, inboxAudit or an admin note from the client', async () => {
    const { threadId } = await sendAs('blocked1', BLOCKED, appeal());
    const db = asUser('blocked1', BLOCKED);
    await assertFails(getDoc(doc(db, 'inboxLimits', 'blocked1')));
    await assertFails(getDocs(collection(db, 'inboxAudit', threadId, 'entries')));
    await assertFails(getDoc(doc(db, 'inboxNotes', threadId)));
  });
});

describe('an approved token', () => {
  it('sends feedback and reads it; the daily counters are written', async () => {
    const { threadId } = await sendAs('user1', APPROVED, feedback());
    const snap = await assertSucceeds(getDoc(doc(asUser('user1', APPROVED), 'inbox', threadId)));
    expect(snap.data()).toMatchObject({
      kind: 'feedback',
      category: 'bug',
      senderEmail: 'user1@example.com',
    });
    const limits = await adminRead((ctx) => getDoc(doc(ctx.firestore(), 'inboxLimits', 'user1')));
    expect(limits.data()).toMatchObject({ threadsToday: 1, messagesToday: 1 });
  });

  it('cannot appeal, and a pending or claim-less token cannot do anything', async () => {
    expect((await failure(sendAs('user1', APPROVED, appeal()))).code).toBe('permission-denied');
    for (const claims of [{}, { acct: 'maybe' }]) {
      const error = await failure(sendAs('user1', claims, feedback()));
      expect(error.code).toBe('permission-denied');
      expect(error.details.reason).toBe('account-not-approved');
    }
  });

  it('an approved user cannot reply to, or learn about, someone else thread', async () => {
    const { threadId } = await sendAs('user1', APPROVED, feedback());
    const error = await failure(
      sendAs('user2', APPROVED, { action: 'reply', threadId, requestId: rid(), text: 'hi' }),
    );
    expect(error.code).toBe('not-found');
    const missing = await failure(
      sendAs('user2', APPROVED, {
        action: 'reply',
        threadId: 'nope',
        requestId: rid(),
        text: 'hi',
      }),
    );
    expect(missing.code).toBe('not-found');
    await assertFails(getDoc(doc(asUser('user2', APPROVED), 'inbox', threadId)));
    const thread = await adminRead((ctx) => getDoc(doc(ctx.firestore(), 'inbox', threadId)));
    expect(thread.data()).toMatchObject({ messageCount: 1 });
  });

  it('allows 3 open feedback threads and refuses the 4th, also under parallel sends', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => sendAs('user1', APPROVED, feedback())),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(3);
    expect(refused.every((r) => r.reason.details?.reason === 'open-thread-limit')).toBe(true);
    const threads = await adminRead((ctx) =>
      getDocs(query(collection(ctx.firestore(), 'inbox'), where('senderUid', '==', 'user1'))),
    );
    expect(threads.size).toBe(3);
  });

  it('is idempotent by requestId: a retry creates no second thread, message or card', async () => {
    const data = feedback();
    const first = await sendAs('user1', APPROVED, data);
    const second = await sendAs('user1', APPROVED, data);
    expect(second.threadId).toBe(first.threadId);
    const threads = await adminRead((ctx) => getDocs(collection(ctx.firestore(), 'inbox')));
    expect(threads.size).toBe(1);
    const messages = await adminRead((ctx) =>
      getDocs(collection(ctx.firestore(), 'inbox', first.threadId, 'messages')),
    );
    expect(messages.size).toBe(1);
    expect(await cards('admin1')).toHaveLength(1);
  });

  it('keeps one bell card per thread for the admin: a later message overwrites it', async () => {
    const { threadId } = await sendAs('user1', APPROVED, feedback());
    const before = await cards('admin1');
    await sendAs('user1', APPROVED, {
      action: 'reply',
      threadId,
      requestId: rid(),
      text: 'Any news?',
    });
    const after = await cards('admin1');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      kind: 'inbox_new',
      itemId: threadId,
      snippet: 'Any news?',
      readAt: null,
    });
    expect(after[0]!.id).toBe(before[0]!.id);
  });
});

describe('manageInboxThread', () => {
  it('refuses non-admins, even with a forged admin field in the data or an admin claim string', async () => {
    const { threadId } = await sendAs('user1', APPROVED, feedback());
    const data = { action: 'close', threadId };
    for (const [claims, extra] of [
      [APPROVED, {}],
      [APPROVED, { admin: true }],
      [{ acct: 'approved', admin: 'true' }, {}],
      [BLOCKED, {}],
      [{}, {}],
    ] as const) {
      const error = await failure(manageAs({ ...data, ...extra }, 'user1', { ...claims }));
      expect(error.code).toBe('permission-denied');
    }
    const thread = await adminRead((ctx) => getDoc(doc(ctx.firestore(), 'inbox', threadId)));
    expect(thread.data()).toMatchObject({ status: 'open' });
  });

  it('an admin reply reaches the sender with no trace of the admin, and the audit is admin-only', async () => {
    const { threadId } = await sendAs('user1', APPROVED, feedback());
    const requestId = rid();
    await manageAs({ action: 'reply', threadId, requestId, text: 'Fixed, thanks' });

    const user = asUser('user1', APPROVED);
    const message = await assertSucceeds(
      getDoc(doc(user, 'inbox', threadId, 'messages', requestId)),
    );
    expect(message.data()).toMatchObject({
      authorRole: 'admin',
      authorUid: null,
      authorName: null,
      authorPhotoURL: null,
    });
    const thread = await assertSucceeds(getDoc(doc(user, 'inbox', threadId)));
    expect(thread.data()).toMatchObject({ status: 'answered', senderUnread: true });

    const senderCards = await assertSucceeds(
      getDocs(collection(user, 'users', 'user1', 'notifications')),
    );
    expect(senderCards.size).toBe(1);
    expect(senderCards.docs[0]!.data()).toMatchObject({
      kind: 'inbox_reply',
      actorId: 'user1',
      actorName: 'Site Administrator',
      actorPhotoURL: null,
      readAt: null,
    });

    // Everything the sender can read, serialised: no admin uid, and no email inside the card.
    const readable = JSON.stringify([message.data(), thread.data(), senderCards.docs[0]!.data()]);
    expect(readable).not.toContain('admin1');
    expect(JSON.stringify(senderCards.docs[0]!.data())).not.toContain('@example.com');

    await assertFails(getDocs(collection(user, 'inboxAudit', threadId, 'entries')));
    const audit = await adminRead((ctx) =>
      getDoc(doc(ctx.firestore(), 'inboxAudit', threadId, 'entries', requestId)),
    );
    expect(audit.data()).toMatchObject({ adminUid: 'admin1', action: 'reply' });
  });

  it('a sender reply to an answered thread reopens it', async () => {
    const { threadId } = await sendAs('user1', APPROVED, feedback());
    await manageAs({ action: 'reply', threadId, requestId: rid(), text: 'Hi' });
    const result = await sendAs('user1', APPROVED, {
      action: 'reply',
      threadId,
      requestId: rid(),
      text: 'Thanks',
    });
    expect(result.status).toBe('open');
  });

  it('close locks the thread for the sender; reopen unlocks it', async () => {
    const { threadId } = await sendAs('user1', APPROVED, feedback());
    await manageAs({ action: 'close', threadId });
    const reply = { action: 'reply', threadId, requestId: rid(), text: 'Still there?' };
    const closed = await failure(sendAs('user1', APPROVED, reply));
    expect(closed.details.reason).toBe('closed');
    await manageAs({ action: 'reopen', threadId });
    await expect(sendAs('user1', APPROVED, { ...reply, requestId: rid() })).resolves.toBeDefined();
  });

  it('keepBlocked closes as upheld and starts the wait; reopen clears it', async () => {
    const { threadId } = await sendAs('blocked1', BLOCKED, appeal());
    const requestId = rid();
    await manageAs({ action: 'keepBlocked', threadId, requestId, text: 'Not accepted' });
    const db = asUser('blocked1', BLOCKED);
    const thread = await assertSucceeds(getDoc(doc(db, 'inbox', threadId)));
    expect(thread.data()).toMatchObject({ status: 'closed', outcome: 'upheld' });
    const wait = await failure(sendAs('blocked1', BLOCKED, appeal()));
    expect(wait.code).toBe('resource-exhausted');
    expect(wait.details.reason).toBe('appeal-wait');
    expect(Date.parse(wait.details.retryAfter ?? '')).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    // an appellant gets no bell card
    expect(await cards('blocked1')).toHaveLength(0);

    await manageAs({ action: 'reopen', threadId });
    const limits = await adminRead((ctx) =>
      getDoc(doc(ctx.firestore(), 'inboxLimits', 'blocked1')),
    );
    expect(limits.data()!.appealRefusedAt).toBeNull();
  });

  it('delete removes the thread, messages, audit, note and cards but keeps the limits', async () => {
    const { threadId } = await sendAs('user1', APPROVED, feedback());
    await manageAs({ action: 'reply', threadId, requestId: rid(), text: 'Hi' });
    await adminRead((ctx) =>
      import('firebase/firestore').then(({ setDoc }) =>
        setDoc(doc(ctx.firestore(), 'inboxNotes', threadId), { text: 'note' }),
      ),
    );
    await manageAs({ action: 'delete', threadId });
    await adminRead(async (ctx) => {
      const fs = ctx.firestore();
      expect((await getDoc(doc(fs, 'inbox', threadId))).exists()).toBe(false);
      expect((await getDoc(doc(fs, 'inboxNotes', threadId))).exists()).toBe(false);
      expect((await getDocs(collection(fs, 'inbox', threadId, 'messages'))).size).toBe(0);
      expect((await getDocs(collection(fs, 'inboxAudit', threadId, 'entries'))).size).toBe(0);
      expect((await getDoc(doc(fs, 'inboxLimits', 'user1'))).exists()).toBe(true);
    });
    expect(await cards('user1')).toHaveLength(0);
    expect(await cards('admin1')).toHaveLength(0);
  });
});
