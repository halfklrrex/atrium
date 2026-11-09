import { Button, Label, Loader } from '@vibe/core';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { StatusChip } from '../../components/inbox/StatusChip';
import { useUiStore } from '../../components/AppShell/ui-store';
import { useMyFeedbackThreads, type InboxThreadDoc } from '../../data/inbox';
import { formatRelativeShort } from '../../lib/format';
import { CATEGORY_SHORT_LABELS, SENDER_STATUS_LABELS } from '../../lib/inbox-sender';
import styles from './Feedback.module.css';

function ThreadRow({ thread, onOpen }: { thread: InboxThreadDoc; onOpen: () => void }) {
  const unread = thread.senderUnread;
  return (
    <li>
      <button type="button" className={styles.row} onClick={onOpen}>
        <span
          className={unread ? `${styles.dot} ${styles.dotOn}` : styles.dot}
          role={unread ? 'img' : undefined}
          aria-label={unread ? 'Unread reply' : undefined}
        />
        <span className={styles.rowText}>
          <span className={unread ? `${styles.subject} ${styles.subjectUnread}` : styles.subject}>
            {thread.subject}
          </span>
          <span className={styles.snippet}>{thread.lastSnippet}</span>
        </span>
        <span className={styles.rowSide}>
          <span className={styles.chips}>
            {thread.category ? (
              <Label text={CATEGORY_SHORT_LABELS[thread.category]} color="primary" kind="line" />
            ) : null}
            <StatusChip status={thread.status} labels={SENDER_STATUS_LABELS} />
          </span>
          <span className={styles.time}>{formatRelativeShort(thread.lastMessageAt)}</span>
        </span>
      </button>
    </li>
  );
}

/** "My feedback" (`/feedback`): the signed-in person's own feedback conversations, newest first. */
export function MyFeedbackPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const openDialog = useUiStore((s) => s.openDialog);
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsComplaint = searchParams.get('new') === 'complaint';

  // `/feedback?new=complaint` (linked from the privacy notice) opens the dialog once on the
  // complaint category, then drops the parameter so a reload or Back does not reopen it.
  useEffect(() => {
    if (!wantsComplaint) return;
    openDialog({ type: 'feedback', category: 'complaint' });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [wantsComplaint, openDialog, setSearchParams]);
  const { data: threads, loading, error } = useMyFeedbackThreads(user?.uid ?? null);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1 className={styles.heading}>My feedback</h1>
        <Button size="small" onClick={() => openDialog({ type: 'feedback' })}>
          Send feedback
        </Button>
      </div>
      <p className={styles.lead}>Your messages to the site administrators, and their replies.</p>

      {error ? (
        <p className={styles.error} role="alert">
          Could not load your feedback. Try again in a moment.
        </p>
      ) : null}

      {threads.length > 0 ? (
        <ul className={styles.list} aria-label="Your conversations">
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} onOpen={() => void navigate(`/feedback/${t.id}`)} />
          ))}
        </ul>
      ) : null}

      {loading ? (
        <div className={styles.center} role="status" aria-label="Loading your feedback">
          <Loader size="medium" />
        </div>
      ) : threads.length === 0 && !error ? (
        <div className={styles.center}>You have not sent any feedback yet.</div>
      ) : null}
    </div>
  );
}
