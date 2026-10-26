import classNames from 'classnames';
import styles from './WorkspaceTile.module.css';

export type TileSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Rounded square showing a workspace's letter or emoji on its colour. */
export function WorkspaceTile({
  icon,
  color,
  size = 'sm',
  className,
}: {
  icon: string;
  color: string;
  size?: TileSize;
  className?: string;
}) {
  return (
    <span
      className={classNames(styles.tile, styles[size], className)}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}
