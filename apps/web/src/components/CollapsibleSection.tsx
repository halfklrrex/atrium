import { Icon } from '@vibe/core';
import { NavigationChevronDown, NavigationChevronRight } from '@vibe/icons';
import { useId, useState, type ReactNode } from 'react';
import styles from './CollapsibleSection.module.css';

/** Home-style section: chevron + 16px title, content shown while expanded. */
export function CollapsibleSection({
  title,
  badge,
  defaultOpen = true,
  className,
  children,
}: {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  /** Extra class on the section (set `--collapsible-title-color` to colour the title). */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <section className={className ? `${styles.section} ${className}` : styles.section}>
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
