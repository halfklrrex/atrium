/**
 * Sender-side helpers of the appeals and feedback Inbox (ADMIN-4 PR6): the exact text for each
 * server refusal, the appeal wait date math and the labels the sender sees.
 */
import {
  INBOX_ERROR_REASONS,
  INBOX_LIMITS,
  type InboxCategory,
  type InboxErrorReason,
  type InboxStatus,
  type InboxThread,
} from '@atrium/shared';
import { describeCallableError } from './callables';
import { formatDate } from './format';

const DAY_MS = 86_400_000;

export const FEEDBACK_CATEGORIES: readonly { value: InboxCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

export const CATEGORY_LABELS: Record<InboxCategory, string> = {
  bug: 'Bug',
  idea: 'Idea',
  question: 'Question',
  other: 'Other',
};

/** What the sender calls each status (an admin never "closes" on them in the abstract). */
export const SENDER_STATUS_LABELS: Record<InboxStatus, string> = {
  open: 'Waiting for a reply',
  answered: 'Answered',
  closed: 'Closed',
};

function isReason(value: unknown): value is InboxErrorReason {
  return (INBOX_ERROR_REASONS as readonly unknown[]).includes(value);
}

interface ErrorDetails {
  reason?: unknown;
  retryAfter?: unknown;
}

/** The refusal reason the server attached to a callable error, if it is one we know. */
export function inboxErrorReason(error: unknown): InboxErrorReason | null {
  const reason = ((error as { details?: ErrorDetails } | null)?.details ?? {}).reason;
  return isReason(reason) ? reason : null;
}

/**
 * Exact text for a refused send or reply. `blocked` picks the daily message cap that applies to the
 * caller (a blocked person has fewer messages a day). Unknown errors fall back to the generic
 * callable description.
 */
export function describeInboxError(
  error: unknown,
  fallback: string,
  options: { blocked?: boolean } = {},
): string {
  const reason = inboxErrorReason(error);
  switch (reason) {
    case 'daily-thread-limit':
      return `You can start ${INBOX_LIMITS.feedbackThreadsPerDay} conversations a day. Try again tomorrow.`;
    case 'open-thread-limit':
      return `You can have ${INBOX_LIMITS.openFeedbackThreads} open conversations at a time. Wait for a reply or for one to close.`;
    case 'daily-message-limit': {
      const cap = options.blocked
        ? INBOX_LIMITS.messagesPerDayBlocked
        : INBOX_LIMITS.messagesPerDayApproved;
      return `You can send ${cap} messages a day. Try again tomorrow.`;
    }
    case 'thread-full':
      return `This conversation has reached ${INBOX_LIMITS.messagesPerThread} messages. Start a new one.`;
    case 'appeal-open':
      return 'You already have an open appeal. Reply to it below.';
    case 'appeal-wait': {
      const retryAfter = ((error as { details?: ErrorDetails }).details ?? {}).retryAfter;
      const when = typeof retryAfter === 'string' ? Date.parse(retryAfter) : NaN;
      return Number.isNaN(when)
        ? `You can send a new appeal ${INBOX_LIMITS.appealWaitDays} days after the last one was decided.`
        : `You can send a new appeal from ${formatDate({ toMillis: () => when })}.`;
    }
    case 'closed':
      return 'This conversation is closed, so it cannot take new messages.';
    case 'account-not-approved':
    case null:
      return describeCallableError(error, fallback);
  }
}

type Millis = { toMillis(): number };
type AppealThread = Pick<InboxThread, 'status' | 'outcome'> & { closedAt: Millis | null };

export interface AppealWait {
  /** When the appeal was decided (`closedAt`). */
  decidedAt: Millis;
  /** The first moment a new appeal is accepted: `decidedAt` plus 7 days. */
  retryFrom: Millis;
  /** True while `now` is before `retryFrom`. */
  waiting: boolean;
}

/** The wait after a rejected appeal, or `null` when the thread is not a closed, upheld appeal. */
export function appealWait(thread: AppealThread, now: number = Date.now()): AppealWait | null {
  if (thread.status !== 'closed' || thread.outcome !== 'upheld' || !thread.closedAt) return null;
  const decided = thread.closedAt.toMillis();
  const retryFrom = decided + INBOX_LIMITS.appealWaitDays * DAY_MS;
  return {
    decidedAt: { toMillis: () => decided },
    retryFrom: { toMillis: () => retryFrom },
    waiting: now < retryFrom,
  };
}

/** "Your appeal was not accepted on {date}. You can send a new appeal from {date + 7 days}." */
export function upheldNotice(wait: AppealWait): string {
  return `Your appeal was not accepted on ${formatDate(wait.decidedAt)}. You can send a new appeal from ${formatDate(wait.retryFrom)}.`;
}

/** A sender may reply while the conversation is not closed. */
export function senderCanReply(t: Pick<InboxThread, 'status'>): boolean {
  return t.status !== 'closed';
}
