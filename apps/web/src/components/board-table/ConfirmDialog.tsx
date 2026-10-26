import { Modal, ModalBasicLayout, ModalContent, ModalFooter, ModalHeader } from '@vibe/core';
import { useState } from 'react';
import styles from './ConfirmDialog.module.css';

/** A small "are you sure?" modal for destructive table actions. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      onClose();
    }
  };

  return (
    <Modal id="table-confirm-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={title} />
        <ModalContent>
          <p className={styles.text}>{message}</p>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: confirmLabel,
          onClick: () => void confirm(),
          disabled: busy,
          loading: busy,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: busy }}
      />
    </Modal>
  );
}
