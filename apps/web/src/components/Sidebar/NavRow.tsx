import { Icon } from '@vibe/core';
import type { SubIcon } from '@vibe/core';
import classNames from 'classnames';
import { NavLink } from 'react-router';
import styles from './Sidebar.module.css';

/** monday draws the Home / My work / More glyphs at 16px (the 20px box is the row's icon slot). */
const NAV_ICON_SIZE = 16;

/** Top-level sidebar link: icon plus label, highlighted while its route is active. */
export function NavRow({
  to,
  icon,
  label,
  end = false,
  onNavigate,
}: {
  to: string;
  icon: SubIcon;
  label: string;
  end?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) => classNames(styles.row, isActive && styles.rowActive)}
    >
      <Icon icon={icon} size={NAV_ICON_SIZE} className={styles.rowIcon} />
      <span className={styles.rowLabel}>{label}</span>
    </NavLink>
  );
}
