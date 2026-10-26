import { Modal, ModalBasicLayout, ModalContent, ModalFooter, ModalHeader } from '@vibe/core';
import { APP_VERSION, aboutLinks } from '../../lib/about';
import { AtriumMark } from '../AtriumLogo';
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
            <AtriumMark size={48} title="Atrium" />
            <dl className={styles.aboutMeta}>
              <dt>Version</dt>
              <dd>
                <code data-testid="about-version">{APP_VERSION}</code>
              </dd>
            </dl>
            <p className={styles.aboutText}>
              Atrium is free software licensed under the GNU AGPL v3.
            </p>
            <ul className={styles.aboutLinks}>
              <li>
                <a href={links.source} target="_blank" rel="noopener noreferrer">
                  Source code
                </a>
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
