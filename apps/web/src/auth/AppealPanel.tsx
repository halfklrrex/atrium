import { Loader } from '@vibe/core';
import { useState } from 'react';
import { Composer } from '../components/inbox/Composer';
import { MessageList } from '../components/inbox/MessageList';
import { useInboxMessages, useMyLatestAppeal, type InboxThreadDoc } from '../data/inbox';
import { inboxCalls } from '../lib/callables';
import { appealWait, describeInboxError, senderCanReply, upheldNotice } from '../lib/inbox-sender';
import styles from './AppealPanel.module.css';

const describeBlockedError = (fallback: string) => (e: unknown) =>
  describeInboxError(e, fallback, { blocked: true });

function NewAppealBox({ disabled = false }: { disabled?: boolean }) {
  return (
    <Composer
      label="Your appeal"
      placeholder="Tell the site administrator why you think this is a mistake"
      submitLabel="Send appeal"
      disabled={disabled}
      describeError={describeBlockedError('Could not send the appeal. Try again.')}
      onSubmit={async (text, requestId) => {
        await inboxCalls.send({ action: 'appeal', requestId, text });
      }}
    />
  );
}

function ReplyBox({ threadId }: { threadId: string }) {
  return (
    <Composer
      label="Reply"
      placeholder="Write a reply"
      submitLabel="Send"
      describeError={describeBlockedError('Could not send the reply. Try again.')}
      onSubmit={async (text, requestId) => {
        await inboxCalls.send({ action: 'reply', threadId, requestId, text });
      }}
    />
  );
}

function AppealThread({ thread, now }: { thread: InboxThreadDoc; now: number }) {
  const { data: messages, error } = useInboxMessages(thread.id);
  const wait = appealWait(thread, now);

  return (
    <>
      {error ? (
        <p className={styles.error} role="alert">
          Could not load your appeal.
        </p>
      ) : (
        <MessageList messages={messages} thread={thread} />
      )}
      {senderCanReply(thread) ? (
        <>
          <p className={styles.note}>We&apos;ll show the reply here.</p>
          <ReplyBox threadId={thread.id} />
        </>
      ) : wait ? (
        <>
          <p className={styles.note}>{upheldNotice(wait)}</p>
          <NewAppealBox disabled={wait.waiting} />
        </>
      ) : (
        <p className={styles.note}>
          This appeal is closed. If your account was unblocked, you&apos;ll be taken into Atrium in
          a moment.
        </p>
      )}
    </>
  );
}

/**
 * The appeal part of the blocked screen (ADMIN-4 PR6). A blocked person reads only their own appeal
 * threads, so the query filters `kind == 'appeal'`. States: no appeal yet (the box), an open or
 * answered appeal (the live thread and a reply box), a rejected one (the thread, the wait and a
 * disabled box until it ends; the server enforces the wait as well).
 */
export function AppealPanel({ uid, now }: { uid: string; now?: number }) {
  const [clock] = useState(() => now ?? Date.now());
  const { data: thread, loading, error } = useMyLatestAppeal(uid);

  if (loading) {
    return (
      <div className={styles.panel} role="status" aria-label="Loading your appeal">
        <Loader size="small" />
      </div>
    );
  }
  if (error) {
    return (
      <p className={styles.error} role="alert">
        Could not load your appeal. Reload the page to try again.
      </p>
    );
  }
  return (
    <div className={styles.panel}>
      {thread ? <AppealThread thread={thread} now={clock} /> : <NewAppealBox />}
    </div>
  );
}
