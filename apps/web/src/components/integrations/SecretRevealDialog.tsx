import {
  Button,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TextField,
} from '@vibe/core';
import { useState } from 'react';
import styles from './Integrations.module.css';

export interface Reveal {
  title: string;
  /** "secret" or "URL": used in the warning and the field label. */
  noun: 'secret' | 'URL';
  value: string;
}

/**
 * Shows a secret (a signing secret or an incoming hook URL) once. It lives only in the caller's
 * state, so closing the dialog discards it; it is never stored, logged or put in the page address.
 */
export function SecretRevealDialog({ reveal, onClose }: { reveal: Reveal; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = reveal.noun === 'URL' ? 'Webhook URL' : 'Signing secret';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.value);
      setCopied(true);
      setError(null);
    } catch {
      setError(`Could not copy. Select the ${reveal.noun} and copy it yourself.`);
    }
  };

  return (
    <Modal id="integrations-secret-dialog" show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={reveal.title} />
        <ModalContent>
          <div className={styles.stack}>
            <p className={styles.warning} role="alert">
              Copy this {reveal.noun} now. You won&apos;t be able to see it again.
            </p>
            <div className={styles.secretBox}>
              <div className={styles.secretValue}>
                <TextField
                  inputAriaLabel={label}
                  title={label}
                  value={reveal.value}
                  readonly
                  autoFocus
                  size="medium"
                  onChange={() => undefined}
                />
              </div>
              <Button kind="secondary" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {error ? (
              <p className={styles.errorText} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter primaryButton={{ text: 'Done', onClick: onClose }} />
    </Modal>
  );
}
