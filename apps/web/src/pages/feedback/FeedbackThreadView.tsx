import { Button, Label, Loader } from '@vibe/core';
import { NavigationChevronLeft } from '@vibe/icons';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Composer } from '../../components/inbox/Composer';
import { MessageList } from '../../components/inbox/MessageList';
import { inboxWrites, useInboxMessages, useInboxThread } from '../../data/inbox';
import { inboxCalls } from '../../lib/callables';
import { formatDate } from '../../lib/format';
import { CATEGORY_LABELS, describeInboxError, senderCanReply } from '../../lib/inbox-sender';
import styles from './Feedback.module.css';
import { StatusChip } from './MyFeedbackPage';

/** One of the person's feedback conversations (`/feedback/:threadId`): messages and a reply box. */
export function FeedbackThreadView() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const { data: thread, loading, error } = useInboxThread(threadId);
  const { data: messages, error: messagesError } = useInboxMessages(threadId);

  // Opening a thread (or an admin reply arriving while it is open) clears the unread dot. The rules
  // allow exactly this write: only `senderUnread`, only to false.
  const unread = thread?.senderUnread === true;
  useEffect(() => {
    if (!threadId || !unread) return;
    inboxWrites.markSenderRead(threadId).catch((e: unknown) => {
      console.error('Could not mark the conversation read', e);
    });
  }, [threadId, unread]);

  const back = (
    <Button
      className={styles.back}
      kind="tertiary"
      size="small"
      leftIcon={NavigationChevronLeft}
      onClick={() => void navigate('/feedback')}
    >
      Back to My feedback
    </Button>
  );

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.center} role="status" aria-label="Loading the conversation">
          <Loader size="medium" />
        </div>
      </div>
    );
  }
  if (error || !thread || !threadId) {
    return (
      <div className={styles.page}>
        {back}
        <p className={error ? styles.error : styles.closedNote} role={error ? 'alert' : undefined}>
          {error ? 'Could not load this conversation.' : 'This conversation no longer exists.'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {back}
      <header className={styles.header}>
        <h1 className={styles.title}>{thread.subject}</h1>
        <div className={styles.meta}>
          {thread.category ? (
            <Label text={CATEGORY_LABELS[thread.category]} color="primary" kind="line" />
          ) : null}
          <StatusChip status={thread.status} />
          <span>{`Started ${formatDate(thread.createdAt)}`}</span>
        </div>
      </header>
      <div className={styles.conversation}>
        {messagesError ? (
          <p className={styles.error} role="alert">
            Could not load the messages.
          </p>
        ) : null}
        <MessageList messages={messages} thread={thread} />
        {senderCanReply(thread) ? (
          <Composer
            label="Reply"
            placeholder="Write a reply"
            submitLabel="Send"
            describeError={(e) => describeInboxError(e, 'Could not send the reply. Try again.')}
            onSubmit={async (text, requestId) => {
              await inboxCalls.send({ action: 'reply', threadId, requestId, text });
            }}
          />
        ) : (
          <p className={styles.closedNote}>This conversation is closed.</p>
        )}
      </div>
    </div>
  );
}
