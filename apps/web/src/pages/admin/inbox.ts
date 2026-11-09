import {
  INBOX_ADMIN_LABEL,
  type InboxKind,
  type InboxOutcome,
  type InboxStatus,
  type InboxThread,
} from '@atrium/shared';
import { CATEGORY_LABELS, senderLabel } from '../../lib/inbox-sender';

export { INBOX_ADMIN_LABEL };

export type InboxStatusFilter = InboxStatus | 'all';
export type InboxKindFilter = InboxKind | 'all';

export const INBOX_STATUS_FILTERS: readonly InboxStatusFilter[] = [
  'open',
  'answered',
  'closed',
  'all',
];
export const INBOX_KIND_FILTERS: readonly InboxKindFilter[] = ['all', 'appeal', 'feedback'];

export const INBOX_STATUS_LABELS: Record<InboxStatusFilter, string> = {
  open: 'Open',
  answered: 'Answered',
  closed: 'Closed',
  all: 'All',
};

export const INBOX_KIND_LABELS: Record<InboxKindFilter, string> = {
  all: 'All',
  appeal: 'Appeals',
  feedback: 'Feedback',
};

/** The badge on the Inbox tab and the profile menu: the number, or "99+" above 99. */
export function formatInboxCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** "Appeal", "Feedback" or "Feedback · Bug". */
export function kindLabel(t: Pick<InboxThread, 'kind' | 'category'>): string {
  if (t.kind === 'appeal') return 'Appeal';
  return t.category ? `Feedback · ${CATEGORY_LABELS[t.category]}` : 'Feedback';
}

/** The email line, left out when it would repeat the name. */
export function senderEmailLine(t: Pick<InboxThread, 'senderName' | 'senderEmail'>): string | null {
  return t.senderEmail && t.senderEmail !== senderLabel(t) ? t.senderEmail : null;
}

export const OUTCOME_LABELS: Record<InboxOutcome, string> = {
  unblocked: 'Unblocked',
  upheld: 'Kept blocked',
};

/** Empty-state text for the list, per filter. */
export function emptyMessage(status: InboxStatusFilter, kind: InboxKindFilter): string {
  const what = kind === 'appeal' ? 'appeals' : kind === 'feedback' ? 'feedback' : 'messages';
  switch (status) {
    case 'open':
      return `Nothing is waiting for you. No open ${what}.`;
    case 'answered':
      return `No answered ${what} yet.`;
    case 'closed':
      return `No closed ${what}.`;
    default:
      return kind === 'all' ? 'No messages yet.' : `No ${what} yet.`;
  }
}

/** Replies are possible while the thread is not closed. */
export function canReply(t: Pick<InboxThread, 'status'>): boolean {
  return t.status !== 'closed';
}

/** How long the note waits after the last keystroke before it is saved. */
export const NOTE_SAVE_DEBOUNCE_MS = 800;
