import classNames from 'classnames';
import { findWorkspaceIcon, isIconKeyValue } from './workspace-icons/icons';
import styles from './WorkspaceTile.module.css';

export type TileSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const firstGlyph = (text: string): string => [...text.trim()][0]?.toUpperCase() ?? '';

/**
 * Rounded square showing a workspace's icon on its colour: a Phosphor icon in the fill weight (`ph:<key>`, or a legacy `mi:<key>` through its mapped icon),
 * or a letter or emoji. An icon key that is not in the curated set (removed later) shows the first
 * letter of `name` instead, so the UI never prints the raw key.
 */
export function WorkspaceTile({
  icon,
  color,
  name,
  size = 'sm',
  className,
}: {
  icon: string;
  color: string;
  /** Used for the fallback letter when `icon` is an unknown icon key. */
  name?: string;
  size?: TileSize;
  className?: string;
}) {
  const def = findWorkspaceIcon(icon);
  const content = def ? (
    <svg
      className={styles.glyph}
      viewBox="0 0 256 256"
      fill="currentColor"
      focusable="false"
      data-icon-key={def.key}
    >
      <path d={def.fill} />
    </svg>
  ) : isIconKeyValue(icon) ? (
    firstGlyph(name ?? '') || 'W'
  ) : (
    icon
  );
  return (
    <span
      className={classNames(styles.tile, styles[size], className)}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {content}
    </span>
  );
}
