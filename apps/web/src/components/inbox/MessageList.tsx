import { INBOX_ADMIN_LABEL, type InboxThread } from '@atrium/shared';
import { Avatar } from '@vibe/core';
import type { InboxMessageDoc } from '../../data/inbox';
import { formatRelativeShort } from '../../lib/format';
import { senderLabel } from '../../lib/inbox-sender';
import { SenderAvatar } from './SenderAvatar';
import styles from './MessageList.module.css';

type ThreadIdentity = Pick<InboxThread, 'senderName' | 'senderEmail' | 'senderPhotoURL'>;

function Message({ message, thread }: { message: InboxMessageDoc; thread: ThreadIdentity }) {
  const isAdmin = message.authorRole === 'admin';
  const name = isAdmin ? INBOX_ADMIN_LABEL : (message.authorName ?? senderLabel(thread));
  return (
    <article className={styles.message} aria-label={isAdmin ? 'Admin message' : 'Message'}>
      <header className={styles.messageHeader}>
        <div className={styles.avatar}>
          {isAdmin ? (
            <Avatar
              type="text"
              text="SA"
              size="medium"
              backgroundColor="winter"
              aria-label={name}
            />
          ) : (
            <SenderAvatar
              name={name}
              photoURL={message.authorPhotoURL ?? thread.senderPhotoURL}
              size="medium"
            />
          )}
        </div>
        <span className={styles.author}>{name}</span>
        <span className={styles.messageTime}>{formatRelativeShort(message.createdAt)}</span>
      </header>
      {/* Plain text only: React escapes it and `pre-wrap` keeps the line breaks. */}
      <div className={styles.messageText}>{message.text}</div>
    </article>
  );
}

/**
 * The messages of one conversation, oldest first, styled like an item update. Admin messages always
 * show "Site Administrator" (T6): no admin name is ever stored for the sender to see. Shared by the
 * admin thread view and the sender's views.
 */
export function MessageList({
  messages,
  thread,
}: {
  messages: InboxMessageDoc[];
  thread: ThreadIdentity;
}) {
  return (
    <div className={styles.messages} aria-label="Messages">
      {messages.map((m) => (
        <Message key={m.id} message={m} thread={thread} />
      ))}
    </div>
  );
}
