import { Avatar } from '@vibe/core';
import { initialsOf } from '../../lib/format';

/** Photo, or initials when the person has none. */
export function SenderAvatar({
  name,
  photoURL,
  size = 'small',
}: {
  name: string;
  photoURL: string | null;
  size?: 'small' | 'medium';
}) {
  return photoURL ? (
    <Avatar type="img" src={photoURL} size={size} aria-label={name} />
  ) : (
    <Avatar
      type="text"
      text={initialsOf(name)}
      size={size}
      backgroundColor="bright-blue"
      aria-label={name}
    />
  );
}
