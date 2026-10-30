import type { NotificationKind } from '@atrium/shared';
import { Icon, IconButton, Menu, MenuButton, MenuItem } from '@vibe/core';
import { Check, Delete, Mention, Person, Reply, Undo } from '@vibe/icons';
import classNames from 'classnames';
import type { NotificationDoc } from '../../data/model';
import { formatUpdated } from '../../lib/format';
import { Highlight } from '../board-table/Highlight';
import { UserAvatar } from '../UserAvatar';
import { actionText } from './notification-filter';
import styles from './NotificationsPanel.module.css';

const KIND_ICON: Record<NotificationKind, typeof Person> = {
  assigned: Person,
  reply: Reply,
  mention: Mention,
};

interface NotificationCardProps {
  notification: NotificationDoc;
  /** The search term to highlight. */
  term: string;
  onOpen: (n: NotificationDoc) => void;
  onMarkRead: (n: NotificationDoc) => void;
  onMarkUnread: (n: NotificationDoc) => void;
  onRemove: (n: NotificationDoc) => void;
}

/**
 * One notification: avatar, "**Actor** [icon] action", the snippet, and "when • item". Unread cards
 * are tinted; hovering (or focusing) shows a check that marks it read, and a menu.
 */
export function NotificationCard({
  notification: n,
  term,
  onOpen,
  onMarkRead,
  onMarkUnread,
  onRemove,
}: NotificationCardProps) {
  const unread = n.readAt === null;
  return (
    <li className={classNames(styles.card, unread && styles.unread)} data-unread={unread}>
      <button type="button" className={styles.cardMain} onClick={() => onOpen(n)}>
        <UserAvatar uid={n.actorId} name={n.actorName} photoURL={n.actorPhotoURL} size="large" />
        <span className={styles.cardText}>
          <span className={styles.cardLine}>
            <span className={styles.actor}>
              <Highlight text={n.actorName} term={term} />
            </span>
            <Icon icon={KIND_ICON[n.kind]} size={16} className={styles.kindIcon} />
            <span>{actionText(n)}</span>
          </span>
          {n.snippet ? (
            <span className={styles.snippet}>
              <Highlight text={n.snippet} term={term} />
            </span>
          ) : null}
          <span className={styles.meta}>
            {formatUpdated(n.createdAt)}
            {' • '}
            <Highlight text={n.itemName} term={term} />
            {' · '}
            <Highlight text={n.boardName} term={term} />
          </span>
        </span>
      </button>
      <div className={styles.cardActions}>
        {unread ? (
          <IconButton
            icon={Check}
            kind="tertiary"
            size="small"
            aria-label="Mark as read"
            onClick={() => onMarkRead(n)}
          />
        ) : null}
        <MenuButton size="small" aria-label="Notification actions" closeMenuOnItemClick>
          <Menu id={`notification-menu-${n.id}`} size="small">
            {unread ? (
              <MenuItem title="Mark as read" icon={Check} onClick={() => onMarkRead(n)} />
            ) : (
              <MenuItem title="Mark as unread" icon={Undo} onClick={() => onMarkUnread(n)} />
            )}
            <MenuItem title="Delete" icon={Delete} onClick={() => onRemove(n)} />
          </Menu>
        </MenuButton>
      </div>
    </li>
  );
}
