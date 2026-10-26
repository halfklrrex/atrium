import { Avatar } from '@vibe/core';
import { Person } from '@vibe/icons';
import { useAuth } from '../auth/auth-context';
import { initialsOf } from '../lib/format';

type Size = 'xs' | 'small' | 'medium' | 'large';

/**
 * Avatar for a user id. Uses explicit name and photoURL if provided, otherwise looks up current user
 * or falls back to a neutral person avatar.
 */
export function UserAvatar({
  uid,
  name: explicitName,
  photoURL: explicitPhotoURL,
  size = 'small',
}: {
  uid: string;
  name?: string;
  photoURL?: string | null;
  size?: Size;
}) {
  const { user } = useAuth();
  const isMe = user?.uid === uid;
  const name =
    explicitName ?? (isMe ? (user?.displayName ?? user?.email ?? 'You') : 'Board member');
  const photo = explicitPhotoURL !== undefined ? explicitPhotoURL : isMe ? user?.photoURL : null;

  if (photo) {
    return <Avatar type="img" src={photo} size={size} aria-label={name} />;
  }
  if (name && name !== 'Board member') {
    return (
      <Avatar
        type="text"
        text={initialsOf(name)}
        size={size}
        backgroundColor="bright-blue"
        aria-label={name}
      />
    );
  }
  return (
    <Avatar type="icon" icon={Person} size={size} backgroundColor="winter" aria-label={name} />
  );
}
