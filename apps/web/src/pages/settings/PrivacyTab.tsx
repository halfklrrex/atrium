import { Button } from '@vibe/core';
import { useUiStore } from '../../components/AppShell/ui-store';
import { aboutLinks } from '../../lib/about';
import styles from './Settings.module.css';

/** Settings > Privacy and data. The export and deletion tools arrive later (GDPR-1, GDPR-2). */
export function PrivacyTab() {
  const openDialog = useUiStore((s) => s.openDialog);
  const links = aboutLinks();
  const ask = () => openDialog({ type: 'feedback', category: 'complaint' });

  return (
    <>
      <section className={styles.section} aria-labelledby="your-data-title">
        <h2 id="your-data-title" className={styles.sectionTitle}>
          Your data
        </h2>
        <ul className={styles.rows}>
          <li className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>Download my data</span>
              <span className={styles.rowValue}>
                Coming soon. Until then, use Send feedback, then Complaint or data request.
              </span>
            </span>
            <Button kind="secondary" onClick={ask}>
              Request my data
            </Button>
          </li>
          <li className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>Delete my account</span>
              <span className={styles.rowValue}>
                Coming soon. Until then, use Send feedback, then Complaint or data request.
              </span>
            </span>
            <Button kind="secondary" onClick={ask}>
              Request deletion
            </Button>
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="about-title">
        <h2 id="about-title" className={styles.sectionTitle}>
          About Atrium
        </h2>
        <ul className={styles.rows}>
          <li className={styles.row}>
            <span className={styles.rowTitle}>Source code</span>
            <a
              className={styles.link}
              href={links.source}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub
            </a>
          </li>
          <li className={styles.row}>
            <span className={styles.rowTitle}>Version, licence and notices</span>
            <Button kind="tertiary" onClick={() => openDialog({ type: 'about' })}>
              About Atrium
            </Button>
          </li>
        </ul>
      </section>
    </>
  );
}
