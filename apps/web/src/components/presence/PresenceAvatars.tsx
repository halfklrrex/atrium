import { Avatar, AvatarGroup, Tooltip } from '@vibe/core';
import { useAuth } from '../../auth/auth-context';
import { useBoardPresence } from '../../data/presence';
import { initialsOf } from '../../lib/format';
import { formatViewingNow } from './formatPresence';
import styles from './PresenceAvatars.module.css';

export interface PresenceAvatarsProps {
  boardId: string;
  max?: number;
  size?: 'xs' | 'small' | 'medium';
}

export function PresenceAvatars({ boardId, max = 3, size = 'small' }: PresenceAvatarsProps) {
  const { user } = useAuth();
  const { activeViewers } = useBoardPresence(boardId, user);

  // Hide avatar group when there are no viewers, or when you are the only viewer (as monday does)
  if (
    activeViewers.length === 0 ||
    (activeViewers.length === 1 && activeViewers[0]?.uid === user?.uid)
  ) {
    return null;
  }

  const tooltipText = formatViewingNow(activeViewers, user?.uid);

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
              <Avatar
                key={viewer.uid}
                type={viewer.photoURL ? 'img' : 'text'}
                src={viewer.photoURL ?? undefined}
                text={initialsOf(name)}
                aria-label={name}
                backgroundColor={isMe ? 'bright-blue' : 'primary'}
              />
            );
          })}
        </AvatarGroup>
      </div>
    </Tooltip>
  );
}
