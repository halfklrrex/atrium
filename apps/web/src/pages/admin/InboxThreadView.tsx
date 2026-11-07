import {
  INBOX_ADMIN_LABEL,
  INBOX_LIMITS,
  normalizeInboxText,
  type InboxThread,
} from '@atrium/shared';
import {
  Avatar,
  Button,
  Label,
  Loader,
  Menu,
  MenuButton,
  MenuItem,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TextArea,
} from '@vibe/core';
import { Delete, NavigationChevronLeft } from '@vibe/icons';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { showToast } from '../../components/toast-store';
import {
  inboxWrites,
  useInboxMessages,
  useInboxThread,
  type InboxMessageDoc,
  type InboxThreadDoc,
} from '../../data/inbox';
import { accountAdminCalls, describeCallableError, inboxCalls } from '../../lib/callables';
import { formatDate, formatRelativeShort } from '../../lib/format';
import { InboxNote } from './InboxNote';
import {
  OUTCOME_LABELS,
  canReply,
  kindLabel,
  senderEmailLine,
  senderLabel,
  statusLabel,
} from './inbox';
import styles from './Inbox.module.css';
import { SenderAvatar } from './SenderAvatar';

type Confirm = 'unblock' | 'keepBlocked' | 'delete' | null;

function Message({ message, thread }: { message: InboxMessageDoc; thread: InboxThreadDoc }) {
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

function Counter({ length }: { length: number }) {
  const over = length > INBOX_LIMITS.text;
  return (
    <span className={over ? `${styles.counter} ${styles.counterOver}` : styles.counter}>
      {`${length} / ${INBOX_LIMITS.text}`}
    </span>
  );
}

function ReplyBox({ threadId }: { threadId: string }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const requestId = useRef<string | null>(null);
  const normalized = normalizeInboxText(text);
  const invalid = normalized.length === 0 || text.length > INBOX_LIMITS.text;

  const send = async () => {
    if (invalid || sending) return;
    // One id per message: a retry after a failure sends the same id (the server is idempotent).
    requestId.current ??= crypto.randomUUID();
    setSending(true);
    try {
      await inboxCalls.manage({
        action: 'reply',
        threadId,
        requestId: requestId.current,
        text: normalized,
      });
      requestId.current = null;
      setText('');
    } catch (e) {
      showToast(describeCallableError(e, 'Could not send the reply. Try again.'), {
        type: 'negative',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.composer}>
      <TextArea
        label="Reply"
        aria-label="Reply"
        value={text}
        rows={4}
        placeholder="Write a reply"
        disabled={sending}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
          requestId.current = null;
          setText(e.target.value);
        }}
      />
      <div className={styles.composerFooter}>
        <Counter length={text.length} />
        <Button size="small" disabled={invalid} loading={sending} onClick={() => void send()}>
          Send
        </Button>
      </div>
    </div>
  );
}

function ConfirmDialog({
  kind,
  thread,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: Exclude<Confirm, null>;
  thread: InboxThread;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (finalMessage: string) => void;
}) {
  const [message, setMessage] = useState('');
  const name = senderLabel(thread);
  const copy = {
    unblock: {
      title: 'Unblock this account?',
      body: `${name} can use Atrium again, and this appeal is closed.`,
      action: 'Unblock',
    },
    keepBlocked: {
      title: 'Keep this account blocked?',
      body: `The appeal is closed and ${name} can send a new one after ${INBOX_LIMITS.appealWaitDays} days. You can add a last message they will see.`,
      action: 'Keep blocked',
    },
    delete: {
      title: 'Delete this conversation?',
      body: 'This removes the thread, its messages and the internal note for good. It cannot be undone.',
      action: 'Delete',
    },
  }[kind];
  const tooLong = message.length > INBOX_LIMITS.text;

  return (
    <Modal id="inbox-confirm" show size="small" onClose={onCancel}>
      <ModalBasicLayout>
        <ModalHeader title={copy.title} />
        <ModalContent>
          <div className={styles.confirmBody}>
            <p>{copy.body}</p>
            {kind === 'keepBlocked' ? (
              <>
                <TextArea
                  label="Final message (optional)"
                  aria-label="Final message (optional)"
                  value={message}
                  rows={4}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setMessage(e.target.value)
                  }
                />
                <Counter length={message.length} />
              </>
            ) : null}
          </div>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: copy.action,
          onClick: () => onConfirm(message),
          disabled: busy || tooLong,
          loading: busy,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onCancel, disabled: busy }}
      />
    </Modal>
  );
}

function ThreadHeader({
  thread,
  busy,
  onClose,
  onReopen,
  onConfirm,
}: {
  thread: InboxThreadDoc;
  busy: boolean;
  onClose: () => void;
  onReopen: () => void;
  onConfirm: (kind: Exclude<Confirm, null>) => void;
}) {
  const email = senderEmailLine(thread);
  const closed = thread.status === 'closed';
  return (
    <header className={styles.header}>
      <div className={styles.headerMain}>
        <h1 className={styles.subjectTitle}>{thread.subject}</h1>
        <div className={styles.meta}>
          <SenderAvatar name={senderLabel(thread)} photoURL={thread.senderPhotoURL} />
          <span>{senderLabel(thread)}</span>
          {email ? <span>{email}</span> : null}
        </div>
        <div className={styles.meta}>
          <Label text={kindLabel(thread)} color="primary" kind="line" />
          <Label
            text={statusLabel(thread.status)}
            color={thread.status === 'answered' ? 'positive' : 'primary'}
            kind={closed ? 'line' : 'fill'}
          />
          <span>{`Started ${formatDate(thread.createdAt)}`}</span>
          {closed && thread.kind === 'appeal' && thread.outcome ? (
            <span>{`Outcome: ${OUTCOME_LABELS[thread.outcome]}`}</span>
          ) : null}
        </div>
      </div>
      <div className={styles.actions}>
        {thread.kind === 'feedback' ? (
          closed ? (
            <Button size="small" kind="secondary" disabled={busy} onClick={onReopen}>
              Reopen
            </Button>
          ) : (
            <Button size="small" kind="secondary" disabled={busy} onClick={onClose}>
              Close
            </Button>
          )
        ) : closed ? (
          <Button size="small" kind="secondary" disabled={busy} onClick={onReopen}>
            Reopen
          </Button>
        ) : (
          <>
            <Button size="small" disabled={busy} onClick={() => onConfirm('unblock')}>
              Unblock
            </Button>
            <Button
              size="small"
              kind="secondary"
              color="negative"
              disabled={busy}
              onClick={() => onConfirm('keepBlocked')}
            >
              Keep blocked
            </Button>
          </>
        )}
        <MenuButton size="small" aria-label="More actions" closeMenuOnItemClick>
          <Menu id="inbox-thread-menu" size="small">
            <MenuItem title="Delete thread" icon={Delete} onClick={() => onConfirm('delete')} />
          </Menu>
        </MenuButton>
      </div>
    </header>
  );
}

/** One conversation (`/admin/inbox/:threadId`): messages, reply box, actions and the internal note. */
export function InboxThreadView() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: thread, loading, error } = useInboxThread(threadId);
  const { data: messages, error: messagesError } = useInboxMessages(threadId);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  // Opening a thread (or a new sender message arriving while it is open) clears the unread dot.
  const unread = thread?.adminUnread === true;
  useEffect(() => {
    if (!threadId || !unread) return;
    inboxWrites.markThreadRead(threadId).catch((e: unknown) => {
      console.error('Could not mark the thread read', e);
    });
  }, [threadId, unread]);

  const back = (
    <Button
      className={styles.back}
      kind="tertiary"
      size="small"
      leftIcon={NavigationChevronLeft}
      onClick={() => void navigate('/admin/inbox')}
    >
      Back to Inbox
    </Button>
  );

  if (loading) {
    return (
      <div className={styles.center} role="status" aria-label="Loading the conversation">
        <Loader size="medium" />
      </div>
    );
  }
  if (error || !thread || !threadId) {
    return (
      <div className={styles.thread}>
        {back}
        <p className={error ? styles.error : styles.closedNote} role={error ? 'alert' : undefined}>
          {error ? 'Could not load this conversation.' : 'This conversation no longer exists.'}
        </p>
      </div>
    );
  }

  const run = async (
    work: () => Promise<unknown>,
    failure: string,
    done?: () => void,
  ): Promise<void> => {
    setBusy(true);
    try {
      await work();
      setConfirm(null);
      done?.();
    } catch (e) {
      showToast(describeCallableError(e, failure), { type: 'negative' });
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = (finalMessage: string) => {
    if (confirm === 'unblock') {
      void run(
        () => accountAdminCalls.setStatus({ uid: thread.senderUid, status: 'approved' }),
        'Could not unblock this account. Try again.',
      );
    } else if (confirm === 'keepBlocked') {
      const text = normalizeInboxText(finalMessage);
      void run(
        () =>
          inboxCalls.manage(
            text
              ? { action: 'keepBlocked', threadId, requestId: crypto.randomUUID(), text }
              : { action: 'keepBlocked', threadId },
          ),
        'Could not update this appeal. Try again.',
      );
    } else if (confirm === 'delete') {
      void run(
        () => inboxCalls.manage({ action: 'delete', threadId }),
        'Could not delete this conversation. Try again.',
        () => void navigate('/admin/inbox'),
      );
    }
  };

  return (
    <div className={styles.thread}>
      {back}
      <ThreadHeader
        thread={thread}
        busy={busy}
        onClose={() =>
          void run(
            () => inboxCalls.manage({ action: 'close', threadId }),
            'Could not close this conversation. Try again.',
          )
        }
        onReopen={() =>
          void run(
            () => inboxCalls.manage({ action: 'reopen', threadId }),
            'Could not reopen this conversation. Try again.',
          )
        }
        onConfirm={setConfirm}
      />
      <div className={styles.layout}>
        <div className={styles.conversation}>
          {messagesError ? (
            <p className={styles.error} role="alert">
              Could not load the messages.
            </p>
          ) : null}
          <div className={styles.messages} aria-label="Messages">
            {messages.map((m) => (
              <Message key={m.id} message={m} thread={thread} />
            ))}
          </div>
          {canReply(thread) ? (
            <ReplyBox threadId={threadId} />
          ) : (
            <p className={styles.closedNote}>This conversation is closed. Reopen it to reply.</p>
          )}
        </div>
        {uid ? <InboxNote threadId={threadId} uid={uid} /> : null}
      </div>
      {confirm ? (
        <ConfirmDialog
          kind={confirm}
          thread={thread}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={onConfirm}
        />
      ) : null}
    </div>
  );
}
