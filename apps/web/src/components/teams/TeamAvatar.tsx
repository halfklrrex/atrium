import { initialsOf } from '../../lib/format';
import styles from './teams.module.css';

/** Circle in the team color with the team's first one or two letters. `color` null: a deleted team. */
export function TeamAvatar({
  name,
  color,
  size = 'md',
}: {
  name: string;
  color: string | null;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={`${styles.avatar} ${size === 'sm' ? styles.avatarSm : styles.avatarMd} ${color ? '' : styles.avatarDeleted}`}
      style={color ? { backgroundColor: color } : undefined}
      role="img"
      aria-label={name}
    >
      {initialsOf(name) || '?'}
    </span>
  );
}
