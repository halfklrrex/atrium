import { useId, type ReactNode } from 'react';
import styles from './Settings.module.css';

/** A titled card: header (title, hint, optional control on the right) and a body. */
export function SettingsCard({
  title,
  hint,
  headerEnd,
  titleId,
  children,
}: {
  title: string;
  hint?: ReactNode;
  headerEnd?: ReactNode;
  /** Set when something else (a fieldset) must be labelled by the title. */
  titleId?: string;
  children: ReactNode;
}) {
  const generated = useId();
  const id = titleId ?? generated;
  return (
    <section className={styles.card} aria-labelledby={id}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderText}>
          <h3 id={id} className={styles.cardTitle}>
            {title}
          </h3>
          {hint ? <p className={styles.cardHint}>{hint}</p> : null}
        </div>
        {headerEnd}
      </div>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}
