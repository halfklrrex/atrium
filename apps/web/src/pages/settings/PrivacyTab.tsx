import { Button } from '@vibe/core';
import { Link } from 'react-router';
import { useUiStore } from '../../components/AppShell/ui-store';
import { aboutLinks } from '../../lib/about';
import styles from './Settings.module.css';
import { SettingsCard } from './SettingsCard';

/** Settings > Privacy and data. The export and deletion tools arrive later (GDPR-1, GDPR-2). */
export function PrivacyTab() {
  const openDialog = useUiStore((s) => s.openDialog);
  const links = aboutLinks();
  const ask = () => openDialog({ type: 'feedback', category: 'complaint' });

  return (
    <>
      <SettingsCard title="Your data">
        <ul className={styles.rows}>
          <li className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>Privacy notice</span>
              <span className={styles.rowValue}>
                What Atrium stores, where, for how long, and your choices.
              </span>
            </span>
            <Link className={styles.link} to="/privacy">
              Read the privacy notice
            </Link>
          </li>
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
      </SettingsCard>

      <SettingsCard title="About Atrium">
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
      </SettingsCard>
    </>
  );
}
