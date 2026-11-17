import { Button } from '@vibe/core';
import { useState } from 'react';
import { ConfirmDialog } from '../board-table/ConfirmDialog';
import styles from './doc.module.css';

/**
 * Shown when somebody else saved a newer version of the doc while the user had unsaved edits (or
 * the rules refused the user's save for that reason). The user picks; nothing merges by itself.
 */
export function ConflictBanner({
  authorName,
  onLoadTheirs,
  onKeepMine,
  onCopyMine,
}: {
  /** Who saved the newer version, when known. */
  authorName: string | undefined;
  onLoadTheirs: () => void;
  onKeepMine: () => Promise<void> | void;
  onCopyMine: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <div className={styles.conflict} role="alert" data-testid="doc-conflict-banner">
        <p className={styles.bannerText}>
          <strong>{authorName ?? 'Someone'}</strong> changed this doc while you were editing.
        </p>
        <Button kind="tertiary" size="small" onClick={onCopyMine}>
          Copy my text
        </Button>
        <Button kind="secondary" size="small" onClick={onLoadTheirs}>
          Load their version
        </Button>
        <Button size="small" onClick={() => setConfirming(true)}>
          Keep mine
        </Button>
      </div>
      {confirming ? (
        <ConfirmDialog
          title="Keep your version?"
          message="Their changes will be lost."
          confirmLabel="Keep mine"
          onConfirm={onKeepMine}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
