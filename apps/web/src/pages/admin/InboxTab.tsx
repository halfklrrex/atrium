import { Button, Label, Loader } from '@vibe/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { SenderAvatar } from '../../components/inbox/SenderAvatar';
import { useInboxList, type InboxThreadDoc } from '../../data/inbox';
import { formatRelativeShort } from '../../lib/format';
import { senderLabel } from '../../lib/inbox-sender';
import {
  INBOX_KIND_FILTERS,
  INBOX_KIND_LABELS,
  INBOX_STATUS_FILTERS,
  INBOX_STATUS_LABELS,
  emptyMessage,
  kindLabel,
  senderEmailLine,
  type InboxKindFilter,
  type InboxStatusFilter,
} from './inbox';
import styles from './Inbox.module.css';

function FilterGroup<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className={styles.filterGroup} role="group" aria-label={label}>
      <span className={styles.filterLabel} aria-hidden="true">
        {label}
      </span>
      {options.map((o) => (
        <Button
          key={o}
          size="small"
          kind="secondary"
          active={o === value}
          aria-pressed={o === value}
          onClick={() => onChange(o)}
        >
          {labels[o]}
        </Button>
      ))}
    </div>
  );
}

function ThreadRow({ thread, onOpen }: { thread: InboxThreadDoc; onOpen: () => void }) {
  const name = senderLabel(thread);
  const email = senderEmailLine(thread);
  const unread = thread.adminUnread;
  return (
    <li>
      <button type="button" className={styles.row} onClick={onOpen}>
        <span
          className={unread ? `${styles.dot} ${styles.dotOn}` : styles.dot}
          role={unread ? 'img' : undefined}
          aria-label={unread ? 'Unread' : undefined}
        />
        <span className={styles.rowMain}>
          <SenderAvatar name={name} photoURL={thread.senderPhotoURL} />
          <span className={styles.rowText}>
            <span className={styles.rowTop}>
              <span className={unread ? styles.nameUnread : styles.name}>{name}</span>
              {email ? <span className={styles.email}>{email}</span> : null}
            </span>
            <span className={styles.subject}>{thread.subject}</span>
            <span className={styles.snippet}>{thread.lastSnippet}</span>
          </span>
        </span>
        <span className={styles.rowSide}>
          <Label
            text={kindLabel(thread)}
            color={thread.kind === 'appeal' ? 'negative' : 'primary'}
            kind="line"
          />
          <span className={styles.time}>{formatRelativeShort(thread.lastMessageAt)}</span>
        </span>
      </button>
    </li>
  );
}

/** The Inbox list (`/admin/inbox`): filters, one row per thread, "Load more". */
export function InboxTab() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<InboxStatusFilter>('open');
  const [kind, setKind] = useState<InboxKindFilter>('all');
  const { threads, loading, loadingMore, error, hasMore, loadMore } = useInboxList(
    status === 'all' ? null : status,
    kind === 'all' ? null : kind,
  );

  return (
    <section className={styles.tab} aria-label="Inbox">
      <div className={styles.filters}>
        <FilterGroup
          label="Status"
          options={INBOX_STATUS_FILTERS}
          labels={INBOX_STATUS_LABELS}
          value={status}
          onChange={setStatus}
        />
        <FilterGroup
          label="Kind"
          options={INBOX_KIND_FILTERS}
          labels={INBOX_KIND_LABELS}
          value={kind}
          onChange={setKind}
        />
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          Could not load the Inbox. Try again in a moment.
        </p>
      ) : null}

      {threads.length > 0 ? (
        <ul className={styles.list} aria-label="Conversations">
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} onOpen={() => void navigate(`/admin/inbox/${t.id}`)} />
          ))}
        </ul>
      ) : null}

      {loading ? (
        <div className={styles.center} role="status" aria-label="Loading the Inbox">
          <Loader size="medium" />
        </div>
      ) : threads.length === 0 && !error ? (
        <div className={styles.center}>{emptyMessage(status, kind)}</div>
      ) : null}

      {hasMore && !loading ? (
        <div className={styles.more}>
          <Button kind="tertiary" size="small" loading={loadingMore} onClick={loadMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </section>
  );
}
