import { Icon } from '@vibe/core';
import { NavigationChevronDown, NavigationChevronRight } from '@vibe/icons';
import { useId, useState, type ReactNode } from 'react';
import styles from './CollapsibleSection.module.css';

/** Home-style section: chevron + 16px title, content shown while expanded. */
export function CollapsibleSection({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon icon={open ? NavigationChevronDown : NavigationChevronRight} size={16} />
          <span>{title}</span>
          {badge}
        </button>
      </h2>
      {open ? (
        <div id={panelId} className={styles.panel}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
