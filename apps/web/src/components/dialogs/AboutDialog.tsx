import { Modal, ModalBasicLayout, ModalContent, ModalFooter, ModalHeader } from '@vibe/core';
import { Link } from 'react-router';
import { APP_VERSION, aboutLinks } from '../../lib/about';
import { BrandMark } from '../BrandMark';
import styles from './dialogs.module.css';

/** "About Atrium": version and the AGPL section 13 source offer. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const links = aboutLinks();
  return (
    <Modal id="about-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="About Atrium" />
        <ModalContent>
          <div className={styles.about}>
            <BrandMark variant="icon" size={64} title="Atrium" />
            <dl className={styles.aboutMeta}>
              <dt>Version</dt>
              <dd>
                <code data-testid="about-version">{APP_VERSION}</code>
              </dd>
            </dl>
            <p className={styles.aboutText}>
              Atrium is free software licensed under the GNU AGPL v3.
            </p>
            <p className={styles.aboutText}>
              Emoji graphics are Twemoji, copyright 2020 Twitter, Inc and other contributors,
              maintained by the jdecked/twemoji project, licensed under{' '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noopener noreferrer"
              >
                CC-BY 4.0
              </a>
              . Converted to a colour font for Atrium.
            </p>
            <ul className={styles.aboutLinks}>
              <li>
                <a href={links.source} target="_blank" rel="noopener noreferrer">
                  Source code
                </a>
              </li>
              <li>
                <Link to="/privacy" onClick={onClose}>
                  Privacy
                </Link>
              </li>
              <li>
                <a href={links.licence} target="_blank" rel="noopener noreferrer">
                  Licence
                </a>
              </li>
              <li>
                <a href={links.notices} target="_blank" rel="noopener noreferrer">
                  Third-party notices
                </a>
              </li>
            </ul>
          </div>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter primaryButton={{ text: 'Close', onClick: onClose }} />
    </Modal>
  );
}
