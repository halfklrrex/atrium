import type { AutomationRunStatus } from '@atrium/shared';
import { Icon } from '@vibe/core';
import { Alert, Check } from '@vibe/icons';
import classNames from 'classnames';
import { RUN_STATUS_LABELS } from './run-history';
import styles from './RunStatusChip.module.css';

/** The result of a run: OK (check), Failed or Skipped (outlined). Shared by Manage and Run history. */
export function RunStatusChip({ status }: { status: AutomationRunStatus }) {
  return (
    <span className={classNames(styles.chip, styles[status])}>
      {status === 'ok' ? (
        <Icon icon={Check} size={14} className={styles.icon} ignoreFocusStyle />
      ) : null}
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

/** The pale yellow "Needs attention" chip with a warning triangle. */
export function AttentionChip() {
  return (
    <span className={classNames(styles.chip, styles.attention)}>
      <Icon icon={Alert} size={16} className={styles.icon} ignoreFocusStyle />
      Needs attention
    </span>
  );
}
