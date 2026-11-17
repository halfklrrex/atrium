import { Avatar, AvatarGroup, Tooltip } from '@vibe/core';
import { useAuth } from '../../auth/auth-context';
import { useBoardPresence, useDocPresence } from '../../data/presence';
import { initialsOf } from '../../lib/format';
import { ProfileLink } from '../profile';
import { formatViewingNow } from './formatPresence';
import styles from './PresenceAvatars.module.css';

export interface PresenceAvatarsProps {
  /** A board page shows its viewers... */
  boardId?: string;
  /** ...a doc page its own (exactly one of the two). */
  docId?: string;
  max?: number;
  size?: 'xs' | 'small' | 'medium';
}

export function PresenceAvatars({ boardId, docId, max = 3, size = 'small' }: PresenceAvatarsProps) {
  const { user } = useAuth();
  const board = useBoardPresence(boardId, user);
  const docPresence = useDocPresence(docId, user);
  const { activeViewers } = docId ? docPresence : board;

  // Hide avatar group when there are no viewers, or when you are the only viewer (as monday does)
  if (
    activeViewers.length === 0 ||
    (activeViewers.length === 1 && activeViewers[0]?.uid === user?.uid)
  ) {
    return null;
  }

  const tooltipText = formatViewingNow(activeViewers, user?.uid, docId ? 'Here now' : undefined);

  return (
    <Tooltip content={tooltipText}>
      <div
        className={styles.presenceWrapper}
        aria-label={tooltipText}
        data-testid="presence-avatars"
      >
        <span className={styles.liveIndicator} aria-hidden="true" />
        <AvatarGroup max={max} size={size}>
          {activeViewers.map((viewer) => {
            const isMe = viewer.uid === user?.uid;
            const name = viewer.displayName || (isMe ? 'You' : 'Anonymous');
            return (
              <ProfileLink
                key={viewer.uid}
                uid={viewer.uid}
                name={name}
                photoURL={viewer.photoURL}
                label={`Profile of ${name}`}
              >
                <Avatar
                  type={viewer.photoURL ? 'img' : 'text'}
                  src={viewer.photoURL ?? undefined}
                  text={initialsOf(name)}
                  aria-label={name}
                  backgroundColor={isMe ? 'bright-blue' : 'primary'}
                />
              </ProfileLink>
            );
          })}
        </AvatarGroup>
      </div>
    </Tooltip>
  );
}
