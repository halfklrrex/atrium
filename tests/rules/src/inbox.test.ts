import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createTestEnv } from './helpers';

/**
 * ADMIN-4 PR2: rules for `inbox`, `inbox/*\/messages`, `inboxNotes`, `inboxAudit` and `inboxLimits`.
 * Every row of the spec's "What each side sees" table, allowed and denied, single gets and list
 * queries (docs/specs/ADMIN-4-appeals-inbox.md).
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const U = {
  sender: 'sender1', // approved; owns the feedback thread
  other: 'other1', // approved; owns nothing
  blocked: 'blocked1', // blocked; owns an appeal and an old feedback thread
  blockedOther: 'blocked2', // blocked; owns another appeal
  pending: 'pending1',
  noClaim: 'noclaim1',
  admin: 'admin1', // approved + admin claim
} as const;

const FB = 'thread-feedback'; // sender's feedback thread
const FB_UNREAD = 'thread-feedback-unread'; // sender's feedback thread with both unread flags true
const AP = 'thread-appeal'; // blocked1's appeal
const AP_OTHER = 'thread-appeal-other'; // blocked2's appeal
const FB_BLOCKED = 'thread-feedback-blocked'; // blocked1's old feedback thread
const FB_ADMIN = 'thread-feedback-admin'; // the admin's own feedback

const seedTs = Timestamp.fromMillis(1_700_000_000_000);

function thread(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'feedback',
    category: 'idea',
    subject: 'Dark mode',
    senderUid: U.sender,
    senderName: 'Avery Quinn',
    senderEmail: 'avery@example.com',
    senderPhotoURL: null,
    status: 'open',
    outcome: null,
    messageCount: 1,
    lastMessageAt: seedTs,
    lastMessageBy: 'sender',
    lastSnippet: 'Hello',
    adminUnread: false,
    senderUnread: false,
    createdAt: seedTs,
    updatedAt: seedTs,
    closedAt: null,
    ...overrides,
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    seq: 1,
    authorRole: 'sender',
    authorUid: U.sender,
    authorName: 'Avery Quinn',
    authorPhotoURL: null,
    text: 'Hello',
    createdAt: seedTs,
    ...overrides,
  };
}

const THREADS: Record<string, Record<string, unknown>> = {
  [FB]: thread(),
  [FB_UNREAD]: thread({ adminUnread: true, senderUnread: true }),
  [AP]: thread({
    kind: 'appeal',
    category: null,
    subject: 'Appeal',
    senderUid: U.blocked,
    senderName: 'Blair Case',
  }),
  [AP_OTHER]: thread({
    kind: 'appeal',
    category: null,
    subject: 'Appeal',
    senderUid: U.blockedOther,
    senderName: 'Bo Dunn',
  }),
  [FB_BLOCKED]: thread({ senderUid: U.blocked, senderName: 'Blair Case' }),
  [FB_ADMIN]: thread({ senderUid: U.admin, senderName: 'Ada Admin' }),
};

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, data] of Object.entries(THREADS)) {
      await setDoc(doc(db, 'inbox', id), data);
      await setDoc(doc(db, 'inbox', id, 'messages', 'm1'), message({ authorUid: data.senderUid }));
      await setDoc(
        doc(db, 'inbox', id, 'messages', 'm2'),
        message({ seq: 2, authorRole: 'admin', authorUid: null, authorName: null, text: 'Reply' }),
      );
    }
    await setDoc(doc(db, 'inboxNotes', FB), {
      text: 'Internal',
      updatedAt: seedTs,
      updatedBy: U.admin,
    });
    await setDoc(doc(db, 'inboxAudit', FB, 'entries', 'm2'), {
      adminUid: U.admin,
      action: 'reply',
      createdAt: seedTs,
    });
    await setDoc(doc(db, 'inboxLimits', U.sender), {
      day: '2026-11-07',
      threadsToday: 1,
      messagesToday: 1,
      appealRefusedAt: null,
      updatedAt: seedTs,
    });
  });
});

/** The people, as Firestore contexts. */
const as = {
  sender: () => env.authenticatedContext(U.sender).firestore(),
  other: () => env.authenticatedContext(U.other).firestore(),
  blocked: () => env.authenticatedContext(U.blocked, { acct: 'blocked' }).firestore(),
  blockedOther: () => env.authenticatedContext(U.blockedOther, { acct: 'blocked' }).firestore(),
  pending: () => env.authenticatedContext(U.pending, { acct: 'pending' }).firestore(),
  noClaim: () => env.authenticatedContext(U.noClaim, { acct: undefined }).firestore(),
  admin: () => env.authenticatedContext(U.admin, { admin: true }).firestore(),
  anon: () => env.unauthenticatedContext().firestore(),
  // `admin: true` alone is not enough: the account must also be approved.
  adminBlocked: () =>
    env.authenticatedContext('admin-blocked', { acct: 'blocked', admin: true }).firestore(),
  adminPending: () =>
    env.authenticatedContext('admin-pending', { acct: 'pending', admin: true }).firestore(),
  adminNoClaim: () =>
    env.authenticatedContext('admin-noclaim', { acct: undefined, admin: true }).firestore(),
  adminFalse: () => env.authenticatedContext('admin-false', { admin: false }).firestore(),
};
type Who = keyof typeof as;

const NOT_ADMINS: Who[] = [
  'sender',
  'other',
  'blocked',
  'pending',
  'noClaim',
  'anon',
  'adminBlocked',
  'adminPending',
  'adminNoClaim',
  'adminFalse',
];

describe('inbox thread: single reads', () => {
  it('the approved sender reads their own feedback thread; another approved user does not', async () => {
    await assertSucceeds(getDoc(doc(as.sender(), 'inbox', FB)));
    await assertFails(getDoc(doc(as.other(), 'inbox', FB)));
  });

  it('a blocked sender reads their own appeal thread, not their own feedback thread', async () => {
    await assertSucceeds(getDoc(doc(as.blocked(), 'inbox', AP)));
    await assertFails(getDoc(doc(as.blocked(), 'inbox', FB_BLOCKED)));
  });

  it("a blocked sender cannot read anyone else's appeal or feedback thread", async () => {
    await assertFails(getDoc(doc(as.blocked(), 'inbox', AP_OTHER)));
    await assertFails(getDoc(doc(as.blocked(), 'inbox', FB)));
    await assertFails(getDoc(doc(as.blockedOther(), 'inbox', AP)));
  });

  it('an approved non-sender cannot read an appeal thread', async () => {
    await assertFails(getDoc(doc(as.other(), 'inbox', AP)));
    await assertFails(getDoc(doc(as.sender(), 'inbox', AP)));
  });

  it('pending, no-claim and anonymous callers read nothing, not even their own', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'inbox', 'p1'), thread({ senderUid: U.pending }));
      await setDoc(doc(db, 'inbox', 'p2'), thread({ senderUid: U.noClaim }));
      await setDoc(
        doc(db, 'inbox', 'p3'),
        thread({ senderUid: U.pending, kind: 'appeal', category: null }),
      );
    });
    await assertFails(getDoc(doc(as.pending(), 'inbox', 'p1')));
    await assertFails(getDoc(doc(as.pending(), 'inbox', 'p3')));
    await assertFails(getDoc(doc(as.noClaim(), 'inbox', 'p2')));
    for (const id of [FB, AP]) {
      await assertFails(getDoc(doc(as.pending(), 'inbox', id)));
      await assertFails(getDoc(doc(as.noClaim(), 'inbox', id)));
      await assertFails(getDoc(doc(as.anon(), 'inbox', id)));
    }
  });

  it('a site admin reads every thread; the admin claim without an approved account does not count', async () => {
    for (const id of Object.keys(THREADS)) {
      await assertSucceeds(getDoc(doc(as.admin(), 'inbox', id)));
    }
    for (const who of ['adminBlocked', 'adminPending', 'adminNoClaim', 'adminFalse'] as const) {
      await assertFails(getDoc(doc(as[who](), 'inbox', FB)));
    }
  });

  it('an admin who is also a sender reads their own feedback and gets nothing extra elsewhere', async () => {
    await assertSucceeds(getDoc(doc(as.admin(), 'inbox', FB_ADMIN)));
  });

  it('a missing thread is denied like an existing foreign one (no probing)', async () => {
    await assertFails(getDoc(doc(as.other(), 'inbox', 'nope')));
    await assertFails(getDoc(doc(as.blocked(), 'inbox', 'nope')));
  });
});

describe('inbox thread: list queries', () => {
  const inbox = (db: ReturnType<typeof as.sender>) => collection(db, 'inbox');

  it('the approved sender lists their own threads, only when the query is scoped to them', async () => {
    const own = await assertSucceeds(
      getDocs(query(inbox(as.sender()), where('senderUid', '==', U.sender))),
    );
    // Only their own two feedback threads: other senders' threads are not included.
    if (own.size !== 2) throw new Error(`expected 2 own threads, got ${own.size}`);
    await assertSucceeds(
      getDocs(
        query(
          inbox(as.sender()),
          where('senderUid', '==', U.sender),
          where('kind', '==', 'feedback'),
          orderBy('lastMessageAt', 'desc'),
        ),
      ),
    );
    await assertFails(getDocs(inbox(as.sender())));
    await assertFails(getDocs(query(inbox(as.sender()), where('kind', '==', 'feedback'))));
    await assertFails(getDocs(query(inbox(as.sender()), where('senderUid', '==', U.other))));
    await assertFails(getDocs(query(inbox(as.sender()), where('senderUid', '==', U.blocked))));
  });

  it("another approved user cannot list someone else's threads", async () => {
    await assertFails(getDocs(query(inbox(as.other()), where('senderUid', '==', U.sender))));
    await assertFails(getDocs(inbox(as.other())));
    await assertFails(getDocs(query(inbox(as.other()), where('kind', '==', 'appeal'))));
    // Their own (empty) list is allowed.
    await assertSucceeds(getDocs(query(inbox(as.other()), where('senderUid', '==', U.other))));
  });

  it('a blocked sender lists their own appeals only with kind == appeal in the query', async () => {
    const appeals = await assertSucceeds(
      getDocs(
        query(
          inbox(as.blocked()),
          where('senderUid', '==', U.blocked),
          where('kind', '==', 'appeal'),
          orderBy('lastMessageAt', 'desc'),
        ),
      ),
    );
    if (appeals.size !== 1) throw new Error(`expected 1 appeal, got ${appeals.size}`);
    await assertFails(getDocs(query(inbox(as.blocked()), where('senderUid', '==', U.blocked))));
    await assertFails(getDocs(inbox(as.blocked())));
    await assertFails(getDocs(query(inbox(as.blocked()), where('kind', '==', 'appeal'))));
    await assertFails(
      getDocs(
        query(
          inbox(as.blocked()),
          where('senderUid', '==', U.blocked),
          where('kind', '==', 'feedback'),
        ),
      ),
    );
    await assertFails(
      getDocs(
        query(
          inbox(as.blocked()),
          where('senderUid', '==', U.blockedOther),
          where('kind', '==', 'appeal'),
        ),
      ),
    );
  });

  it('pending, no-claim and anonymous callers cannot list, even their own', async () => {
    for (const who of ['pending', 'noClaim', 'anon'] as const) {
      await assertFails(getDocs(inbox(as[who]())));
      await assertFails(
        getDocs(
          query(
            inbox(as[who]()),
            where('senderUid', '==', who === 'pending' ? U.pending : U.noClaim),
          ),
        ),
      );
      await assertFails(
        getDocs(
          query(
            inbox(as[who]()),
            where('senderUid', '==', U.blocked),
            where('kind', '==', 'appeal'),
          ),
        ),
      );
    }
  });

  it('a site admin lists everything, with the status, kind and unread filters', async () => {
    const all = await assertSucceeds(getDocs(inbox(as.admin())));
    if (all.size !== Object.keys(THREADS).length) throw new Error('admin did not see every thread');
    await assertSucceeds(
      getDocs(
        query(inbox(as.admin()), where('status', '==', 'open'), orderBy('lastMessageAt', 'desc')),
      ),
    );
    await assertSucceeds(
      getDocs(
        query(
          inbox(as.admin()),
          where('kind', '==', 'appeal'),
          where('status', '==', 'open'),
          orderBy('lastMessageAt', 'desc'),
        ),
      ),
    );
    const unread = await assertSucceeds(
      getDocs(query(inbox(as.admin()), where('adminUnread', '==', true))),
    );
    if (unread.size !== 1) throw new Error(`expected 1 unread thread, got ${unread.size}`);
  });

  it('the admin claim without an approved account lists nothing', async () => {
    for (const who of ['adminBlocked', 'adminPending', 'adminNoClaim', 'adminFalse'] as const) {
      await assertFails(getDocs(inbox(as[who]())));
    }
  });
});

describe('inbox messages', () => {
  const messages = (db: ReturnType<typeof as.sender>, id: string) =>
    collection(db, 'inbox', id, 'messages');

  it('the approved sender gets and lists the messages of their own thread, in order', async () => {
    await assertSucceeds(getDoc(doc(as.sender(), 'inbox', FB, 'messages', 'm1')));
    await assertSucceeds(getDoc(doc(as.sender(), 'inbox', FB, 'messages', 'm2')));
    const list = await assertSucceeds(getDocs(query(messages(as.sender(), FB), orderBy('seq'))));
    if (list.size !== 2) throw new Error(`expected 2 messages, got ${list.size}`);
  });

  it('another approved user gets and lists nothing, on feedback or appeal threads', async () => {
    for (const id of [FB, AP]) {
      await assertFails(getDoc(doc(as.other(), 'inbox', id, 'messages', 'm1')));
      await assertFails(getDocs(query(messages(as.other(), id), orderBy('seq'))));
    }
  });

  it("a blocked sender reads the messages of their own appeal, not of their feedback or others' appeals", async () => {
    await assertSucceeds(getDoc(doc(as.blocked(), 'inbox', AP, 'messages', 'm2')));
    await assertSucceeds(getDocs(query(messages(as.blocked(), AP), orderBy('seq'))));
    await assertFails(getDoc(doc(as.blocked(), 'inbox', FB_BLOCKED, 'messages', 'm1')));
    await assertFails(getDocs(query(messages(as.blocked(), FB_BLOCKED), orderBy('seq'))));
    await assertFails(getDoc(doc(as.blocked(), 'inbox', AP_OTHER, 'messages', 'm1')));
    await assertFails(getDocs(query(messages(as.blocked(), AP_OTHER), orderBy('seq'))));
    await assertFails(getDocs(query(messages(as.blocked(), FB), orderBy('seq'))));
  });

  it('pending, no-claim and anonymous callers read no messages', async () => {
    for (const who of ['pending', 'noClaim', 'anon'] as const) {
      for (const id of [FB, AP]) {
        await assertFails(getDoc(doc(as[who](), 'inbox', id, 'messages', 'm1')));
        await assertFails(getDocs(messages(as[who](), id)));
      }
    }
  });

  it('a site admin reads every message', async () => {
    for (const id of Object.keys(THREADS)) {
      await assertSucceeds(getDoc(doc(as.admin(), 'inbox', id, 'messages', 'm1')));
      await assertSucceeds(getDocs(query(messages(as.admin(), id), orderBy('seq'))));
    }
    for (const who of ['adminBlocked', 'adminPending', 'adminNoClaim', 'adminFalse'] as const) {
      await assertFails(getDocs(messages(as[who](), FB)));
    }
  });

  it('a message of a missing thread is denied', async () => {
    await assertFails(getDoc(doc(as.sender(), 'inbox', 'nope', 'messages', 'm1')));
    await assertFails(getDocs(messages(as.sender(), 'nope')));
  });

  it('a collection-group query on messages is denied for everyone (no way around the thread check)', async () => {
    for (const who of ['sender', 'blocked', 'admin', 'other'] as const) {
      await assertFails(getDocs(collectionGroup(as[who](), 'messages')));
      await assertFails(
        getDocs(query(collectionGroup(as[who](), 'messages'), where('authorUid', '==', U.sender))),
      );
    }
  });

  it('admin messages store no identity, so a sender reading them sees none (T6)', async () => {
    const snap = await assertSucceeds(getDoc(doc(as.sender(), 'inbox', FB, 'messages', 'm2')));
    const data = snap.data() as Record<string, unknown>;
    if (data.authorUid !== null || data.authorName !== null || data.authorPhotoURL !== null) {
      throw new Error('admin message carries an identity');
    }
  });
});

describe('inbox: clients never create or delete threads or messages', () => {
  it('nobody creates a thread, admins included', async () => {
    for (const who of ['sender', 'other', 'blocked', 'pending', 'admin', 'anon'] as const) {
      await assertFails(
        setDoc(
          doc(as[who](), 'inbox', `new-${who}`),
          thread({ senderUid: U[who as keyof typeof U] ?? 'x' }),
        ),
      );
    }
    // Even with exactly the shape a Function writes.
    await assertFails(
      setDoc(
        doc(as.blocked(), 'inbox', 'new-appeal'),
        thread({ senderUid: U.blocked, kind: 'appeal', category: null }),
      ),
    );
  });

  it('nobody deletes a thread, admins and the sender included', async () => {
    await assertFails(deleteDoc(doc(as.sender(), 'inbox', FB)));
    await assertFails(deleteDoc(doc(as.admin(), 'inbox', FB)));
    await assertFails(deleteDoc(doc(as.admin(), 'inbox', AP)));
    await assertFails(deleteDoc(doc(as.blocked(), 'inbox', AP)));
    await assertFails(deleteDoc(doc(as.other(), 'inbox', FB)));
  });

  it('nobody creates, edits or deletes a message, admins and the sender included', async () => {
    for (const who of ['sender', 'other', 'blocked', 'admin', 'pending', 'anon'] as const) {
      const id = who === 'blocked' ? AP : FB;
      await assertFails(setDoc(doc(as[who](), 'inbox', id, 'messages', `new-${who}`), message()));
      await assertFails(
        updateDoc(doc(as[who](), 'inbox', id, 'messages', 'm1'), { text: 'Edited' }),
      );
      await assertFails(deleteDoc(doc(as[who](), 'inbox', id, 'messages', 'm1')));
    }
  });
});

describe('inbox thread: unread flags are the only client updates', () => {
  it('an admin may set adminUnread to false', async () => {
    await assertSucceeds(updateDoc(doc(as.admin(), 'inbox', FB_UNREAD), { adminUnread: false }));
  });

  it('an admin may not set adminUnread to true, change status, messageCount or two keys at once', async () => {
    const ref = () => doc(as.admin(), 'inbox', FB_UNREAD);
    await assertFails(updateDoc(ref(), { adminUnread: true }));
    await assertFails(updateDoc(doc(as.admin(), 'inbox', FB), { adminUnread: true }));
    await assertFails(updateDoc(ref(), { status: 'closed' }));
    await assertFails(updateDoc(ref(), { messageCount: 99 }));
    await assertFails(updateDoc(ref(), { adminUnread: false, status: 'closed' }));
    await assertFails(updateDoc(ref(), { adminUnread: false, senderUnread: false }));
    await assertFails(updateDoc(ref(), { adminUnread: false, subject: 'Changed' }));
    await assertFails(updateDoc(ref(), { senderUid: U.admin }));
    await assertFails(updateDoc(ref(), { adminUnread: 'false' }));
    await assertFails(updateDoc(ref(), { adminUnread: null }));
    await assertFails(updateDoc(ref(), { closedAt: serverTimestamp() }));
  });

  it("an admin cannot set senderUnread on someone else's thread", async () => {
    await assertFails(updateDoc(doc(as.admin(), 'inbox', FB_UNREAD), { senderUnread: false }));
  });

  it('an admin sending their own feedback may mark their own thread read as the sender', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'inbox', FB_ADMIN), { senderUnread: true });
    });
    await assertSucceeds(updateDoc(doc(as.admin(), 'inbox', FB_ADMIN), { senderUnread: false }));
  });

  it('a non-admin cannot touch adminUnread, even on their own thread', async () => {
    await assertFails(updateDoc(doc(as.sender(), 'inbox', FB_UNREAD), { adminUnread: false }));
    await assertFails(updateDoc(doc(as.other(), 'inbox', FB_UNREAD), { adminUnread: false }));
    for (const who of ['adminBlocked', 'adminPending', 'adminNoClaim', 'adminFalse'] as const) {
      await assertFails(updateDoc(doc(as[who](), 'inbox', FB_UNREAD), { adminUnread: false }));
    }
  });

  it('the approved sender may set senderUnread to false on their own thread only', async () => {
    await assertSucceeds(updateDoc(doc(as.sender(), 'inbox', FB_UNREAD), { senderUnread: false }));
    await assertFails(updateDoc(doc(as.other(), 'inbox', FB_UNREAD), { senderUnread: false }));
    await assertFails(updateDoc(doc(as.sender(), 'inbox', AP), { senderUnread: false }));
  });

  it('the sender may not set senderUnread to true or change anything else', async () => {
    const ref = () => doc(as.sender(), 'inbox', FB_UNREAD);
    await assertFails(updateDoc(ref(), { senderUnread: true }));
    await assertFails(updateDoc(ref(), { senderUnread: false, status: 'closed' }));
    await assertFails(updateDoc(ref(), { senderUnread: false, adminUnread: false }));
    await assertFails(updateDoc(ref(), { status: 'open', subject: 'New' }));
    await assertFails(updateDoc(ref(), { messageCount: 5 }));
    await assertFails(updateDoc(ref(), { lastSnippet: 'x' }));
    await assertFails(updateDoc(ref(), { senderUid: U.other }));
    await assertFails(updateDoc(ref(), { senderUnread: 0 }));
  });

  it('a blocked sender writes nothing, not even senderUnread on their own appeal', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'inbox', AP), { senderUnread: true });
    });
    await assertFails(updateDoc(doc(as.blocked(), 'inbox', AP), { senderUnread: false }));
    await assertFails(updateDoc(doc(as.blocked(), 'inbox', AP), { adminUnread: false }));
    await assertFails(updateDoc(doc(as.blocked(), 'inbox', AP), { status: 'closed' }));
    await assertFails(updateDoc(doc(as.blocked(), 'inbox', FB_BLOCKED), { senderUnread: false }));
  });

  it('pending, no-claim and anonymous callers write nothing', async () => {
    for (const who of ['pending', 'noClaim', 'anon'] as const) {
      await assertFails(updateDoc(doc(as[who](), 'inbox', FB_UNREAD), { senderUnread: false }));
      await assertFails(updateDoc(doc(as[who](), 'inbox', FB_UNREAD), { adminUnread: false }));
    }
  });
});

describe('inboxNotes: the admin-only internal note', () => {
  const note = (overrides: Record<string, unknown> = {}) => ({
    text: 'Looks genuine',
    updatedAt: serverTimestamp(),
    updatedBy: U.admin,
    ...overrides,
  });

  it('only a site admin reads a note', async () => {
    await assertSucceeds(getDoc(doc(as.admin(), 'inboxNotes', FB)));
    for (const who of NOT_ADMINS) {
      await assertFails(getDoc(doc(as[who](), 'inboxNotes', FB)));
    }
    // The sender of the thread never sees it, by get or by list.
    await assertFails(getDocs(collection(as.sender(), 'inboxNotes')));
    await assertFails(getDocs(collection(as.blocked(), 'inboxNotes')));
    await assertSucceeds(getDocs(collection(as.admin(), 'inboxNotes')));
  });

  it('an admin creates and updates a note with a valid shape', async () => {
    await assertSucceeds(setDoc(doc(as.admin(), 'inboxNotes', FB_UNREAD), note()));
    await assertSucceeds(setDoc(doc(as.admin(), 'inboxNotes', FB), note({ text: 'Edited' })));
    await assertSucceeds(
      updateDoc(doc(as.admin(), 'inboxNotes', FB), {
        text: 'Again',
        updatedAt: serverTimestamp(),
        updatedBy: U.admin,
      }),
    );
    await assertSucceeds(setDoc(doc(as.admin(), 'inboxNotes', AP), note({ text: '' })));
    await assertSucceeds(
      setDoc(doc(as.admin(), 'inboxNotes', AP_OTHER), note({ text: 'x'.repeat(2000) })),
    );
  });

  it('refuses a note that is too long, malformed or forged', async () => {
    const ref = () => doc(as.admin(), 'inboxNotes', FB_UNREAD);
    await assertFails(setDoc(ref(), note({ text: 'x'.repeat(2001) })));
    await assertFails(setDoc(ref(), note({ text: 5 })));
    await assertFails(setDoc(ref(), note({ extra: true })));
    await assertFails(setDoc(ref(), { text: 'a', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(ref(), { text: 'a', updatedBy: U.admin }));
    await assertFails(setDoc(ref(), { updatedAt: serverTimestamp(), updatedBy: U.admin }));
    await assertFails(setDoc(ref(), note({ updatedBy: U.other })));
    await assertFails(setDoc(ref(), note({ updatedAt: Timestamp.fromMillis(1_700_000_000_000) })));
    await assertFails(setDoc(ref(), note({ updatedAt: null })));
    await assertFails(
      updateDoc(doc(as.admin(), 'inboxNotes', FB), {
        text: 'x'.repeat(2001),
        updatedAt: serverTimestamp(),
        updatedBy: U.admin,
      }),
    );
    await assertFails(
      updateDoc(doc(as.admin(), 'inboxNotes', FB), {
        updatedBy: U.other,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as.admin(), 'inboxNotes', FB), { extra: 1, updatedAt: serverTimestamp() }),
    );
  });

  it('refuses a note for a thread that does not exist', async () => {
    await assertFails(setDoc(doc(as.admin(), 'inboxNotes', 'no-such-thread'), note()));
  });

  it('nobody but an admin writes a note', async () => {
    for (const who of NOT_ADMINS) {
      await assertFails(setDoc(doc(as[who](), 'inboxNotes', FB), note({ updatedBy: `${who}` })));
      await assertFails(setDoc(doc(as[who](), 'inboxNotes', FB_UNREAD), note()));
    }
  });

  it('nobody deletes a note from a client, admins included', async () => {
    await assertFails(deleteDoc(doc(as.admin(), 'inboxNotes', FB)));
    for (const who of NOT_ADMINS) {
      await assertFails(deleteDoc(doc(as[who](), 'inboxNotes', FB)));
    }
  });
});

describe('inboxAudit: which admin acted (T6) is admin-only', () => {
  const audit = (db: ReturnType<typeof as.sender>) => doc(db, 'inboxAudit', FB, 'entries', 'm2');

  it('a site admin reads the audit entries', async () => {
    await assertSucceeds(getDoc(audit(as.admin())));
    await assertSucceeds(getDocs(collection(as.admin(), 'inboxAudit', FB, 'entries')));
  });

  it('the sender and everyone else cannot read them, by get or by list', async () => {
    for (const who of NOT_ADMINS) {
      await assertFails(getDoc(audit(as[who]())));
      await assertFails(getDocs(collection(as[who](), 'inboxAudit', FB, 'entries')));
    }
    await assertFails(getDocs(collectionGroup(as.sender(), 'entries')));
  });

  it('nobody writes them from a client, admins included', async () => {
    const entry = { adminUid: U.admin, action: 'reply', createdAt: serverTimestamp() };
    await assertFails(setDoc(doc(as.admin(), 'inboxAudit', FB, 'entries', 'x'), entry));
    await assertFails(updateDoc(audit(as.admin()), { action: 'close' }));
    await assertFails(deleteDoc(audit(as.admin())));
    await assertFails(setDoc(doc(as.sender(), 'inboxAudit', FB, 'entries', 'x'), entry));
  });
});

describe('inboxLimits: Functions-only counters', () => {
  it('nobody reads them, not even the owner of the counter or an admin', async () => {
    for (const who of [
      'sender',
      'other',
      'blocked',
      'pending',
      'noClaim',
      'admin',
      'anon',
    ] as const) {
      await assertFails(getDoc(doc(as[who](), 'inboxLimits', U.sender)));
      await assertFails(getDocs(collection(as[who](), 'inboxLimits')));
    }
  });

  it('nobody writes them', async () => {
    const limits = {
      day: '2026-11-07',
      threadsToday: 0,
      messagesToday: 0,
      appealRefusedAt: null,
      updatedAt: seedTs,
    };
    for (const who of ['sender', 'other', 'blocked', 'pending', 'admin', 'anon'] as const) {
      await assertFails(setDoc(doc(as[who](), 'inboxLimits', U.sender), limits));
      await assertFails(updateDoc(doc(as[who](), 'inboxLimits', U.sender), { threadsToday: 0 }));
      await assertFails(deleteDoc(doc(as[who](), 'inboxLimits', U.sender)));
    }
    await assertFails(
      setDoc(doc(as.blocked(), 'inboxLimits', U.blocked), { ...limits, appealRefusedAt: null }),
    );
  });
});

describe('the new matches add nothing else for a blocked token', () => {
  it('a blocked token still reads nothing outside its own appeal threads', async () => {
    // The blocked screen reads only its own `users/{uid}` (users.test.ts) and its own appeals.
    await assertFails(getDocs(collection(as.blocked(), 'users')));
    await assertFails(getDocs(collection(as.blocked(), 'inboxNotes')));
    await assertFails(getDocs(collection(as.blocked(), 'inboxLimits')));
    await assertFails(getDocs(collection(as.blocked(), 'inboxAudit', AP, 'entries')));
  });
});
