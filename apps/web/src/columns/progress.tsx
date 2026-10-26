import type { ProgressSettings, ProgressValue } from '@atrium/shared';
import { Battery } from '@vibe/icons';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function ProgressCell({ value }: CellProps<ProgressValue, ProgressSettings>) {
  const pct = Math.max(0, Math.min(100, value?.progress ?? 0));

  return (
    <div className={styles.root}>
      <div
        className={styles.progressBar}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        <span className={styles.progressText}>{pct}%</span>
      </div>
    </div>
  );
}

export const progressUi = defineColumnUi<ProgressValue, ProgressSettings>({
  type: 'progress',
  icon: Battery,
  tone: 'green',
  editor: 'none',
  Cell: ProgressCell,
});
