import { randomUUID } from 'node:crypto';
import {
  INBOX_ADMIN_LABEL,
  INBOX_LIMITS,
  normalizeInboxText,
  type AccountStatus,
  type InboxAuditEntry,
  type InboxErrorReason,
  type InboxLimitsDoc,
  type InboxMessage,
  type InboxStatus,
  type InboxThread,
  type ManageInboxThreadRequest,
  type ManageInboxThreadResult,
  type Notification,
  type NotificationKind,
  type SendInboxMessageRequest,
  type SendInboxMessageResult,
  type TimestampLike,
} from '@atrium/shared';
import { logger } from 'firebase-functions/v2';
import { HttpsError } from 'firebase-functions/v2/https';
import { ACCOUNT_NOTIFICATION_REF } from './account-admin';
import { notificationId, type NewNotification } from './notifications';

/**
 * The appeals and feedback Inbox (ADMIN-4, docs/specs/ADMIN-4-appeals-inbox.md). Pure logic over
 * narrow `InboxStore` and `InboxAuth` interfaces, so it is unit tested without an emulator;
 * `admin-inbox.ts` adapts the Admin SDK to them.
 *
 * Rules that hold everywhere below:
 * - Every limit, state check and idempotence check runs inside ONE transaction, reads first. Firestore
 *   queries inside a transaction lock the range, so two parallel sends cannot both pass a limit.
 * - The role of a message is fixed by the callable that runs (sender vs admin), never by the input.
 * - Nothing that identifies an admin is written to a document the sender can read (T6): admin
 *   messages store null author fields, the acting admin goes to `inboxAudit` only, and the
 *   `inbox_reply` notification uses the fixed label and the recipient's own uid.
 * - `senderEmail` lives on the thread document only; it never reaches a notification.
 */

type Dated<T> = {
  [K in keyof T]: T[K] extends TimestampLike
    ? Date
    : T[K] extends TimestampLike | null
      ? Date | null
      : T[K];
};

/** Thread, message, limits and audit documents with plain `Date`s; the adapter converts. */
export type ThreadData = Dated<InboxThread>;
export type MessageData = Dated<InboxMessage>;
export type LimitsData = Dated<InboxLimitsDoc>;
export type AuditData = Dated<InboxAuditEntry>;

/** The `adminUid` recorded when an unblock closed the appeal (not an admin's uid). */
export const SYSTEM_UNBLOCK = 'system:unblock';

/** Firestore batches and `in` queries stay well under their limits with this. */
export const INBOX_DELETE_BATCH = 400;
const OPEN_STATUSES: ReadonlyArray<InboxStatus> = ['open', 'answered'];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DELETE_ROUNDS = 10_000;

export interface InboxTx {
  getThread(threadId: string): Promise<ThreadData | null>;
  getMessage(
    threadId: string,
    messageId: string,
  ): Promise<{ authorRole: 'sender' | 'admin'; authorUid: string | null } | null>;
  getLimits(uid: string): Promise<LimitsData | null>;
  /** Threads of one sender, one kind, in any of the statuses; at most `limit`. */
  findSenderThreads(query: {
    senderUid: string;
    kind: 'appeal' | 'feedback';
    statuses: ReadonlyArray<InboxStatus>;
    limit: number;
  }): Promise<Array<{ id: string }>>;
  /** Writes; the adapter throws when the document already exists (`create`). */
  createThread(threadId: string, data: ThreadData): void;
  updateThread(threadId: string, patch: Partial<ThreadData>): void;
  createMessage(threadId: string, messageId: string, data: MessageData): void;
  setLimits(uid: string, data: LimitsData): void;
  createAudit(threadId: string, entryId: string, data: AuditData): void;
}

export interface InboxStore {
  /** Runs `fn` in a Firestore transaction (it may run more than once; keep it free of side effects). */
  transaction<T>(fn: (tx: InboxTx) => Promise<T>): Promise<T>;
  /** A plain read, outside any transaction. */
  getThread(threadId: string): Promise<ThreadData | null>;
  /** Deletes up to `limit` message documents of the thread; resolves to how many it deleted. */
  deleteMessagesBatch(threadId: string, limit: number): Promise<number>;
  /** Deletes up to `limit` `inboxAudit` entries of the thread. */
  deleteAuditBatch(threadId: string, limit: number): Promise<number>;
  deleteNotifications(refs: ReadonlyArray<{ uid: string; id: string }>): Promise<void>;
  /**
   * Remembers which admins got an `inbox_new` card for the thread, on the admin-only audit parent
   * document `inboxAudit/{threadId}` (`notifiedUids`, array union; Admin SDK only, never on a
   * document the sender can read), so a delete can find the cards of admins who have since lost the role.
   */
  addNotifiedUids(threadId: string, uids: ReadonlyArray<string>): Promise<void>;
  getNotifiedUids(threadId: string): Promise<string[]>;
  /** Deletes `inboxNotes/{threadId}`, `inboxAudit/{threadId}` and the thread document in one batch. */
  deleteNoteAndThread(threadId: string): Promise<void>;
  /** Writes the notification with `set` (createdAt now, readAt null): one card per thread per person. */
  upsertNotification(uid: string, id: string, data: NewNotification): Promise<void>;
}

export interface InboxAuth {
  listAdminUids(): Promise<string[]>;
  /** From the Auth user's claims; `null` when there is no such user. */
  getAccountStatus(uid: string): Promise<AccountStatus | null>;
}

export interface InboxDeps {
  store: InboxStore;
  auth: InboxAuth;
  now?: () => Date;
  newId?: () => string;
}

const clock = (deps: Pick<InboxDeps, 'now'>): Date => (deps.now ?? (() => new Date()))();
const freshId = (deps: Pick<InboxDeps, 'newId'>): string => (deps.newId ?? randomUUID)();

/** The verified sender, from `actorFromRequest` (never from the request data). */
export interface InboxSender {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  accountStatus: AccountStatus;
}

export interface InboxAdmin {
  uid: string;
}

// -- errors --------------------------------------------------------------------------------------

type Code = ConstructorParameters<typeof HttpsError>[0];

function refuse(
  code: Code,
  message: string,
  reason?: InboxErrorReason,
  extra: Record<string, unknown> = {},
): HttpsError {
  return new HttpsError(code, message, reason ? { reason, ...extra } : extra);
}

const notFound = (): HttpsError => new HttpsError('not-found', 'No such conversation.');

// -- small helpers -------------------------------------------------------------------------------

const utcDay = (d: Date): string => d.toISOString().slice(0, 10);
const snippetOf = (text: string): string => text.slice(0, INBOX_LIMITS.snippet);

/** The text a message may hold: normalised again here, because this is the boundary that counts. */
export function cleanText(raw: string, max: number = INBOX_LIMITS.text): string {
  const text = normalizeInboxText(raw);
  if (text.length < 1 || text.length > max) {
    throw new HttpsError('invalid-argument', `Write between 1 and ${max} characters.`);
  }
  return text;
}

function dailyLimits(existing: LimitsData | null, now: Date): LimitsData {
  const day = utcDay(now);
  if (existing && existing.day === day) return existing;
  return {
    day,
    threadsToday: 0,
    messagesToday: 0,
    appealRefusedAt: existing?.appealRefusedAt ?? null,
    updatedAt: now,
  };
}

const dayCap = (status: AccountStatus): number =>
  status === 'blocked' ? INBOX_LIMITS.messagesPerDayBlocked : INBOX_LIMITS.messagesPerDayApproved;

function assertDailyMessages(limits: LimitsData, status: AccountStatus): void {
  if (limits.messagesToday >= dayCap(status)) {
    throw refuse(
      'resource-exhausted',
      'You have reached the daily message limit. Try again tomorrow.',
      'daily-message-limit',
    );
  }
}

// -- notifications -------------------------------------------------------------------------------

/** What to tell the admins about after a sender message committed. */
interface AdminNotice {
  threadId: string;
  subject: string;
  snippet: string;
  senderUid: string;
  senderName: string;
  senderPhotoURL: string | null;
}

/** What to tell a feedback sender after an admin reply committed. */
interface ReplyNotice {
  threadId: string;
  subject: string;
  snippet: string;
  recipientUid: string;
}

function inboxDoc(
  kind: NotificationKind,
  fields: Pick<NewNotification, 'actorId' | 'actorName' | 'actorPhotoURL'>,
  notice: { threadId: string; subject: string; snippet: string },
): NewNotification {
  return {
    kind,
    ...fields,
    workspaceId: ACCOUNT_NOTIFICATION_REF,
    boardId: ACCOUNT_NOTIFICATION_REF,
    boardName: '',
    itemId: notice.threadId,
    itemName: notice.subject.slice(0, 500),
    updateId: null,
    replyId: null,
    columnId: null,
    snippet: notice.snippet,
  } satisfies Omit<Notification, 'createdAt' | 'readAt'>;
}

/**
 * `inbox_new` to every admin except the author. Best effort after the commit: a failure is logged
 * and never fails (or re-runs) the send. The id is deterministic, so a card is overwritten, not stacked.
 */
async function notifyAdmins(deps: InboxDeps, notice: AdminNotice): Promise<void> {
  let admins: string[];
  try {
    admins = await deps.auth.listAdminUids();
  } catch (error) {
    logger.error('Inbox: could not list admins to notify', { threadId: notice.threadId, error });
    return;
  }
  const doc = inboxDoc(
    'inbox_new',
    {
      actorId: notice.senderUid,
      actorName: notice.senderName.slice(0, 200),
      actorPhotoURL: notice.senderPhotoURL,
    },
    notice,
  );
  const targets = admins.filter((adminUid) => adminUid !== notice.senderUid);
  // Recorded before the writes: a card written by a half-failed attempt is still found on delete.
  try {
    await deps.store.addNotifiedUids(notice.threadId, targets);
  } catch (error) {
    logger.error('Inbox: could not record notified admins', { threadId: notice.threadId, error });
  }
  for (const adminUid of targets) {
    try {
      await deps.store.upsertNotification(
        adminUid,
        notificationId('inbox_new', notice.threadId, adminUid),
        doc,
      );
    } catch (error) {
      logger.error('Inbox: notification failed', { threadId: notice.threadId, adminUid, error });
    }
  }
}

/**
 * `inbox_reply` to a feedback sender. The sender can read this document, so it carries no admin
 * identity (T6): the fixed label, no photo, and the recipient's own uid as the (never shown) actor id.
 */
async function notifySender(deps: InboxDeps, notice: ReplyNotice): Promise<void> {
  const doc = inboxDoc(
    'inbox_reply',
    { actorId: notice.recipientUid, actorName: INBOX_ADMIN_LABEL, actorPhotoURL: null },
    notice,
  );
  try {
    await deps.store.upsertNotification(
      notice.recipientUid,
      notificationId('inbox_reply', notice.threadId, notice.recipientUid),
      doc,
    );
  } catch (error) {
    logger.error('Inbox: reply notification failed', { threadId: notice.threadId, error });
  }
}

// -- the sender side -----------------------------------------------------------------------------

interface SendOutcome {
  result: SendInboxMessageResult;
  /** Set only when this call wrote something new (a retry never notifies twice). */
  notice: AdminNotice | null;
}

/** `sendInboxMessage`: new feedback, a new appeal, or a reply on the caller's own thread. */
export async function sendInboxMessage(
  deps: InboxDeps,
  sender: InboxSender,
  input: SendInboxMessageRequest,
): Promise<SendInboxMessageResult> {
  const text = cleanText(input.text);
  let outcome: SendOutcome;
  if (input.action === 'reply') {
    outcome = await deps.store.transaction((tx) => senderReply(deps, tx, sender, input, text));
  } else {
    // Role check before any read: an approved person can't appeal, a blocked one can't send feedback.
    if (input.action === 'feedback' && sender.accountStatus !== 'approved') {
      throw refuse('permission-denied', "Your account can't do this.", 'account-not-approved', {
        status: sender.accountStatus,
      });
    }
    if (input.action === 'appeal' && sender.accountStatus !== 'blocked') {
      throw new HttpsError('permission-denied', 'Only a blocked account can send an appeal.', {
        status: sender.accountStatus,
      });
    }
    if (input.action === 'appeal') await requireLiveBlocked(deps, sender);
    const subject =
      input.action === 'feedback' ? cleanText(input.subject, INBOX_LIMITS.subject) : 'Appeal';
    outcome = await deps.store.transaction((tx) =>
      senderStart(deps, tx, sender, input, subject, text),
    );
  }
  if (outcome.notice) await notifyAdmins(deps, outcome.notice);
  return outcome.result;
}

/**
 * Appeals need the LIVE blocked status, not only the token claim: after an unblock, a stale token
 * still says `blocked` until it refreshes. Same failed-precondition the admin side uses.
 */
async function requireLiveBlocked(deps: InboxDeps, sender: InboxSender): Promise<void> {
  const live = await deps.auth.getAccountStatus(sender.uid);
  if (live !== 'blocked') {
    throw refuse(
      'failed-precondition',
      'Your account is no longer blocked.',
      'account-not-approved',
      {
        status: live ?? 'unknown',
      },
    );
  }
}

function senderFields(sender: InboxSender) {
  const name = (sender.displayName ?? sender.email ?? 'Someone').trim() || 'Someone';
  return {
    senderName: name.slice(0, 200),
    senderEmail: sender.email && sender.email.length <= 320 ? sender.email : null,
    senderPhotoURL: sender.photoURL && sender.photoURL.length <= 2048 ? sender.photoURL : null,
  };
}

async function senderStart(
  deps: InboxDeps,
  tx: InboxTx,
  sender: InboxSender,
  input: Extract<SendInboxMessageRequest, { action: 'feedback' | 'appeal' }>,
  subject: string,
  text: string,
): Promise<SendOutcome> {
  const now = clock(deps);
  const kind = input.action;
  const threadId = input.requestId;

  // -- reads
  const existing = await tx.getThread(threadId);
  if (existing) {
    // Idempotence (T9): the same sender retrying the same action gets the same thread back.
    if (existing.senderUid === sender.uid && existing.kind === kind) {
      return { result: { threadId }, notice: null };
    }
    throw new HttpsError('already-exists', 'This request id is already used.');
  }
  const limits = dailyLimits(await tx.getLimits(sender.uid), now);

  if (kind === 'feedback') {
    if (limits.threadsToday >= INBOX_LIMITS.feedbackThreadsPerDay) {
      throw refuse(
        'resource-exhausted',
        'You can send up to 5 new conversations a day. Try again tomorrow.',
        'daily-thread-limit',
      );
    }
    const open = await tx.findSenderThreads({
      senderUid: sender.uid,
      kind: 'feedback',
      statuses: OPEN_STATUSES,
      limit: INBOX_LIMITS.openFeedbackThreads,
    });
    if (open.length >= INBOX_LIMITS.openFeedbackThreads) {
      throw refuse(
        'resource-exhausted',
        'You can have 3 open conversations at a time. Wait for a reply or for one to close.',
        'open-thread-limit',
      );
    }
  } else {
    const open = await tx.findSenderThreads({
      senderUid: sender.uid,
      kind: 'appeal',
      statuses: OPEN_STATUSES,
      limit: 1,
    });
    if (open.length > 0) {
      throw refuse('already-exists', 'You already have an open appeal.', 'appeal-open', {
        threadId: open[0]!.id,
      });
    }
    if (limits.appealRefusedAt) {
      const retryAfter = new Date(
        limits.appealRefusedAt.getTime() + INBOX_LIMITS.appealWaitDays * DAY_MS,
      );
      if (now.getTime() < retryAfter.getTime()) {
        throw refuse(
          'resource-exhausted',
          'Your last appeal was not accepted. You can send a new one later.',
          'appeal-wait',
          { retryAfter: retryAfter.toISOString() },
        );
      }
    }
  }
  assertDailyMessages(limits, sender.accountStatus);

  // -- writes
  const fields = senderFields(sender);
  const snippet = snippetOf(text);
  tx.createThread(threadId, {
    kind,
    category: input.action === 'feedback' ? input.category : null,
    subject,
    senderUid: sender.uid,
    ...fields,
    status: 'open',
    outcome: null,
    messageCount: 1,
    lastMessageAt: now,
    lastMessageBy: 'sender',
    lastSnippet: snippet,
    adminUnread: true,
    senderUnread: false,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  });
  tx.createMessage(threadId, threadId, {
    seq: 1,
    authorRole: 'sender',
    authorUid: sender.uid,
    authorName: fields.senderName,
    authorPhotoURL: fields.senderPhotoURL,
    text,
    createdAt: now,
  });
  tx.setLimits(sender.uid, {
    ...limits,
    threadsToday: limits.threadsToday + (kind === 'feedback' ? 1 : 0),
    messagesToday: limits.messagesToday + 1,
    updatedAt: now,
  });
  return {
    result: { threadId },
    notice: {
      threadId,
      subject,
      snippet,
      senderUid: sender.uid,
      senderName: fields.senderName,
      senderPhotoURL: fields.senderPhotoURL,
    },
  };
}

async function senderReply(
  deps: InboxDeps,
  tx: InboxTx,
  sender: InboxSender,
  input: Extract<SendInboxMessageRequest, { action: 'reply' }>,
  text: string,
): Promise<SendOutcome> {
  const now = clock(deps);
  const { threadId, requestId } = input;

  // -- reads
  const thread = await tx.getThread(threadId);
  // Someone else's thread looks exactly like a missing one.
  if (!thread || thread.senderUid !== sender.uid) throw notFound();
  const sent = await tx.getMessage(threadId, requestId);
  if (sent) {
    if (sent.authorRole === 'sender' && sent.authorUid === sender.uid) {
      return { result: { threadId, status: thread.status }, notice: null };
    }
    throw new HttpsError('already-exists', 'This request id is already used.');
  }
  // Feedback needs an approved caller, an appeal a blocked one.
  const needed: AccountStatus = thread.kind === 'appeal' ? 'blocked' : 'approved';
  if (sender.accountStatus !== needed) {
    throw refuse('permission-denied', "Your account can't do this.", 'account-not-approved', {
      status: sender.accountStatus,
    });
  }
  if (thread.status === 'closed') {
    throw refuse('failed-precondition', 'This conversation is closed.', 'closed');
  }
  if (thread.messageCount >= INBOX_LIMITS.messagesPerThread) {
    throw refuse('resource-exhausted', 'This conversation is full.', 'thread-full');
  }
  if (thread.kind === 'appeal') await requireLiveBlocked(deps, sender);
  const limits = dailyLimits(await tx.getLimits(sender.uid), now);
  assertDailyMessages(limits, sender.accountStatus);

  // -- writes
  const snippet = snippetOf(text);
  const fields = senderFields(sender);
  tx.createMessage(threadId, requestId, {
    seq: thread.messageCount + 1,
    authorRole: 'sender',
    authorUid: sender.uid,
    authorName: fields.senderName,
    authorPhotoURL: fields.senderPhotoURL,
    text,
    createdAt: now,
  });
  tx.updateThread(threadId, {
    status: 'open',
    messageCount: thread.messageCount + 1,
    lastMessageAt: now,
    lastMessageBy: 'sender',
    lastSnippet: snippet,
    adminUnread: true,
    updatedAt: now,
  });
  tx.setLimits(sender.uid, {
    ...limits,
    messagesToday: limits.messagesToday + 1,
    updatedAt: now,
  });
  return {
    result: { threadId, status: 'open' },
    notice: {
      threadId,
      subject: thread.subject,
      snippet,
      senderUid: sender.uid,
      senderName: fields.senderName,
      senderPhotoURL: fields.senderPhotoURL,
    },
  };
}

// -- the admin side ------------------------------------------------------------------------------

interface ManageOutcome {
  result: ManageInboxThreadResult;
  notice: ReplyNotice | null;
}

/** `manageInboxThread`. The caller has already passed `assertAdminToken`. */
export async function manageInboxThread(
  deps: InboxDeps,
  admin: InboxAdmin,
  input: ManageInboxThreadRequest,
): Promise<ManageInboxThreadResult> {
  if (input.action === 'delete') {
    await deleteThread(deps, input.threadId);
    return { threadId: input.threadId, status: null };
  }

  let outcome: ManageOutcome;
  switch (input.action) {
    case 'reply': {
      const text = cleanText(input.text);
      outcome = await deps.store.transaction((tx) => adminReply(deps, tx, admin, input, text));
      break;
    }
    case 'close':
      outcome = await deps.store.transaction((tx) => adminClose(deps, tx, admin, input.threadId));
      break;
    case 'reopen': {
      const blocked = await requireBlockedIfAppeal(deps, input.threadId);
      outcome = await deps.store.transaction((tx) =>
        adminReopen(deps, tx, admin, input.threadId, blocked),
      );
      break;
    }
    case 'keepBlocked': {
      const text = input.text === undefined ? null : cleanText(input.text);
      await requireBlockedIfAppeal(deps, input.threadId);
      outcome = await deps.store.transaction((tx) =>
        adminKeepBlocked(deps, tx, admin, input.threadId, input.requestId ?? null, text),
      );
      break;
    }
  }
  if (outcome.notice) await notifySender(deps, outcome.notice);
  return outcome.result;
}

/**
 * For appeals, the sender must still be blocked (checked against the Auth claims, outside the
 * transaction; an unblock racing this call is closed by `closeOpenAppeals` anyway). Returns whether
 * the check applied. Missing threads are reported as `not-found`.
 */
async function requireBlockedIfAppeal(deps: InboxDeps, threadId: string): Promise<boolean> {
  const thread = await deps.store.getThread(threadId);
  if (!thread) throw notFound();
  if (thread.kind !== 'appeal') return false;
  const status = await deps.auth.getAccountStatus(thread.senderUid);
  if (status !== 'blocked') {
    throw new HttpsError('failed-precondition', 'This person is no longer blocked.');
  }
  return true;
}

function adminMessage(text: string, seq: number, now: Date): MessageData {
  // T6: no uid, name or photo on an admin message.
  return {
    seq,
    authorRole: 'admin',
    authorUid: null,
    authorName: null,
    authorPhotoURL: null,
    text,
    createdAt: now,
  };
}

async function adminReply(
  deps: InboxDeps,
  tx: InboxTx,
  admin: InboxAdmin,
  input: Extract<ManageInboxThreadRequest, { action: 'reply' }>,
  text: string,
): Promise<ManageOutcome> {
  const now = clock(deps);
  const { threadId, requestId } = input;
  const thread = await tx.getThread(threadId);
  if (!thread) throw notFound();
  const sent = await tx.getMessage(threadId, requestId);
  if (sent) {
    if (sent.authorRole === 'admin') {
      return { result: { threadId, status: thread.status }, notice: null };
    }
    throw new HttpsError('already-exists', 'This request id is already used.');
  }
  if (thread.status === 'closed') {
    throw refuse('failed-precondition', 'This conversation is closed.', 'closed');
  }
  if (thread.messageCount >= INBOX_LIMITS.messagesPerThread) {
    throw refuse('resource-exhausted', 'This conversation is full.', 'thread-full');
  }

  const snippet = snippetOf(text);
  tx.createMessage(threadId, requestId, adminMessage(text, thread.messageCount + 1, now));
  tx.updateThread(threadId, {
    status: 'answered',
    messageCount: thread.messageCount + 1,
    lastMessageAt: now,
    lastMessageBy: 'admin',
    lastSnippet: snippet,
    senderUnread: true,
    adminUnread: false,
    updatedAt: now,
  });
  tx.createAudit(threadId, requestId, { adminUid: admin.uid, action: 'reply', createdAt: now });
  // Feedback senders get a bell card (never when the admin wrote the feedback themselves); a
  // blocked appellant cannot read the bell and sees the reply live on the blocked screen.
  const notice: ReplyNotice | null =
    thread.kind === 'feedback' && thread.senderUid !== admin.uid
      ? { threadId, subject: thread.subject, snippet, recipientUid: thread.senderUid }
      : null;
  return { result: { threadId, status: 'answered' }, notice };
}

async function adminClose(
  deps: InboxDeps,
  tx: InboxTx,
  admin: InboxAdmin,
  threadId: string,
): Promise<ManageOutcome> {
  const now = clock(deps);
  const thread = await tx.getThread(threadId);
  if (!thread) throw notFound();
  if (thread.kind !== 'feedback') {
    throw new HttpsError('failed-precondition', 'Appeals are closed with Unblock or Keep blocked.');
  }
  if (thread.status === 'closed') return { result: { threadId, status: 'closed' }, notice: null };
  tx.updateThread(threadId, {
    status: 'closed',
    closedAt: now,
    adminUnread: false,
    updatedAt: now,
  });
  tx.createAudit(threadId, freshId(deps), { adminUid: admin.uid, action: 'close', createdAt: now });
  return { result: { threadId, status: 'closed' }, notice: null };
}

async function adminReopen(
  deps: InboxDeps,
  tx: InboxTx,
  admin: InboxAdmin,
  threadId: string,
  checkedBlocked: boolean,
): Promise<ManageOutcome> {
  const now = clock(deps);
  const thread = await tx.getThread(threadId);
  if (!thread) throw notFound();
  if (thread.status !== 'closed') {
    return { result: { threadId, status: thread.status }, notice: null };
  }
  // The blocked check ran for this thread's kind before the transaction; make sure it still applies.
  if (thread.kind === 'appeal' && !checkedBlocked) {
    throw new HttpsError('failed-precondition', 'This person is no longer blocked.');
  }
  let limits: LimitsData | null = null;
  if (thread.kind === 'appeal') {
    const others = await tx.findSenderThreads({
      senderUid: thread.senderUid,
      kind: 'appeal',
      statuses: OPEN_STATUSES,
      limit: 1,
    });
    if (others.length > 0) {
      throw refuse('already-exists', 'This person already has an open appeal.', 'appeal-open', {
        threadId: others[0]!.id,
      });
    }
    limits = await tx.getLimits(thread.senderUid);
  }

  const status: InboxStatus = thread.lastMessageBy === 'sender' ? 'open' : 'answered';
  tx.updateThread(threadId, { status, closedAt: null, outcome: null, updatedAt: now });
  tx.createAudit(threadId, freshId(deps), {
    adminUid: admin.uid,
    action: 'reopen',
    createdAt: now,
  });
  if (limits?.appealRefusedAt) {
    tx.setLimits(thread.senderUid, { ...limits, appealRefusedAt: null, updatedAt: now });
  }
  return { result: { threadId, status }, notice: null };
}

async function adminKeepBlocked(
  deps: InboxDeps,
  tx: InboxTx,
  admin: InboxAdmin,
  threadId: string,
  requestId: string | null,
  text: string | null,
): Promise<ManageOutcome> {
  const now = clock(deps);
  const thread = await tx.getThread(threadId);
  if (!thread) throw notFound();
  if (requestId) {
    const sent = await tx.getMessage(threadId, requestId);
    if (sent) {
      if (sent.authorRole === 'admin') {
        return { result: { threadId, status: thread.status }, notice: null };
      }
      throw new HttpsError('already-exists', 'This request id is already used.');
    }
  }
  if (thread.kind !== 'appeal') {
    throw new HttpsError('failed-precondition', 'Keep blocked applies to appeals only.');
  }
  if (thread.status === 'closed') {
    // A retry of a plain Keep blocked that already went through.
    if (text === null && thread.outcome === 'upheld') {
      return { result: { threadId, status: 'closed' }, notice: null };
    }
    throw refuse('failed-precondition', 'This conversation is closed.', 'closed');
  }
  if (text !== null && thread.messageCount >= INBOX_LIMITS.messagesPerThread) {
    throw refuse('resource-exhausted', 'This conversation is full.', 'thread-full');
  }
  const limits = dailyLimits(await tx.getLimits(thread.senderUid), now);

  const patch: Partial<ThreadData> = {
    status: 'closed',
    outcome: 'upheld',
    closedAt: now,
    adminUnread: false,
    updatedAt: now,
  };
  if (text !== null && requestId) {
    tx.createMessage(threadId, requestId, adminMessage(text, thread.messageCount + 1, now));
    Object.assign(patch, {
      messageCount: thread.messageCount + 1,
      lastMessageAt: now,
      lastMessageBy: 'admin',
      lastSnippet: snippetOf(text),
      senderUnread: true,
    } satisfies Partial<ThreadData>);
  }
  tx.updateThread(threadId, patch);
  tx.createAudit(threadId, requestId ?? freshId(deps), {
    adminUid: admin.uid,
    action: 'keepBlocked',
    createdAt: now,
  });
  // Starts the wait before the next appeal; cleared when an admin reopens this appeal.
  tx.setLimits(thread.senderUid, { ...limits, appealRefusedAt: now, updatedAt: now });
  return { result: { threadId, status: 'closed' }, notice: null };
}

// -- unblock -------------------------------------------------------------------------------------

/**
 * On approve or unblock: close this person's open or answered appeals with `outcome: 'unblocked'`.
 * `inboxAudit` records `system:unblock`. Resolves to how many it closed.
 */
export async function closeOpenAppeals(
  deps: Pick<InboxDeps, 'store' | 'now' | 'newId'>,
  uid: string,
): Promise<number> {
  return deps.store.transaction(async (tx) => {
    const now = clock(deps);
    const open = await tx.findSenderThreads({
      senderUid: uid,
      kind: 'appeal',
      statuses: OPEN_STATUSES,
      limit: 20,
    });
    for (const { id } of open) {
      tx.updateThread(id, {
        status: 'closed',
        outcome: 'unblocked',
        closedAt: now,
        adminUnread: false,
        updatedAt: now,
      });
      tx.createAudit(id, freshId(deps), {
        adminUid: SYSTEM_UNBLOCK,
        action: 'unblock',
        createdAt: now,
      });
    }
    return open.length;
  });
}

// -- delete --------------------------------------------------------------------------------------

/**
 * Deletes a thread for good: the bell cards of every admin and the sender, the messages and the
 * `inboxAudit` entries (in batches), then the note and the thread document last, so a crash midway
 * leaves a thread that can simply be deleted again. `inboxLimits` stays on purpose: deleting a
 * thread must not reset the sender's daily caps or the appeal wait. Reused by the daily purge.
 * Resolves to whether the thread document existed.
 */
export async function deleteThread(
  deps: Pick<InboxDeps, 'store' | 'auth'>,
  threadId: string,
): Promise<boolean> {
  const { store, auth } = deps;
  const thread = await store.getThread(threadId);
  // Current admins, every admin who was ever notified of this thread (they may have lost the role
  // since), and the sender.
  const uids = new Set([
    ...(await auth.listAdminUids()),
    ...(await store.getNotifiedUids(threadId)),
  ]);
  if (thread) uids.add(thread.senderUid);

  const refs = [...uids].flatMap((uid) =>
    (['inbox_new', 'inbox_reply'] as const).map((kind) => ({
      uid,
      id: notificationId(kind, threadId, uid),
    })),
  );
  for (let i = 0; i < refs.length; i += INBOX_DELETE_BATCH) {
    await store.deleteNotifications(refs.slice(i, i + INBOX_DELETE_BATCH));
  }
  for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
    if ((await store.deleteMessagesBatch(threadId, INBOX_DELETE_BATCH)) < INBOX_DELETE_BATCH) break;
  }
  for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
    if ((await store.deleteAuditBatch(threadId, INBOX_DELETE_BATCH)) < INBOX_DELETE_BATCH) break;
  }
  await store.deleteNoteAndThread(threadId);
  return thread !== null;
}
